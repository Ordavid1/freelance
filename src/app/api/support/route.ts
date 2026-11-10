import { cookies } from 'next/headers';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { supportConfig } from '@/lib/support/config';
import { limitedBody, SupportError, supportFailure, supportJson } from '@/lib/support/http';
import { SUPPORT_COOKIE, newSupportToken, validSupportToken, readSupportConversation, sendSupportMessage, visitorMessage } from '@/lib/support/service';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const config = supportConfig();
    const viewer = await getCurrentUser();
    const token = (await cookies()).get(SUPPORT_COOKIE)?.value;
    let conversation = null;
    let rotate = !validSupportToken(token);
    if (config && validSupportToken(token)) {
      try { conversation = await readSupportConversation(token, viewer); }
      catch (error) {
        if (!(error instanceof SupportError) || error.code !== 'SESSION_CHANGED') throw error;
        rotate = true;
      }
    }
    const response = supportJson({ configured: Boolean(config), contact: conversation?.contact || { name: viewer?.name || '', email: viewer?.email || '' }, hasConversation: Boolean(conversation), messages: conversation?.messages || [] });
    if (rotate) response.cookies.set(SUPPORT_COOKIE, newSupportToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/support', maxAge: 30 * 24 * 60 * 60 });
    return response;
  } catch (error) { return supportFailure(error); }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) throw new SupportError('ORIGIN', 403, 'הבקשה נדחתה. נא לרענן את העמוד.');
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SupportError('INVALID', 400, 'הבקשה אינה תקינה.');
    const config = supportConfig();
    if (!config) throw new SupportError('NOT_CONFIGURED', 503, 'הצ׳אט אינו זמין כרגע. אפשר לפנות אלינו במייל.');
    const token = (await cookies()).get(SUPPORT_COOKIE)?.value;
    if (!validSupportToken(token)) throw new SupportError('SESSION_CHANGED', 401, 'נא לפתוח את הצ׳אט מחדש ולנסות שוב.');
    let body: unknown;
    try { body = JSON.parse(await limitedBody(request)); }
    catch (error) {
      if (error instanceof SupportError) throw error;
      throw new SupportError('INVALID', 400, 'הבקשה אינה תקינה.');
    }
    const input = visitorMessage(body);
    return supportJson({ message: await sendSupportMessage(config, token, await getCurrentUser(), input) }, 201);
  } catch (error) { return supportFailure(error); }
}
