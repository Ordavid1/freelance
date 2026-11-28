import 'server-only';
import { enforceOperationBudgets } from '@/lib/security/budgets';
import { operationFor } from '@/lib/security/operations';
import type { OperationId } from '@/lib/security/operations';

// The MCP adapter of the operation registry (security/operations.ts), the counterpart of `route()` in security/policy.ts.
// A tool cannot exist without a registry entry:
//
//   export const searchProjects = defineTool({ name: 'search_projects', operation: 'project.list', run: async (input: Input, caller) => { ... } });
//
// Definition time refuses an operation this endpoint cannot authorise yet. At call time, before the handler runs, it
// applies the same budget step as the HTTP adapter (burst limit, then Firestore budgets) for an anonymous caller.
// A tool never sees a Request: it gets a typed caller and returns data, and a failure becomes a generic message.
// Phase 2 (OAuth) adds signed-in callers here; until then only operations an anonymous caller may use can be tools.

/** Who is calling. `ip` is the normalised client address from `clientIp(request)` (security/client-ip.ts). */
export type McpCaller = { ip: string; user: null };

export type McpOutcome<T> = { ok: true; data: T } | { ok: false; error: string; retryAfter?: number };

/** What a caller sees when a handler fails: never a stack, a message or anything internal. */
export const MCP_GENERIC_ERROR = 'The request could not be completed. Try again later.';

export type McpTool<Id extends OperationId, I, O> = {
  name: string;
  operation: Id;
  call: (input: I, caller: McpCaller) => Promise<McpOutcome<O>>;
};

type ToolOutcome = 'ok' | 'denied' | 'error';

// A budget denial is the limiter's HTTP response, whose body is the site's Hebrew message. A tool caller is an
// assistant working in English, so the message is built here from the one machine-readable part, Retry-After.
const REFUSED = 'The request was refused.';
function denial(response: Response): { error: string; retryAfter?: number } {
  const retryAfter = Math.ceil(Number(response.headers.get('Retry-After')));
  if (response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
    return { error: `Rate limit reached. Retry after ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}.`, retryAfter };
  }
  return { error: REFUSED };
}

// Only the class name is logged, never the message (it may carry user input or internals).
const errorName = (error: unknown) => (typeof (error as { name?: unknown } | null)?.name === 'string' ? (error as { name: string }).name : 'Error');

/** Wraps a handler into a tool under the registered policy of `operation`. Throws when the registry cannot authorise it. */
export function defineTool<Id extends OperationId, I, O>(definition: {
  name: string;
  operation: Id;
  run: (input: I, caller: McpCaller) => Promise<O>;
}): McpTool<Id, I, O> {
  const { name, operation: id, run } = definition;
  const operation = operationFor(id);
  if (!operation) throw new Error(`Unknown operation: ${id}`);
  const refuse = (why: string) => { throw new Error(`${name} (${id}): ${why}`); };
  if (operation.auth.kind === 'user' || operation.auth.kind === 'moderator' || operation.auth.kind === 'scheduler') refuse(`the MCP endpoint has no ${operation.auth.kind} identity yet`);
  if (operation.account === 'active') refuse('it needs an active signed-in account');
  if (operation.membership) refuse('it needs marketplace membership');
  // The bot check is bound to a browser request; a tool call that skipped it would bypass the operation's protection.
  if (operation.humanCheck) refuse('it needs a human check, which a tool call cannot provide');

  return {
    name,
    operation: id,
    async call(input, caller) {
      const started = Date.now();
      let outcome: ToolOutcome = 'ok';
      try {
        const denied = await enforceOperationBudgets(operation, null, caller.ip);
        if (denied) {
          outcome = 'denied';
          return { ok: false, ...denial(denied) };
        }
        return { ok: true, data: await run(input, caller) };
      } catch (error) {
        outcome = 'error';
        console.error(JSON.stringify({ event: 'mcp_tool_error', severity: 'ERROR', tool: name, operation: id, error: errorName(error) }));
        return { ok: false, error: MCP_GENERIC_ERROR };
      } finally {
        // One line per call; no address and no arguments.
        console.info(JSON.stringify({ event: 'mcp_tool_call', severity: 'INFO', tool: name, operation: id, outcome, ms: Date.now() - started }));
      }
    },
  };
}
