// Parsing of a Cloud Billing budget notification delivered by a Pub/Sub push subscription.
// Pure: no I/O, so the decision "does this notification cross the cut-off" is unit-testable.
//
// Push envelope:  { message: { data: <base64 JSON>, messageId, attributes }, subscription }
// Notification:   { budgetDisplayName, alertThresholdExceeded?, costAmount, budgetAmount, currencyCode, ... }
// `alertThresholdExceeded` is a fraction of the budget (0.5, 0.9, 1.0) and is present only when a
// configured threshold has been crossed; routine spend updates omit it.

export type BudgetAlert = { budgetName: string; threshold: number | null };

export const DEFAULT_AI_CUTOFF = 1.0;

/** The threshold fraction at or above which generative AI is switched off (env BUDGET_AI_CUTOFF, default 1.0). */
export function aiCutoff(): number {
  const configured = Number(process.env.BUDGET_AI_CUTOFF);
  return process.env.BUDGET_AI_CUTOFF && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AI_CUTOFF;
}

export function parseBudgetAlert(envelope: Record<string, unknown>): { ok: true; alert: BudgetAlert } | { ok: false } {
  const message = envelope.message;
  if (!message || typeof message !== 'object') return { ok: false };
  const data = (message as { data?: unknown }).data;
  if (typeof data !== 'string' || !data) return { ok: false };
  try {
    const decoded: unknown = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return { ok: false };
    const { alertThresholdExceeded, budgetDisplayName } = decoded as Record<string, unknown>;
    const threshold = typeof alertThresholdExceeded === 'number' && Number.isFinite(alertThresholdExceeded) ? alertThresholdExceeded : null;
    return { ok: true, alert: { budgetName: typeof budgetDisplayName === 'string' ? budgetDisplayName.slice(0, 100) : '', threshold } };
  } catch { return { ok: false }; }
}

/** Whether this notification means the budget is spent as far as the AI cut-off is concerned. */
export function exceedsAiCutoff(alert: BudgetAlert): boolean {
  return alert.threshold !== null && alert.threshold >= aiCutoff();
}
