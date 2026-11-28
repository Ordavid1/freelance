import { serveMcp } from '@/lib/mcp/transport';
import { operationFor } from '@/lib/security/operations';
import { route, type GateResult, type GateOk } from '@/lib/security/policy';
import { featureEnabled } from '@/lib/security/runtime-switch';
import { SITE_URL } from '@/lib/seo/site';

// The public MCP endpoint (src/lib/mcp): stateless streamable HTTP, JSON responses, POST only. GET and DELETE fall through to
// Next.js's 405, which the MCP specification allows for a server that sends no server-initiated stream. A JSON-RPC batch
// (an array) is refused by the body reader; the JSON-RPC error bodies of every denial are declared on the registry entry.
export const dynamic = 'force-dynamic';

const refusal = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// 1. The endpoint does not exist while the switch is off. 2. Per the MCP transport specification a request that carries an
// Origin header from another site is refused (DNS rebinding and browser pages calling a local or private server); callers
// that are not browsers send none. No CORS headers are ever set, so a browser page of another site cannot read a reply either.
async function gate(request: Request): Promise<GateResult<GateOk>> {
  if (!(await featureEnabled('mcp'))) return { ok: false, response: new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }) };
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== SITE_URL) return { ok: false, response: refusal(operationFor('mcp.transport')?.errors?.origin, 403) };
  return { ok: true };
}

export const POST = route('mcp.transport', { sameOrigin: false, gate, body: { type: 'json', maxBytes: 64_000 } },
  ({ request, body, ip }) => serveMcp(request, body, { ip, user: null }));
