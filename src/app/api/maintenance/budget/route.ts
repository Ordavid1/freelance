import { exceedsAiCutoff, parseBudgetAlert } from '@/lib/security/budget-alert';
import { route } from '@/lib/security/policy';
import { disableFeature } from '@/lib/security/runtime-switch';

export const runtime = 'nodejs';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

// Pub/Sub push endpoint for Cloud Billing budget notifications (infra/terraform/budget-guard.tf). The policy layer
// verifies the push subscription's OIDC token (BUDGET_ALERT_PUSH_EMAIL). When the budget crosses BUDGET_AI_CUTOFF
// (default 100%) generative AI is switched off through runtimeSwitches/ai. Turning it back on is a manual,
// documented step (docs/security-operations.md); nothing here ever re-enables it, and nothing else is stopped.
//
// Status codes are Pub/Sub's retry signal: 2xx acknowledges, anything else is redelivered. A notification that
// cannot be parsed will never parse, so it is acknowledged; a failed switch write is retried.
export const POST = route('maintenance.budget', { body: { type: 'json', maxBytes: 65_536 } }, async ({ body }) => {
  const parsed = parseBudgetAlert(body);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ event: 'budget_alert_ignored', severity: 'WARNING', reason: 'unparseable' }));
    return json({ ignored: true });
  }
  const { alert } = parsed;
  if (!exceedsAiCutoff(alert)) return json({ ok: true, action: 'none' });
  try {
    const { changed } = await disableFeature('ai', 'budget', { threshold: alert.threshold!, ...(alert.budgetName ? { budget: alert.budgetName } : {}) });
    console.error(JSON.stringify({ event: 'budget_kill_switch', severity: 'CRITICAL', feature: 'ai', threshold: alert.threshold, changed }));
    return json({ ok: true, action: 'ai_disabled', changed });
  } catch {
    console.error(JSON.stringify({ event: 'budget_kill_switch_failed', severity: 'CRITICAL', feature: 'ai', threshold: alert.threshold }));
    return json({ error: 'SWITCH_UNAVAILABLE' }, 503);
  }
});
