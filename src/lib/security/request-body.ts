// Bound the bytes read from the stream; Content-Length is only an early hint.
// In particular, chunked requests and understated lengths must have the same cap.
class BodyTooLarge extends Error {}

async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

type Result<T> = { ok: true; value: T } | { ok: false; response: Response };
function failure(error: unknown): Result<never> {
  const oversized = error instanceof BodyTooLarge;
  return { ok: false, response: Response.json({
    code: oversized ? 'BODY_TOO_LARGE' : 'INVALID_BODY',
    error: oversized ? 'הבקשה גדולה מדי.' : 'תוכן הבקשה אינו תקין.',
  }, { status: oversized ? 413 : 400, headers: { 'Cache-Control': 'no-store' } }) };
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<Result<Record<string, unknown>>> {
  try {
    const bytes = await readBytes(request, maxBytes);
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) { return failure(error); }
}

export async function readFormBody(request: Request, maxBytes: number): Promise<Result<FormData>> {
  try {
    const bytes = await readBytes(request, maxBytes);
    const value = await new Response(bytes as BodyInit, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    return { ok: true, value };
  } catch (error) { return failure(error); }
}
