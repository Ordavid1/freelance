import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const { readJsonBody, readFormBody } = loadModule('src/lib/security/request-body.ts');
const encode = value => new TextEncoder().encode(value);
const request = (body, headers = {}) => new Request('https://example.test/api/test', { method: 'POST', headers, body });

test('byte limits hold without Content-Length and with understated lengths, including UTF-8', async () => {
  const body = JSON.stringify({ text: 'שלום'.repeat(20) });
  assert.ok(encode(body).byteLength > body.length);
  for (const headers of [{}, { 'content-length': '1' }]) {
    const result = await readJsonBody(request(body, headers), body.length);
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 413);
  }
  const exact = await readJsonBody(request(body), encode(body).byteLength);
  assert.equal(exact.ok, true);
  assert.equal(exact.value.text, 'שלום'.repeat(20));
});

test('chunked oversized requests stop reading and cancel the stream before parsing', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(encode('x'.repeat(100))); },
    cancel() { cancelled = true; },
  });
  const result = await readJsonBody(new Request('https://example.test', { method: 'POST', duplex: 'half', body: stream }), 150);
  assert.equal(result.response.status, 413);
  assert.equal(cancelled, true);
});

test('malformed, non-object and invalid UTF-8 JSON return 400 instead of reaching field access', async () => {
  for (const body of ['null', '[]', 'true', '"text"', '{', new Uint8Array([0xff])]) {
    const result = await readJsonBody(request(body), 1024);
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 400);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
  }
});

test('multipart data is byte-bounded before form parsing and preserves fields/files', async () => {
  const form = new FormData();
  form.set('sourceIds', '["source-1"]');
  form.set('file', new File(['שלום'], 'source.txt', { type: 'text/plain' }));
  const good = await readFormBody(request(form), 4096);
  assert.equal(good.ok, true);
  assert.equal(good.value.get('sourceIds'), '["source-1"]');
  assert.equal(await good.value.get('file').text(), 'שלום');
  // Serialize the browser's multipart body as network bytes. Cancelling Node's
  // synthetic FormData encoder directly has an undici stream-close race.
  const browserRequest = request(form);
  const multipart = await browserRequest.arrayBuffer();
  const bad = await readFormBody(request(multipart, {
    'content-type': browserRequest.headers.get('content-type'), 'content-length': '1',
  }), 8);
  assert.equal(bad.response.status, 413);
});
