import type { z } from 'zod';
import type { McpTool } from '@/lib/mcp/policy';
import type { OperationId } from '@/lib/security/operations';

/** Every tool of this server only reads public data. Hints are advisory (clients may ignore them); the registry is what enforces it. */
export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/**
 * A tool as the server registers it: the policy-bound handler (`defineTool`) plus what a client sees of it. Input and
 * output are zod shapes; the handler gets the parsed input (defaults applied) and returns the structured result, or
 * `null` when the thing asked for does not exist (the server then answers with `missing`).
 */
export type ToolSpec<I extends z.ZodRawShape, O extends z.ZodRawShape> = {
  title: string;
  description: string;
  input: I;
  output: O;
  missing?: string;
  tool: McpTool<OperationId, z.output<z.ZodObject<I>>, z.output<z.ZodObject<O>> | null>;
};
export const toolSpec = <I extends z.ZodRawShape, O extends z.ZodRawShape>(spec: ToolSpec<I, O>) => spec;
