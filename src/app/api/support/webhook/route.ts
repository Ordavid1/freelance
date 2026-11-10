import { Resend } from 'resend';
import { supportConfig } from '@/lib/support/config';
import { limitedBody, SupportError, supportFailure, supportJson } from '@/lib/support/http';
import { receiveSupportReply } from '@/lib/support/service';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const config = supportConfig();
    if (!config) throw new SupportError('NOT_CONFIGURED', 503, 'Support email is not configured.');
    const payload = await limitedBody(request, 256_000);
    let event;
    try {
      event = new Resend(config.apiKey).webhooks.verify({ payload, headers: { id: request.headers.get('svix-id') || '', timestamp: request.headers.get('svix-timestamp') || '', signature: request.headers.get('svix-signature') || '' }, webhookSecret: config.webhookSecret });
    } catch { throw new SupportError('SIGNATURE', 401, 'Invalid webhook signature.'); }
    if (event.type !== 'email.received') return supportJson({ ignored: true });
    return supportJson(await receiveSupportReply(config, event.data.email_id));
  } catch (error) { return supportFailure(error); }
}
