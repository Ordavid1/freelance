import { OAuth2Client } from 'google-auth-library';
import { publicAppOrigin } from '@/lib/auth/session';
import { dispatchNotifications } from '@/lib/notifications/delivery';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const expected = process.env.NOTIFICATIONS_SCHEDULER_EMAIL;
  if (!expected) return Response.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
  try {
    const ticket = await new OAuth2Client().verifyIdToken({ idToken: request.headers.get('authorization')?.replace(/^Bearer /, '') || '', audience: `${publicAppOrigin(request)}/api/notifications/dispatch` });
    const token = ticket.getPayload();
    if (token?.email !== expected || token.email_verified !== true) throw new Error();
  } catch { return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }); }
  try {
    const result = await dispatchNotifications();
    console.info(JSON.stringify({ event: 'project_mail_dispatch', ...result }));
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch { return Response.json({ error: 'DELIVERY_UNAVAILABLE' }, { status: 503 }); }
}
