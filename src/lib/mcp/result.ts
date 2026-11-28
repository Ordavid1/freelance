import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpOutcome } from '@/lib/mcp/policy';

/**
 * The MCP form of a tool outcome. Success carries the data twice, as `structuredContent` and as the same JSON in a text
 * block (older clients read only the text). A failed outcome, or a lookup that found nothing (`null` data and a
 * `missing` message), is an error result the assistant can read and act on; it never carries internals.
 */
export function toToolResult<O extends object>(outcome: McpOutcome<O | null>, missing = 'Nothing was found.'): CallToolResult {
  if (!outcome.ok) return { isError: true, content: [{ type: 'text', text: outcome.error }] };
  if (outcome.data === null) return { isError: true, content: [{ type: 'text', text: missing }] };
  return { content: [{ type: 'text', text: JSON.stringify(outcome.data) }], structuredContent: outcome.data as Record<string, unknown> };
}
