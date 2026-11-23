import 'server-only';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { clientIp, UNKNOWN_CLIENT } from '@/lib/security/client-ip';
import { humanCheckEnabled, verifyHumanCheck } from '@/lib/security/human-check';
import { operationFor } from '@/lib/security/operations';
import type { AuthKind, ErrorBodies, Operation, OperationId } from '@/lib/security/operations';
import { readFormBody, readJsonBody, readRawBody } from '@/lib/security/request-body';

// The HTTP adapter of the operation registry (operations.ts). Every exported method of every route.ts is
//
//   export const POST = route('project.create', { body: { type: 'json', maxBytes: 24_000 } }, async ({ user, body }) => { ... });
//
// and runs, in this order, before the handler sees the request:
//
//   1. gate           feature flag of the route (optional; answers before anything else is revealed)
//   2. same origin    mutating methods only; skipped for scheduler calls and for `sameOrigin: false` (public only)
//   3. authentication user | optionalUser | moderator | scheduler OIDC | public
//   4. account state  `active` operations refuse restricted and suspended accounts
//   5. membership     operations that need marketplace access
//   6. human check    only when a provider is configured (human-check.ts)
//   7. budgets        per-account limit, per-address limit (callers without an account), site-wide budget
//   8. body           read with a hard byte cap: json | form | raw
//
// Heavy modules (Firestore-backed policies, the OIDC client) are loaded when an operation needs them.

export type BodySpec = { type: 'json' | 'form' | 'raw'; maxBytes: number };
type BodyOf<B> = B extends { type: 'json' } ? Record<string, unknown> : B extends { type: 'form' } ? FormData : B extends { type: 'raw' } ? Uint8Array : undefined;
type UserOf<K> = K extends 'user' ? AuthenticatedUser : K extends 'optionalUser' ? AuthenticatedUser | null : K extends 'moderator' ? { uid: string } : null;

export type GateOk = { ok: true };
export type GateResult<G extends GateOk> = G | { ok: false; response: Response };

export type RouteOptions<B extends BodySpec | undefined, G extends GateOk> = {
  /** Byte-capped body, read after every check above. Omit when the handler needs no body or reads it itself. */
  body?: B;
  /** Feature flag of the route. Runs first; a failure answers immediately. Its success value is passed to the handler. */
  gate?: (request: Request) => GateResult<G> | Promise<GateResult<G>>;
  /** `false` skips the same-origin check of a mutating method. Only operations with `public` auth may opt out (unsigned webhooks, mail-client one-click links). */
  sameOrigin?: boolean;
  /** Answers a missing session with something other than the registry's JSON 401 (an OAuth redirect to the sign-in page). */
  onUnauthenticated?: (request: Request) => Response | Promise<Response>;
  /**
   * Spend the operation's budgets when the handler calls `charge()` instead of before the body is read, so
   * requests rejected as invalid never use budget. The handler MUST call `charge()` before doing the work.
   */
  deferBudgets?: boolean;
};

export type RouteContext<Id extends OperationId, B extends BodySpec | undefined, G extends GateOk> = {
  request: Request;
  user: UserOf<AuthKind<Id>>;
  body: BodyOf<B>;
  /** Normalised client address (IPv4, or the IPv6 /64). See client-ip.ts. */
  ip: string;
  gate: G;
  operation: Id;
  /** Runs the budgets of `deferBudgets` routes; returns the response to send when one is exhausted. A no-op otherwise. */
  charge: () => Promise<Response | null>;
};

const deny = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function verifyScheduler(request: Request, auth: Extract<Operation['auth'], { kind: 'scheduler' }>, errors: ErrorBodies | undefined) {
  const expected = process.env[auth.emailEnv];
  if (!expected) return deny(errors?.notConfigured ?? { error: 'NOT_CONFIGURED' }, 503);
  const idToken = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (!idToken) return deny(errors?.unauthorized ?? { error: 'UNAUTHORIZED' }, 401);
  try {
    const { OAuth2Client } = await import('google-auth-library');
    const { publicAppOrigin } = await import('@/lib/auth/session');
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken,
      audience: `${publicAppOrigin(request)}${auth.audiencePath}`,
    });
    const token = ticket.getPayload();
    if (token?.email !== expected || token.email_verified !== true) throw new Error('Caller is not the expected service account');
  } catch { return deny(errors?.unauthorized ?? { error: 'UNAUTHORIZED' }, 401); }
  return null;
}

async function spendBudgets(operation: Operation, user: AuthenticatedUser | null, ip: string): Promise<Response | null> {
  if (!operation.limit && !operation.anonymousLimit && !operation.globalBudget) return null;
  const { enforceActionLimit, enforceAnonymousLimit, enforceGlobalBudget } = await import('@/lib/security/rate-limit');
  if (operation.limit && user) {
    const limited = await enforceActionLimit(user.uid, operation.limit);
    if (limited) return limited;
  }
  if (operation.anonymousLimit && !user) {
    const limited = await enforceAnonymousLimit(ip, operation.anonymousLimit);
    if (limited) return limited;
  }
  if (operation.globalBudget) {
    const limited = await enforceGlobalBudget(operation.globalBudget);
    if (limited) return limited;
  }
  return null;
}

async function readBody(request: Request, spec: BodySpec, errors: ErrorBodies | undefined): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const parsed = spec.type === 'json' ? await readJsonBody(request, spec.maxBytes)
    : spec.type === 'form' ? await readFormBody(request, spec.maxBytes)
    : await readRawBody(request, spec.maxBytes);
  if (parsed.ok) return parsed;
  const custom = parsed.response.status === 413 ? errors?.bodyTooLarge : errors?.bodyInvalid;
  return custom === undefined ? parsed : { ok: false, response: deny(custom, parsed.response.status) };
}

/** Wraps a handler into a Next.js route handler under the registered policy of `operationId`. */
export function route<Id extends OperationId, B extends BodySpec | undefined = undefined, G extends GateOk = GateOk>(
  operationId: Id,
  options: RouteOptions<B, G>,
  handler: (context: RouteContext<Id, B, G>) => Response | Promise<Response>,
) {
  const operation = operationFor(operationId);
  if (!operation) throw new Error(`Unknown operation: ${operationId}`);
  const { auth, errors } = operation;
  if (options.sameOrigin === false && auth.kind !== 'public') throw new Error(`${operationId}: only public operations may skip the same-origin check`);
  if (operation.limit && auth.kind !== 'user' && auth.kind !== 'optionalUser') throw new Error(`${operationId}: a per-account limit needs a signed-in caller`);

  return async function policyHandler(request: Request): Promise<Response> {
    let gate = { ok: true } as G;
    if (options.gate) {
      const gated = await options.gate(request);
      if (!gated.ok) return gated.response;
      gate = gated;
    }

    // A route handler is called with a request by Next.js; unit tests sometimes call a plain GET() without one.
    const method = request?.method?.toUpperCase() ?? 'GET';
    const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    // Scheduler calls carry a bearer token, not browser credentials, so there is no origin to check.
    if (mutating && auth.kind !== 'scheduler' && options.sameOrigin !== false && !isSameOrigin(request)) return deny(errors?.origin ?? { error: 'הבקשה נדחתה.' }, 403);

    let user: AuthenticatedUser | null = null;
    let moderator: { uid: string } | null = null;
    switch (auth.kind) {
      case 'user':
      case 'optionalUser':
        user = await getCurrentUser();
        if (!user && auth.kind === 'user') return options.onUnauthenticated ? options.onUnauthenticated(request) : deny(errors?.unauthenticated ?? { error: 'יש להתחבר.' }, 401);
        break;
      case 'moderator': {
        const { moderatorUid } = await import('@/lib/security/moderator');
        const uid = await moderatorUid();
        if (!uid) return deny(errors?.forbidden ?? { error: 'FORBIDDEN' }, 403);
        moderator = { uid };
        break;
      }
      case 'scheduler': {
        const denied = await verifyScheduler(request, auth, errors);
        if (denied) return denied;
        break;
      }
      case 'public':
        break;
    }

    if (user && operation.account === 'active') {
      const { accountWriteDenied } = await import('@/lib/security/marketplace-policy');
      const denied = await accountWriteDenied(user.uid);
      if (denied) return denied;
    }
    if (operation.membership && user) {
      const { requireMarketplaceAccess } = await import('@/lib/membership/access');
      const denied = await requireMarketplaceAccess(user.uid);
      if (denied) return denied;
    }
    if (operation.humanCheck && humanCheckEnabled(operation.humanCheck)) {
      const denied = await verifyHumanCheck(request, operation.humanCheck);
      if (denied) return denied;
    }

    const ip = request ? clientIp(request) : UNKNOWN_CLIENT;
    let charge = async (): Promise<Response | null> => null;
    if (options.deferBudgets) {
      let spent = false;
      charge = async () => spent ? null : (spent = true, spendBudgets(operation, user, ip));
    } else {
      const denied = await spendBudgets(operation, user, ip);
      if (denied) return denied;
    }

    let body: unknown;
    if (options.body) {
      const parsed = await readBody(request, options.body, errors);
      if (!parsed.ok) return parsed.response;
      body = parsed.value;
    }

    return handler({ request, user: (user ?? moderator) as RouteContext<Id, B, G>['user'], body: body as BodyOf<B>, ip, gate, operation: operationId, charge });
  };
}
