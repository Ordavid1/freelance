import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID, createHmac } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  if (specifier === 'next/server' || specifier === 'next/headers') return next(specifier + '.js', context);
  return next(specifier, context);
} });

// Serial, atomic transaction double: staged writes, no reads after writes.
const rows = new Map(); let tail = Promise.resolve();
const snapshot = (key) => ({ exists: rows.has(key), data: () => rows.get(key), id: key.split('/').at(-1) });
function collection(key) {
  return { doc: (id) => ref(key + '/' + id), orderBy: (_field, direction) => ({ limit: (max) => ({ get: async () => ({ docs: [...rows.keys()].filter((path) => path.startsWith(key + '/') && path.split('/').length === key.split('/').length + 1).sort((a, b) => (rows.get(a).createdAt.toMillis() - rows.get(b).createdAt.toMillis()) * (direction === 'desc' ? -1 : 1)).slice(0, max).map(snapshot) }) }) }) };
}
function ref(key) { return { key, id: key.split('/').at(-1), collection: (name) => collection(key + '/' + name), get: async () => snapshot(key), update: async (data) => { assert.ok(rows.has(key)); rows.set(key, { ...rows.get(key), ...data }); } }; }
const db = { collection, runTransaction(fn) {
  const task = tail.then(async () => {
    const writes = [];
    const tx = { get: async (reference) => { assert.equal(writes.length, 0); return snapshot(reference.key); }, create: (r, data) => writes.push(() => { assert.equal(rows.has(r.key), false); rows.set(r.key, data); }), set: (r, data, options) => writes.push(() => rows.set(r.key, { ...(options?.merge ? rows.get(r.key) : {}), ...data })), update: (r, data) => writes.push(() => { assert.ok(rows.has(r.key)); rows.set(r.key, { ...rows.get(r.key), ...data }); }) };
    const result = await fn(tx); for (const write of writes) write(); return result;
  });
  tail = task.catch(() => {}); return task;
} };
await mock.module('../src/lib/db/firestore.ts', { namedExports: { firestore: () => db } });
let viewer = null;
await mock.module('../src/lib/auth/session.ts', { namedExports: { getCurrentUser: async () => viewer, isSameOrigin: (request) => request.headers.get('origin') === 'https://example.com' } });
let cookieToken;
await mock.module('next/headers.js', { namedExports: { cookies: async () => ({ get: () => cookieToken ? { value: cookieToken } : undefined }) } });
const service = await import('../src/lib/support/service.ts');
const { supportConfig, mailbox } = await import('../src/lib/support/config.ts');
const { limitedBody } = await import('../src/lib/support/http.ts');
const routes = await import('../src/app/api/support/route.ts');
const webhook = await import('../src/app/api/support/webhook/route.ts');
const secret = 'whsec_' + Buffer.from('test-only-signing-key-never-a-real-secret').toString('base64');
const env = { RESEND_API_KEY: 're_test_only', RESEND_WEBHOOK_SECRET: secret, SUPPORT_INBOX_EMAIL: 'owner@example.com', SUPPORT_FROM_EMAIL: 'Support <support@example.com>', SUPPORT_REPLY_DOMAIN: 'chat.example.com', SUPPORT_ALLOWED_REPLY_EMAILS: '' };
const config = { apiKey: env.RESEND_API_KEY, webhookSecret: secret, from: env.SUPPORT_FROM_EMAIL, inbox: 'owner@example.com', replyDomain: 'chat.example.com', allowedSenders: ['owner@example.com'] };
const input = (patch = {}) => ({ id: randomUUID(), text: 'אפשר עזרה בפרויקט?', name: 'Test', email: 'visitor@example.net', page: '/projects', ...patch });
function setup() { rows.clear(); viewer = null; cookieToken = service.newSupportToken(); Object.assign(process.env, env); }
function transport(handler) { return mock.method(globalThis, 'fetch', async (url, options) => handler(String(url), options)); }
function received(emailId, replyToken, patch = {}) {
  return { id: emailId, from: 'Owner <owner@example.com>', to: [`chat+${replyToken}@chat.example.com`], received_for: [`chat+${replyToken}@chat.example.com`], text: 'בשמחה, הכל מסודר!\n\nOn Tue, Support wrote:\n> Original notification', html: null, headers: {}, ...patch };
}
function signedRequest(event, bad = false) {
  const payload = JSON.stringify(event); const id = 'msg_test'; const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return new Request('https://example.com/api/support/webhook', { method: 'POST', body: payload, headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': 'v1,' + (bad ? 'invalid' : signature) } });
}

test('configuration waits for both secrets and verified sender/receiving settings', () => {
  setup(); assert.ok(supportConfig());
  for (const key of ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'SUPPORT_FROM_EMAIL', 'SUPPORT_REPLY_DOMAIN']) {
    const saved = process.env[key]; process.env[key] = ''; assert.equal(supportConfig(), null, key); process.env[key] = saved;
  }
  process.env.SUPPORT_ALLOWED_REPLY_EMAILS = 'team@example.com, other@example.com';
  assert.deepEqual(supportConfig().allowedSenders, ['owner@example.com', 'team@example.com', 'other@example.com']);
  assert.equal(mailbox('Owner <OWNER@example.com>'), 'owner@example.com');
  assert.equal(mailbox('Owner\r\nBcc: bad@example.com'), null);
});
test('input validation bounds message/contact data, strips URL queries, and rejects the honeypot', () => {
  setup(); const valid = input({ text: ' hi ', email: 'VISITOR@example.net', page: 'https://attacker.test/?private=x' });
  assert.equal(service.visitorMessage(valid).text, 'hi'); assert.equal(service.visitorMessage(valid).email, 'visitor@example.net'); assert.equal(service.visitorMessage(valid).page, '/');
  for (const patch of [{ id: '../x' }, { text: '' }, { text: 'x'.repeat(4001) }, { email: 'bad' }, { name: 'Test\nBcc: x' }, { website: 'bot' }]) assert.throws(() => service.visitorMessage(input(patch)), { code: 'INVALID' });
});
test('anonymous chat creates a private route and notification; identical retries do not re-send', async () => {
  setup(); const request = input(); let sends = 0; let payload;
  const fetch = transport((_url, options) => { sends++; payload = JSON.parse(options.body); assert.ok(new Headers(options.headers).get('idempotency-key')); return Response.json({ id: 'sent-1' }); });
  try {
    const sent = await service.sendSupportMessage(config, cookieToken, null, request);
    assert.equal(sent.delivery, 'sent'); assert.equal(sends, 1);
    assert.deepEqual(payload.to, ['owner@example.com']); assert.match(payload.reply_to, /^chat\+[a-f0-9]{32}@chat\.example\.com$/); assert.match(payload.text, /visitor@example.net/);
    assert.equal((await service.sendSupportMessage(config, cookieToken, null, request)).delivery, 'sent'); assert.equal(sends, 1);
    const conversation = await service.readSupportConversation(cookieToken, null);
    assert.equal(conversation.messages.length, 1); assert.equal(JSON.stringify(conversation).includes('replyToken'), false); assert.equal(JSON.stringify(conversation).includes('emailId'), false);
    assert.equal(await service.readSupportConversation(service.newSupportToken(), null), null);
  } finally { fetch.mock.restore(); }
});
test('failed deliveries retry with the same provider key and payload; changed reuse is rejected', async () => {
  setup(); const request = input(); const attempts = [];
  const fetch = transport((_url, options) => { attempts.push({ body: options.body, headers: Object.fromEntries(new Headers(options.headers)) }); return attempts.length === 1 ? Response.json({ name: 'internal_server_error', message: 'provider unavailable' }, { status: 500 }) : Response.json({ id: 'sent-2' }); });
  try {
    await assert.rejects(() => service.sendSupportMessage(config, cookieToken, null, request), { code: 'SEND_FAILED' });
    assert.equal((await service.readSupportConversation(cookieToken, null)).messages[0].delivery, 'failed');
    await service.sendSupportMessage(config, cookieToken, null, request); assert.deepEqual(attempts[0], attempts[1]);
    await assert.rejects(() => service.sendSupportMessage(config, cookieToken, null, { ...request, text: 'changed' }), { code: 'CONFLICT' });
    assert.equal(rows.get('supportRateLimits/outbound-hour').count, 1);
  } finally { fetch.mock.restore(); }
});
test('concurrent sends reserve one message and share one Resend idempotency key', async () => {
  setup(); const request = input(); const keys = [];
  const fetch = transport((_url, options) => { keys.push(new Headers(options.headers).get('idempotency-key')); return Response.json({ id: 'same-provider-email' }); });
  try {
    await Promise.all([service.sendSupportMessage(config, cookieToken, null, request), service.sendSupportMessage(config, cookieToken, null, request)]);
    assert.equal((await service.readSupportConversation(cookieToken, null)).messages.length, 1);
    assert.deepEqual(keys[0], keys.at(-1)); assert.equal(rows.get('supportRateLimits/outbound-hour').count, 1);
  } finally { fetch.mock.restore(); }
});
test('account-bound chat is inaccessible after signout or from a different account', async () => {
  setup(); const fetch = transport(() => Response.json({ id: 'sent' }));
  try {
    await service.sendSupportMessage(config, cookieToken, { uid: 'alice' }, input());
    for (const user of [null, { uid: 'bob' }]) {
      await assert.rejects(() => service.readSupportConversation(cookieToken, user), { code: 'SESSION_CHANGED' });
      await assert.rejects(() => service.sendSupportMessage(config, cookieToken, user, input()), { code: 'SESSION_CHANGED' });
    }
    assert.equal((await service.readSupportConversation(cookieToken, { uid: 'alice' })).messages.length, 1);
  } finally { fetch.mock.restore(); }
});
test('conversation and global outbound budgets persist across clients and reset by window', async () => {
  setup(); const fetch = transport(() => Response.json({ id: 'sent' }));
  try {
    for (let i = 0; i < 10; i++) await service.sendSupportMessage(config, cookieToken, null, input());
    await assert.rejects(() => service.sendSupportMessage(config, cookieToken, null, input()), { code: 'RATE_LIMIT' });
    rows.set('supportRateLimits/outbound-hour', { window: Math.floor(Date.now() / 3_600_000), count: 100 });
    await assert.rejects(() => service.sendSupportMessage(config, service.newSupportToken(), null, input()), { code: 'RATE_LIMIT' });
    rows.set('supportRateLimits/outbound-hour', { window: Math.floor(Date.now() / 3_600_000) - 1, count: 100 });
    await service.sendSupportMessage(config, service.newSupportToken(), null, input()); assert.equal(rows.get('supportRateLimits/outbound-hour').count, 1);
  } finally { fetch.mock.restore(); }
});
test('real signed webhook retrieves the owner reply and adds it once to the matching chat', async () => {
  setup(); let replyToken; const emailId = randomUUID(); let reads = 0;
  const fetch = transport((url, options) => {
    if (options.method === 'POST') { replyToken = JSON.parse(options.body).reply_to.split('+')[1].split('@')[0]; return Response.json({ id: 'sent' }); }
    assert.ok(url.includes('/emails/receiving/' + emailId)); reads++; return Response.json(received(emailId, replyToken));
  });
  try {
    await service.sendSupportMessage(config, cookieToken, null, input());
    const event = { type: 'email.received', data: { email_id: emailId } };
    assert.equal((await webhook.POST(signedRequest(event, true))).status, 401); assert.equal(reads, 0);
    const deliveries = await Promise.all([webhook.POST(signedRequest(event)), webhook.POST(signedRequest(event))]);
    assert.ok(deliveries.every((response) => response.status === 200));
    assert.equal((await webhook.POST(signedRequest(event))).status, 200);
    const chat = await service.readSupportConversation(cookieToken, null);
    assert.equal(chat.messages.length, 2); assert.equal(chat.messages[1].sender, 'support'); assert.equal(chat.messages[1].text, 'בשמחה, הכל מסודר!');
    assert.equal(reads, 2);
  } finally { fetch.mock.restore(); }
});
test('unknown senders, wrong routes, auto replies and ambiguous recipients never enter chats', async () => {
  setup(); const send = transport(() => Response.json({ id: 'sent' }));
  await service.sendSupportMessage(config, cookieToken, null, input()); send.mock.restore();
  const conversation = rows.get('supportConversations/' + service.digest(cookieToken));
  const route = `chat+${conversation.replyToken}@chat.example.com`;
  for (const patch of [{ from: 'attacker@example.net' }, { received_for: ['chat+' + '0'.repeat(32) + '@chat.example.com'] }, { headers: { 'Auto-Submitted': 'auto-replied' } }, { headers: { Precedence: 'bulk' } }, { received_for: [route, 'chat+' + '0'.repeat(32) + '@chat.example.com'] }]) {
    const emailId = randomUUID(); const fetch = transport(() => Response.json(received(emailId, conversation.replyToken, patch)));
    try { assert.equal((await service.receiveSupportReply(config, emailId)).ignored, true); } finally { fetch.mock.restore(); }
  }
  assert.equal((await service.readSupportConversation(cookieToken, null)).messages.length, 1);
});
test('HTML-only replies become plain text, and English/Hebrew quotations and signatures are removed', () => {
  assert.equal(service.extractSupportReply(null, '<p>Hello &amp; welcome</p><script>alert(1)</script>'), 'Hello & welcome');
  assert.equal(service.extractSupportReply('תודה!\n\nבתאריך יום ג׳ כתב Owner:\n> הודעה קודמת', null), 'תודה!');
  assert.equal(service.extractSupportReply('Hello\n\nSent from my iPhone\n\nOn Tue, Someone wrote:\n> old', null), 'Hello');
  assert.equal(service.extractSupportReply('x'.repeat(5000), null).length, 4000);
});
test('actual streamed bytes are bounded even when Content-Length is missing', async () => {
  await assert.rejects(() => limitedBody(new Request('https://example.com', { method: 'POST', body: 'x'.repeat(20_000) })), { code: 'TOO_LARGE' });
  assert.equal(await limitedBody(new Request('https://example.com', { method: 'POST', body: 'שלום' })), 'שלום');
});
test('session endpoint creates an HttpOnly cookie, and mutations reject cross-origin requests', async () => {
  setup(); cookieToken = undefined;
  const session = await routes.GET(); assert.equal(session.status, 200);
  assert.match(session.headers.get('set-cookie'), /fz_support=.*HttpOnly/i); assert.match(session.headers.get('set-cookie'), /Path=\/api\/support/i);
  assert.match(session.headers.get('cache-control'), /no-store/);
  const crossOrigin = new Request('https://example.com/api/support', { method: 'POST', headers: { origin: 'https://attacker.test', 'content-type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal((await routes.POST(crossOrigin)).status, 403);
  process.env.RESEND_API_KEY = '';
  assert.equal((await (await routes.GET()).json()).configured, false);
});
