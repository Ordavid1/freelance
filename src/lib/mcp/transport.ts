import 'server-only';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp/server';
import type { McpCaller } from '@/lib/mcp/policy';

// One MCP request over stateless streamable HTTP. A server and a transport are created per request (the transport
// refuses to be reused without sessions) and closed afterwards. The body was read and validated by the HTTP adapter
// (`route()`), so it is handed to the transport as `parsedBody`.

const LOG_FIELD_LIMIT = 64;
// Whatever a client declares about itself is logged only as printable ASCII, capped; anything else is dropped.
const ascii = (value: unknown) => (typeof value === 'string' ? value.replace(/[^\x20-\x7E]/g, '').trim().slice(0, LOG_FIELD_LIMIT) : '');
const errorName = (error: unknown) => (typeof (error as { name?: unknown } | null)?.name === 'string' ? (error as { name: string }).name : 'Error');

function declaredClient(body: Record<string, unknown>) {
  if (body.method !== 'initialize') return {};
  const info = (body.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
  const clientName = ascii(info?.name);
  const clientVersion = ascii(info?.version);
  return { ...(clientName ? { clientName } : {}), ...(clientVersion ? { clientVersion } : {}) };
}

// One line per request: the JSON-RPC method, the status and the duration. Never params, arguments or addresses.
function logRequest(body: Record<string, unknown>, status: number, started: number) {
  const severity = status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO';
  const log = status >= 500 ? console.error : status >= 400 ? console.warn : console.info;
  log(JSON.stringify({ event: 'mcp_request', severity, method: ascii(body.method) || 'unknown', status, ms: Date.now() - started, ...declaredClient(body) }));
}

async function quietly(close: () => Promise<void>) {
  try { await close(); } catch { /* the response is already built */ }
}

export async function serveMcp(request: Request, body: Record<string, unknown>, caller: McpCaller): Promise<Response> {
  const started = Date.now();
  const server = createMcpServer(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  let response: Response;
  try {
    await server.connect(transport);
    response = await transport.handleRequest(request, { parsedBody: body });
  } catch (error) {
    console.error(JSON.stringify({ event: 'mcp_transport_error', severity: 'ERROR', error: errorName(error) }));
    response = Response.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }, { status: 500 });
  } finally {
    await quietly(() => server.close());
    await quietly(() => transport.close());
  }
  logRequest(body, response.status, started);
  // The result is private to the caller and never an indexable page.
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
