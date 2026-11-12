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


const autoreply = await import('../src/lib/support/autoreply.ts');
const inbound = (id, patch = {}) => ({ id, from: 'Dana Levi <dana@example.net>', to: ['owner@example.com'], cc: [], received_for: ['owner@example.com'], subject: 'שאלה על פרויקט', text: 'שלום, רציתי לשאול על התמחור שלכם', html: null, message_id: '<abc@mail.example.net>', headers: { references: '<root@mail.example.net>' }, ...patch });
function run(emailId, email, sent = []) {
  return transport((url, options) => {
    if (options.method === 'POST') { sent.push(JSON.parse(options.body)); return Response.json({ id: 'sent-' + sent.length }); }
    assert.ok(url.includes('/emails/receiving/' + emailId)); return Response.json(email);
  });
}
const hook = (emailId) => webhook.POST(signedRequest({ type: 'email.received', data: { email_id: emailId } }));

test('acknowledges a Hebrew email once, threaded, in Hebrew, and survives webhook redelivery', async () => {
  setup(); const emailId = randomUUID(); const sent = []; const fetch = run(emailId, inbound(emailId), sent);
  try {
    assert.equal((await hook(emailId)).status, 200); assert.equal((await hook(emailId)).status, 200);
    assert.equal(sent.length, 1);
    const mail = sent[0];
    assert.deepEqual(mail.to, ['dana@example.net']); assert.equal(mail.from, env.SUPPORT_FROM_EMAIL);
    assert.equal(mail.subject, 'Re: שאלה על פרויקט');
    assert.equal(mail.headers['In-Reply-To'], '<abc@mail.example.net>'); assert.equal(mail.headers.References, '<root@mail.example.net> <abc@mail.example.net>');
    assert.equal(mail.headers['Auto-Submitted'], 'auto-replied');
    assert.match(mail.text, /^היי Dana!/); assert.match(mail.html, /dir="rtl"/); assert.match(mail.text, /דקות ספורות/);
  } finally { fetch.mock.restore(); }
});
test('English senders get English; the same Message-ID under a new email id is not answered twice', async () => {
  setup(); const first = randomUUID(); const second = randomUUID(); const sent = [];
  const email = inbound(first, { subject: 'Pricing question', text: 'Hi, how much does it cost?' });
  let fetch = run(first, email, sent);
  try { await hook(first); } finally { fetch.mock.restore(); }
  assert.match(sent[0].text, /^Hi Dana!/); assert.match(sent[0].html, /dir="ltr"/);
  fetch = run(second, { ...email, id: second }, sent);
  // The same Message-ID joins the conversation the first copy created, so it is recorded but never acknowledged again.
  try { assert.equal((await (await hook(second)).json()).reason, 'existing-conversation'); } finally { fetch.mock.restore(); }
  assert.equal(sent.length, 1);
});
test('never answers machines, loops, our own addresses, other mailboxes or unauthenticated mail', async () => {
  setup();
  const cases = [
    { from: 'owner@example.com' }, { from: 'Support <support@example.com>' }, { from: 'team@chat.example.com' },
    { from: 'no-reply@example.net' }, { from: 'MAILER-DAEMON@example.net' }, { from: 'not an address' },
    { headers: { 'Auto-Submitted': 'auto-replied' } }, { headers: { Precedence: 'bulk' } }, { headers: { 'List-Unsubscribe': '<mailto:x@example.net>' } },
    { headers: { 'X-Autoreply': 'yes' } }, { headers: { 'Content-Type': 'multipart/report; report-type=delivery-status' } }, { headers: { 'Return-Path': '<>' } },
    { headers: { 'Authentication-Results': 'mx; dkim=fail; spf=pass' } }, { subject: 'Automatic reply: out of office' }, { subject: 'Undeliverable: hello' },
    { to: ['someone-else@example.com'], received_for: ['someone-else@example.com'] },
  ];
  for (const patch of cases) {
    const emailId = randomUUID(); const sent = []; const fetch = run(emailId, inbound(emailId, patch), sent);
    try { assert.equal((await hook(emailId)).status, 200); assert.equal(sent.length, 0, JSON.stringify(patch)); } finally { fetch.mock.restore(); }
  }
});
test('Auto-Submitted: no and a bcc to the inbox still count as human mail', async () => {
  setup(); const emailId = randomUUID(); const sent = [];
  const fetch = run(emailId, inbound(emailId, { to: ['x@example.org'], received_for: ['OWNER@example.com'], headers: { 'Auto-Submitted': 'no' } }), sent);
  try { await hook(emailId); assert.equal(sent.length, 1); } finally { fetch.mock.restore(); }
});
test('per-sender and site-wide rate limits cap replies; failed sends are retryable and refund the allowance', async () => {
  setup(); let count = 0;
  for (let i = 0; i < 5; i++) {
    const emailId = randomUUID(); const sent = []; const fetch = run(emailId, inbound(emailId, { message_id: `<m${i}@x>` }), sent);
    try { await hook(emailId); count += sent.length; } finally { fetch.mock.restore(); }
  }
  assert.equal(count, autoreply.AUTOREPLY_PER_SENDER_PER_DAY);
  setup(); const emailId = randomUUID();
  let fetch = transport((url, options) => options.method === 'POST' ? new Response('boom', { status: 500 }) : Response.json(inbound(emailId)));
  try { assert.equal((await hook(emailId)).status, 503); } finally { fetch.mock.restore(); }
  const sent = []; fetch = run(emailId, inbound(emailId), sent);
  try { assert.equal((await hook(emailId)).status, 200); assert.equal(sent.length, 1); } finally { fetch.mock.restore(); }
  setup(); rows.set('supportRateLimits/autoreply-hour', { window: Math.floor(Date.now() / 3_600_000), count: autoreply.AUTOREPLY_PER_HOUR });
  const blocked = randomUUID(); const none = []; fetch = run(blocked, inbound(blocked), none);
  try { await hook(blocked); assert.equal(none.length, 0); } finally { fetch.mock.restore(); }
});
test('an abandoned in-progress claim is retryable (503), and a failed send refunds the hourly slot', async () => {
  setup(); const emailId = randomUUID(); const sent = [];
  rows.set('supportAutoReplies/' + emailId, { state: 'sending', at: Date.now(), hour: 1 });
  let fetch = run(emailId, inbound(emailId), sent);
  try { assert.equal((await hook(emailId)).status, 503); assert.equal(sent.length, 0); } finally { fetch.mock.restore(); }
  setup(); const other = randomUUID();
  fetch = transport((url, options) => options.method === 'POST' ? new Response('boom', { status: 500 }) : Response.json(inbound(other)));
  try { assert.equal((await hook(other)).status, 503); } finally { fetch.mock.restore(); }
  assert.equal(rows.get('supportRateLimits/autoreply-hour').count, 0);
});
test('kill switch disables replies and chat aliases still reach the chat bridge, not the responder', async () => {
  setup(); process.env.SUPPORT_AUTOREPLY = 'off'; const emailId = randomUUID(); const sent = []; let fetch = run(emailId, inbound(emailId), sent);
  try { await hook(emailId); assert.equal(sent.length, 0); } finally { fetch.mock.restore(); delete process.env.SUPPORT_AUTOREPLY; }
  let replyToken; const reply = randomUUID();
  fetch = transport((url, options) => options.method === 'POST' ? (replyToken = JSON.parse(options.body).reply_to.split('+')[1].split('@')[0], Response.json({ id: 'n' })) : Response.json({ id: reply, from: 'owner@example.com', to: [`chat+${replyToken}@chat.example.com`], received_for: [`chat+${replyToken}@chat.example.com`], text: 'on it', html: null, headers: {}, message_id: '<r@x>', subject: 're' }));
  try {
    await service.sendSupportMessage(config, cookieToken, null, input()); await hook(reply);
    assert.equal((await service.readSupportConversation(cookieToken, null)).messages.length, 2);
  } finally { fetch.mock.restore(); }
});
test('language detection and HTML escaping', () => {
  assert.equal(autoreply.detectLanguage('Hello team, I would like to ask about pricing, שלום'), 'en'); assert.equal(autoreply.detectLanguage('שלום, I need help'), 'he'); assert.equal(autoreply.detectLanguage(''), 'en');
  const mail = autoreply.buildAutoReply('en', '"<script>x</script>" <a@b.co>', 'Hi\r\nBcc: evil@x.co');
  assert.ok(!mail.html.includes('<script>')); assert.ok(!/[\r\n]/.test(mail.subject));
});
