// The operation registry: ONE entry per business operation, declaring the security policy it runs under.
// Transport independent on purpose (no request, no Next.js): the HTTP adapter in policy.ts applies it today,
// and any other entry point (an MCP server, a job) reads the same entry rather than re-deciding the policy.
//
// A route handler cannot be written without an entry here: `route(operationId, ...)` in policy.ts is the
// only way to export an HTTP method (tests/security-route-policy.test.mjs fails otherwise).
import type { ActionKey, AnonymousAction, BudgetFeature } from '@/lib/security/rate-limit';
import type { BurstAction } from '@/lib/security/burst-limit';
import type { HumanCheckAction } from '@/lib/security/human-check';
import { HEADHUNTER_API_ERRORS } from '@/lib/headhunters/messages';

export type Auth =
  /** A signed-in account is required. */
  | { kind: 'user' }
  /** Anyone may call; a signed-in account, when present, is passed to the handler. */
  | { kind: 'optionalUser' }
  /** A moderator session with recent second-factor evidence. */
  | { kind: 'moderator' }
  /** No caller identity. `reason` says why that is safe and what protects the operation instead. */
  | { kind: 'public'; reason: string }
  /** Cloud Scheduler / Pub/Sub push: an OIDC token whose email equals `process.env[emailEnv]`, audience = public origin + `audiencePath`. */
  | { kind: 'scheduler'; emailEnv: string; audiencePath: `/${string}` };

/** JSON bodies of the denials the adapter produces itself (the budget step's 429 included), for routes whose clients rely on a specific shape. */
export type ErrorBodies = Partial<Record<'unauthenticated' | 'origin' | 'forbidden' | 'notConfigured' | 'unauthorized' | 'bodyTooLarge' | 'bodyInvalid' | 'rateLimited', unknown>>;

type Shared = {
  /** Per-account budget key (`actionLimits`). Needs a signed-in account; for `optionalUser` it applies to signed-in callers. */
  limit?: ActionKey;
  /** Site-wide hourly/daily ceiling of a cost feature (`globalBudgets`). */
  globalBudget?: BudgetFeature;
  /** Per-client-address budget (`anonymousLimits`) for callers without an account. */
  anonymousLimit?: AnonymousAction;
  /**
   * Per-instance, in-memory ceiling per client address (`burstLimits`), applied to every caller, signed in or not.
   * Use it INSTEAD of `anonymousLimit` for high-frequency reads that cost less than a Firestore transaction
   * (public, cached, read-only); it protects the instance, not the budget. Anything that spends money or writes
   * data keeps the shared Firestore limits above.
   */
  burstLimit?: BurstAction;
  /** Requires marketplace membership (trial or paid). */
  membership?: true;
  /** Bot check run before any budget is spent, when the provider is configured. */
  humanCheck?: HumanCheckAction;
  errors?: ErrorBodies;
};
export type Operation = Shared & (
  | {
    auth: { kind: 'user' | 'optionalUser' };
    /** `active`: restricted and suspended accounts are denied. `any`: they may still call it (reads, cancelling, appeals, cleanup). */
    account: 'active' | 'any';
  }
  | { auth: Exclude<Auth, { kind: 'user' | 'optionalUser' }>; account?: undefined }
);

const signIn = (message: string): ErrorBodies => ({ unauthenticated: { error: message } });
const BILLING: ErrorBodies = {
  unauthenticated: { error: 'SIGN_IN_REQUIRED' }, origin: { error: 'INVALID_ORIGIN' },
  bodyTooLarge: { error: 'BODY_TOO_LARGE' }, bodyInvalid: { error: 'INVALID_BODY' },
};
const MODERATION: ErrorBodies = { origin: { error: 'INVALID_ORIGIN' }, forbidden: { error: 'RECENT_MFA_MODERATOR_REQUIRED' } };
const HEADHUNTER: ErrorBodies = { unauthenticated: { error: HEADHUNTER_API_ERRORS.SIGN_IN }, origin: { error: HEADHUNTER_API_ERRORS.FORBIDDEN } };
const SUPPORT: ErrorBodies = {
  origin: { error: 'הבקשה נדחתה. נא לרענן את העמוד.', code: 'ORIGIN' },
  bodyTooLarge: { error: 'ההודעה ארוכה מדי.', code: 'TOO_LARGE' }, bodyInvalid: { error: 'הבקשה אינה תקינה.', code: 'INVALID' },
};
const SESSION: ErrorBodies = { origin: { error: 'Invalid request origin.' } };
// An MCP client parses JSON-RPC, so every denial the adapter makes in front of the MCP endpoint is a JSON-RPC error with a null id.
const jsonRpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });
const MCP: ErrorBodies = {
  origin: jsonRpcError(-32000, 'Forbidden: this origin may not call the endpoint.'),
  bodyInvalid: jsonRpcError(-32700, 'Parse error'),
  bodyTooLarge: jsonRpcError(-32600, 'Invalid Request: the body is too large.'),
  rateLimited: jsonRpcError(-32000, 'Rate limit reached. Retry after the number of seconds in the Retry-After header.'),
};
const scheduler = (emailEnv: string, audiencePath: `/${string}`, errors?: ErrorBodies) => ({ auth: { kind: 'scheduler' as const, emailEnv, audiencePath }, ...(errors ? { errors } : {}) });

export const operations = {
  // AI generation: the costly operations. Account budget, site-wide budget and a bot check.
  'ai.profile': { auth: { kind: 'user' }, account: 'active', limit: 'ai.profile', globalBudget: 'ai.profile', humanCheck: 'ai_profile', errors: signIn('יש להתחבר כדי לייבא פרופיל.') },
  'ai.projectBrief': { auth: { kind: 'user' }, account: 'active', limit: 'ai.projectBrief', globalBudget: 'ai.projectBrief', humanCheck: 'ai_project_brief', errors: signIn('יש להתחבר כדי להשתמש בכלי הניסוח.') },

  'config.firebase': { auth: { kind: 'public', reason: 'Public web client configuration (API key and project id are not secrets); the sign-in page needs it before any session exists.' } },
  'auth.csrf': { auth: { kind: 'public', reason: 'Issues the one-time CSRF token for signing in; there is no session yet.' } },
  'auth.session.create': { auth: { kind: 'public', reason: 'Signing in: authorised by a CSRF cookie pair and a Firebase ID token verified in the handler.' }, errors: SESSION },
  'auth.session.read': { auth: { kind: 'public', reason: 'Reports the caller\'s own session cookie (null when signed out).' } },
  'auth.session.destroy': { auth: { kind: 'public', reason: 'Signing out must work for any caller, including an expired or invalid session.' }, errors: SESSION },

  'project.list': { auth: { kind: 'optionalUser' }, account: 'any' },
  'project.create': { auth: { kind: 'user' }, account: 'active', limit: 'project.create', errors: signIn('יש להתחבר כדי לפרסם פרויקט.') },
  'project.close': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לסגור פרויקט.') },
  'profile.read': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לצפות בפרופיל.') },
  'profile.update': { auth: { kind: 'user' }, account: 'active', limit: 'profile.update', errors: signIn('יש להתחבר כדי לשמור פרופיל.') },
  'conversation.read': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לצפות בשיחות.') },
  'message.send': { auth: { kind: 'user' }, account: 'active', limit: 'message.send', errors: signIn('יש להתחבר כדי לשלוח הודעה.') },
  'membership.access': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר.') },
  'safety.read': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר לחשבון.') },
  'safety.block': { auth: { kind: 'user' }, account: 'any', limit: 'safety.change', errors: signIn('יש להתחבר לחשבון.') },
  'safety.appeal': { auth: { kind: 'user' }, account: 'any', limit: 'safety.appeal', errors: signIn('יש להתחבר לחשבון.') },
  'savedProject.list': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לצפות בפרויקטים השמורים.') },
  'savedProject.toggle': { auth: { kind: 'user' }, account: 'active', errors: signIn('יש להתחבר כדי לשמור פרויקט.') },
  'mailPreferences.read': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר.') },
  'mailPreferences.update': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר.') },
  'proposal.list': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לצפות בהצעות.') },
  'proposal.create': { auth: { kind: 'user' }, account: 'active', membership: true, limit: 'proposal.create', errors: signIn('יש להתחבר כדי לשלוח הצעה.') },
  'proposal.withdraw': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לבטל הצעה.') },

  'moderation.account.queue': { auth: { kind: 'moderator' }, errors: MODERATION },
  'moderation.account.decide': { auth: { kind: 'moderator' }, errors: MODERATION },
  'moderation.headhunter.queue': { auth: { kind: 'moderator' }, errors: MODERATION },
  'moderation.headhunter.decide': { auth: { kind: 'moderator' }, errors: MODERATION },

  'notifications.unsubscribe.confirm': { auth: { kind: 'public', reason: 'Confirmation page only; it changes nothing, so mail link scanners that GET it cannot unsubscribe anyone.' } },
  'notifications.unsubscribe': { auth: { kind: 'public', reason: 'One-click unsubscribe from an email: authorised by the unguessable per-recipient token in the link, verified in the handler.' }, anonymousLimit: 'notifications.unsubscribe' },
  'notifications.dispatch': scheduler('NOTIFICATIONS_SCHEDULER_EMAIL', '/api/notifications/dispatch'),

  'billing.status': { auth: { kind: 'user' }, account: 'any', errors: BILLING },
  'billing.invoice': { auth: { kind: 'user' }, account: 'any', errors: BILLING },
  'billing.checkout': { auth: { kind: 'user' }, account: 'active', limit: 'billing.checkout', errors: BILLING },
  'billing.card': { auth: { kind: 'user' }, account: 'any', limit: 'billing.checkout', errors: BILLING },
  'billing.confirm': { auth: { kind: 'user' }, account: 'any', limit: 'billing.confirm', errors: BILLING },
  'billing.cancel': { auth: { kind: 'user' }, account: 'any', errors: BILLING },
  'billing.webhook': { auth: { kind: 'public', reason: 'Cardcom callback without a signature: every posted field is ignored and only a Cardcom lookup of the known order can change state.' } },
  'billing.renew': scheduler('BILLING_SCHEDULER_EMAIL', '/api/billing/renew', { notConfigured: { error: 'SCHEDULER_UNAVAILABLE' } }),

  'upload.list': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לצפות במסמכים.') },
  'upload.create': { auth: { kind: 'user' }, account: 'active', limit: 'source.upload', errors: signIn('יש להתחבר כדי לשמור מסמך.') },
  'upload.delete': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי למחוק מסמך.') },

  'dribbble.read': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לצפות בייבוא Dribbble.') },
  'dribbble.disconnect': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי להסיר ייבוא Dribbble.') },
  'dribbble.connect': { auth: { kind: 'user' }, account: 'active' },
  'dribbble.callback': { auth: { kind: 'user' }, account: 'active' },

  'import.xplace.config': { auth: { kind: 'public', reason: 'Tells the UI whether the XPlace import is on; reveals nothing private.' } },
  'import.xplace.project': { auth: { kind: 'user' }, account: 'active', limit: 'import.xplace', globalBudget: 'import.xplace', errors: signIn('יש להתחבר כדי לייבא פרויקט.') },
  'import.xplace.ingest': { auth: { kind: 'user' }, account: 'active', limit: 'import.xplace.ingest', errors: signIn('יש להתחבר כדי לייבא מ־XPlace.') },

  'nango.connections.list': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לצפות בחיבורים.') },
  'nango.connections.delete': { auth: { kind: 'user' }, account: 'any', errors: signIn('יש להתחבר כדי לנתק חיבור.') },
  'nango.session': { auth: { kind: 'user' }, account: 'active', limit: 'oauth.session', errors: signIn('יש להתחבר כדי לחבר חשבון.') },
  'nango.import': { auth: { kind: 'user' }, account: 'active', limit: 'oauth.import', errors: signIn('יש להתחבר כדי לייבא פרופיל.') },

  'maintenance.uploads': scheduler('MAINTENANCE_SCHEDULER_EMAIL', '/api/maintenance/uploads', { notConfigured: { error: 'MAINTENANCE_NOT_CONFIGURED' } }),
  'maintenance.budget': scheduler('BUDGET_ALERT_PUSH_EMAIL', '/api/maintenance/budget'),

  'support.read': { auth: { kind: 'optionalUser' }, account: 'any', errors: SUPPORT },
  'support.message': { auth: { kind: 'optionalUser' }, account: 'any', limit: 'support.message', anonymousLimit: 'support.message', humanCheck: 'support_message', errors: SUPPORT },
  'support.webhook': { auth: { kind: 'public', reason: 'Resend inbound-email webhook: authorised by the Svix signature over the raw body, verified in the handler.' } },
  'support.slack.events': { auth: { kind: 'public', reason: 'Slack Events API webhook: authorised by the Slack request signature over the raw body, verified in the handler.' } },
  'support.slack.interactions': { auth: { kind: 'public', reason: 'Slack interactivity webhook: authorised by the Slack request signature over the raw body, verified in the handler.' } },
  'support.slack.dispatch': scheduler('SUPPORT_SLACK_SCHEDULER_EMAIL', '/api/support/slack/dispatch'),

  'headhunter.read': { auth: { kind: 'user' }, account: 'any', errors: HEADHUNTER },
  'headhunter.apply': { auth: { kind: 'user' }, account: 'active', limit: 'headhunter.edit', errors: HEADHUNTER },
  'headhunter.update': { auth: { kind: 'user' }, account: 'active', limit: 'headhunter.edit', errors: HEADHUNTER },
  'headhunter.handle.check': { auth: { kind: 'user' }, account: 'any', limit: 'headhunter.handle', errors: HEADHUNTER },
  'headhunter.handle.rename': { auth: { kind: 'user' }, account: 'active', limit: 'headhunter.handle', errors: HEADHUNTER },

  // MCP server for AI assistants (src/lib/mcp). Each tool call is authorised under its own operation below by the adapter in src/lib/mcp/policy.ts.
  'mcp.transport': { auth: { kind: 'public', reason: 'MCP endpoint for AI assistants: JSON-RPC over HTTP with no cookies or other ambient credentials; every tool call is authorised separately under its own registry operation by the MCP adapter in src/lib/mcp/policy.ts.' }, burstLimit: 'mcp.request', errors: MCP },
  'catalog.read': { auth: { kind: 'public', reason: 'Static public catalogue (categories, skills, guides, platform facts) already published on indexable pages and in llms.txt.' } },
  'agency.list': { auth: { kind: 'public', reason: 'Indexable agency (headhunter) minisites: name, handle and open-project counts already shown on public pages; no contact data.' } },

  'seo.llms': { auth: { kind: 'public', reason: 'Public crawler/LLM discovery file.' } },
  'seo.llmsFull': { auth: { kind: 'public', reason: 'Public crawler/LLM discovery file.' } },
} as const satisfies Record<string, Operation>;

export type OperationId = keyof typeof operations;
export type OperationOf<Id extends OperationId> = (typeof operations)[Id];
export type AuthKind<Id extends OperationId> = OperationOf<Id>['auth']['kind'];

export function operationFor(id: string): Operation | undefined {
  return Object.hasOwn(operations, id) ? operations[id as OperationId] as Operation : undefined;
}
