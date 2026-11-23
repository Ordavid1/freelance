import 'server-only';
import { route } from '@/lib/security/policy';
import { processDueSlackJobs } from '@/lib/support/slack/outbox';

export const runtime = 'nodejs';

// Called by Cloud Scheduler with an OIDC token (checked by the policy layer); processes due Slack outbox jobs.
export const POST = route('support.slack.dispatch', {}, async () => {
  try {
    const result = await processDueSlackJobs(25);
    console.info(JSON.stringify({ event: 'support_slack_dispatch', ...result }));
    return Response.json(result);
  } catch { return Response.json({ error: 'DELIVERY_UNAVAILABLE' }, { status: 503 }); }
});
