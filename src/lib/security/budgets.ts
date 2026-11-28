import 'server-only';
import { enforceBurstLimit } from '@/lib/security/burst-limit';
import type { Operation } from '@/lib/security/operations';

/**
 * The budget step of the registry, independent of the transport: the HTTP adapter (policy.ts) and the MCP
 * adapter (src/lib/mcp/policy.ts) both call this, so an operation spends the same budgets whichever door it came through.
 * Returns the response to send when a budget is exhausted (or cannot be checked), null otherwise: the limiter's 429, with
 * the body of `errors.rateLimited` when the operation declares one (status and headers, Retry-After included, are kept).
 *
 *   1. burst limit     per client address, every caller; in memory, so it runs first and a flood never reaches Firestore
 *   2. account limit   signed-in callers
 *   3. address limit   callers without an account
 *   4. site budget     one shared counter per cost feature
 *
 * Firestore-backed limits are loaded only when the operation declares one.
 */
export async function enforceOperationBudgets(operation: Operation, user: { uid: string } | null, ip: string): Promise<Response | null> {
  const refuse = (limited: Response) => limited.status !== 429 || operation.errors?.rateLimited === undefined ? limited : Response.json(operation.errors.rateLimited, { status: limited.status, headers: limited.headers });
  if (operation.burstLimit) {
    const limited = enforceBurstLimit(ip, operation.burstLimit);
    if (limited) return refuse(limited);
  }
  if (!operation.limit && !operation.anonymousLimit && !operation.globalBudget) return null;
  const { enforceActionLimit, enforceAnonymousLimit, enforceGlobalBudget } = await import('@/lib/security/rate-limit');
  if (operation.limit && user) {
    const limited = await enforceActionLimit(user.uid, operation.limit);
    if (limited) return refuse(limited);
  }
  if (operation.anonymousLimit && !user) {
    const limited = await enforceAnonymousLimit(ip, operation.anonymousLimit);
    if (limited) return refuse(limited);
  }
  if (operation.globalBudget) {
    const limited = await enforceGlobalBudget(operation.globalBudget);
    if (limited) return refuse(limited);
  }
  return null;
}
