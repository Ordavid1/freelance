import 'server-only';
import { NextResponse } from 'next/server';

export class SupportError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function supportJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
export function supportFailure(error: unknown) {
  if (error instanceof SupportError) return supportJson({ error: error.message, code: error.code }, error.status);
  // Never log email bodies, contact details, cookies or provider error payloads.
  console.error('support_request_failed');
  return supportJson({ error: 'לא הצלחנו להתחבר כרגע. אפשר לנסות שוב.', code: 'UNAVAILABLE' }, 503);
}
export async function limitedBody(request: Request, max = 16_000) {
  if (Number(request.headers.get('content-length')) > max) throw new SupportError('TOO_LARGE', 413, 'ההודעה ארוכה מדי.');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new SupportError('TOO_LARGE', 413, 'ההודעה ארוכה מדי.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
