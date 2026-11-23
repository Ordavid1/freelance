import 'server-only';
import { GoogleAuth } from 'google-auth-library';

// Contract shared by the request policy layer (caller) and the bot-protection provider (implementation).
// See .claude/plans/23-11-26-Security-Phase1.md. Signatures are fixed; the body is the provider's.
//
// Provider: reCAPTCHA Enterprise, score-based keys. The browser obtains a token for a named action and sends it in the
// `x-human-token` header; the server creates an assessment (REST, application default credentials) and accepts the request only
// when the token is valid, was minted for this action on this site, and scores at least RECAPTCHA_MIN_SCORE.
// Enabled only when RECAPTCHA_SITE_KEY and GOOGLE_CLOUD_PROJECT are set; otherwise every request passes.

export type HumanCheckAction = 'support_message' | 'ai_profile' | 'ai_project_brief';

export const HUMAN_TOKEN_HEADER = 'x-human-token';
const MAX_TOKEN_LENGTH = 8192;
const DEFAULT_MIN_SCORE = 0.5;
const PROVIDER_TIMEOUT_MS = 5000;
// Anonymous actions have no per-account limit behind them, so an outage of the provider must not open them (fail closed).
// Signed-in AI actions are still bounded by per-account and global limits, so an outage must not block paying users (fail open).
const FAIL_CLOSED: ReadonlySet<HumanCheckAction> = new Set(['support_message']);

function config() {
  const siteKey = process.env.RECAPTCHA_SITE_KEY?.trim();
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  return siteKey && project ? { siteKey, project } : null;
}

function minScore() {
  const raw = process.env.RECAPTCHA_MIN_SCORE?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_MIN_SCORE;
}

/** The host the token must have been minted on: the public site host (or, outside production without one, the request's own). */
function expectedHostname(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || (process.env.NODE_ENV === 'production' ? 'https://freelance-place.com' : request.url);
  return new URL(configured).hostname.toLowerCase();
}

/** The public site key to publish to the browser, or '' when the check is not configured. */
export function humanCheckSiteKey(): string {
  return config()?.siteKey ?? '';
}

/** True when a human check is configured and required for this action. */
export function humanCheckEnabled(action: HumanCheckAction): boolean {
  void action;
  return config() !== null;
}

function reject(status: number, error: string, message: string) {
  return Response.json({ error: message, code: error }, { status, headers: { 'Cache-Control': 'no-store' } });
}
const refused = () => reject(403, 'HUMAN_CHECK_FAILED', 'לא הצלחנו לאמת שהבקשה נשלחה על ידי אדם. רעננו את הדף ונסו שוב.');
const unavailable = () => reject(503, 'HUMAN_CHECK_UNAVAILABLE', 'שירות האימות אינו זמין כרגע. נסו שוב בעוד רגע.');

let auth: GoogleAuth | undefined;
async function accessToken() {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error('NO_ACCESS_TOKEN');
  return token;
}

type Assessment = { tokenProperties?: { valid?: unknown; action?: unknown; hostname?: unknown }; riskAnalysis?: { score?: unknown } };

async function assess(request: Request, token: string, action: HumanCheckAction, setup: { siteKey: string; project: string }): Promise<Assessment> {
  const response = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(setup.project)}/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
    body: JSON.stringify({ event: { token, siteKey: setup.siteKey, expectedAction: action, userAgent: request.headers.get('user-agent')?.slice(0, 512) || undefined } }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ASSESSMENT_HTTP_${response.status}`);
  return await response.json() as Assessment;
}

/** Verifies the request's human-check token for `action`. Returns null when allowed, or the response to send. */
export async function verifyHumanCheck(request: Request, action: HumanCheckAction): Promise<Response | null> {
  const setup = config();
  if (!setup) return null;
  const token = request.headers.get(HUMAN_TOKEN_HEADER)?.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return refused();
  try {
    const result = await assess(request, token, action, setup);
    const score = result.riskAnalysis?.score;
    if (typeof result.tokenProperties?.valid !== 'boolean' || (result.tokenProperties.valid && typeof score !== 'number')) throw new Error('ASSESSMENT_MALFORMED');
    if (!result.tokenProperties.valid) return refused();
    // A token minted for another action or site is replayed or relayed, never a mistake to forgive.
    if (result.tokenProperties.action !== action) return refused();
    if (typeof result.tokenProperties.hostname !== 'string' || result.tokenProperties.hostname.toLowerCase() !== expectedHostname(request)) return refused();
    if ((score as number) < minScore()) return refused();
    return null;
  } catch (error) {
    console.warn(JSON.stringify({ severity: 'WARNING', event: 'human_check_provider_error', action, failClosed: FAIL_CLOSED.has(action), message: error instanceof Error ? error.message : 'unknown' }));
    return FAIL_CLOSED.has(action) ? unavailable() : null;
  }
}
