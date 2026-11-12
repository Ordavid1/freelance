import 'server-only';
import { OAuth2Client } from 'google-auth-library';
import { publicAppOrigin } from '@/lib/auth/session';
import { processDueSlackJobs } from '@/lib/support/slack/outbox';

export const runtime = 'nodejs';

// Called by Cloud Scheduler with an OIDC token; processes due Slack outbox jobs.
export async function POST(request: Request) {
  const expected = process.env.SUPPORT_SLACK_SCHEDULER_EMAIL;
  if (!expected) return Response.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
  try {
    const ticket = await new OAuth2Client().verifyIdToken({ idToken: request.headers.get('authorization')?.replace(/^Bearer /, '') || '', audience: `${publicAppOrigin(request)}/api/support/slack/dispatch` });
    const token = ticket.getPayload();
    if (token?.email !== expected || token.email_verified !== true) throw new Error();
  } catch { return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }); }
  try {
    const result = await processDueSlackJobs(25);
    console.info(JSON.stringify({ event: 'support_slack_dispatch', ...result }));
    return Response.json(result);
  } catch { return Response.json({ error: 'DELIVERY_UNAVAILABLE' }, { status: 503 }); }
}
