import { Resend } from 'resend';
import { supportConfig } from '@/lib/support/config';
import { SupportError, supportFailure, supportJson } from '@/lib/support/http';
import { handleInboundEmail } from '@/lib/support/autoreply';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';
// The signature covers the raw bytes, so the policy layer hands them over untouched (capped at 256 KB).
export const POST = route('support.webhook', { sameOrigin: false, body: { type: 'raw', maxBytes: 256_000 } }, async ({ request, body }) => {
  try {
    const config = supportConfig();
    if (!config) throw new SupportError('NOT_CONFIGURED', 503, 'Support email is not configured.');
    const payload = new TextDecoder().decode(body);
    let event;
    try {
      event = new Resend(config.apiKey).webhooks.verify({ payload, headers: { id: request.headers.get('svix-id') || '', timestamp: request.headers.get('svix-timestamp') || '', signature: request.headers.get('svix-signature') || '' }, webhookSecret: config.webhookSecret });
    } catch { throw new SupportError('SIGNATURE', 401, 'Invalid webhook signature.'); }
    if (event.type !== 'email.received') return supportJson({ ignored: true });
    return supportJson(await handleInboundEmail(config, event.data.email_id));
  } catch (error) { return supportFailure(error); }
});
