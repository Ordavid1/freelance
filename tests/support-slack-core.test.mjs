import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  if (specifier === 'next/server' || specifier === 'next/headers') return next(specifier + '.js', context);
  return next(specifier, context);
} });

// Serial, atomic transaction double with the query subset the Slack outbox uses (where, orderBy, limit).
const rows = new Map(); let tail = Promise.resolve();
const isDelete = (value) => value?.constructor?.name === 'DeleteTransform';
const millis = (value) => (value && typeof value.toMillis === 'function' ? value.toMillis() : value);
function apply(key, data, merge) {
  const next = merge ? { ...(rows.get(key) || {}) } : {};
  for (const [field, value] of Object.entries(data)) { if (isDelete(value)) delete next[field]; else next[field] = value; }
  rows.set(key, next);
}
const snapshot = (key) => ({ exists: rows.has(key), data: () => rows.get(key), id: key.split('/').at(-1) });
function query(path, filters = [], order = null, max = Infinity) {
  const depth = path.split('/').length + 1;
  return {
    doc: (id) => ref(path + '/' + id),
    where: (field, op, value) => query(path, [...filters, { field, op, value }], order, max),
    orderBy: (field, direction = 'asc') => query(path, filters, { field, direction }, max),
    limit: (count) => query(path, filters, order, count),
    get: async () => {
      let keys = [...rows.keys()].filter((key) => key.startsWith(path + '/') && key.split('/').length === depth);
      for (const { field, op, value } of filters) {
        assert.ok(op === '<=' || op === '==', 'double supports only <= and == filters');
        keys = keys.filter((key) => (op === '==' ? rows.get(key)[field] === value : rows.get(key)[field] !== undefined && rows.get(key)[field] <= value));
      }
      if (order) keys.sort((a, b) => (millis(rows.get(a)[order.field]) - millis(rows.get(b)[order.field])) * (order.direction === 'desc' ? -1 : 1));
      return { docs: keys.slice(0, max).map(snapshot) };
    },
  };
}
function ref(key) {
  return {
    key, id: key.split('/').at(-1),
    collection: (name) => query(key + '/' + name),
    get: async () => snapshot(key),
    set: async (data, options) => apply(key, data, options?.merge === true),
    update: async (data) => { assert.ok(rows.has(key), 'update of missing ' + key); apply(key, data, true); },
  };
}
const db = {
  collection: (name) => query(name),
  runTransaction(fn) {
    const task = tail.then(async () => {
      const writes = [];
      const tx = {
        get: async (reference) => { assert.equal(writes.length, 0, 'reads must precede writes'); return snapshot(reference.key); },
        create: (r, data) => writes.push(() => { assert.equal(rows.has(r.key), false, 'create of existing ' + r.key); apply(r.key, data, false); }),
        set: (r, data, options) => writes.push(() => apply(r.key, data, options?.merge === true)),
        update: (r, data) => writes.push(() => { assert.ok(rows.has(r.key), 'tx update of missing ' + r.key); apply(r.key, data, true); }),
      };
      const result = await fn(tx); for (const write of writes) write(); return result;
    });
    tail = task.catch(() => {}); return task;
  },
};
await mock.module('../src/lib/db/firestore.ts', { namedExports: { firestore: () => db } });
await mock.module('../src/lib/auth/session.ts', { namedExports: { getCurrentUser: async () => null, isSameOrigin: () => true } });
let cookieToken;
await mock.module('next/headers.js', { namedExports: { cookies: async () => ({ get: () => cookieToken ? { value: cookieToken } : undefined }) } });
// Triage is replaced: the core tests exercise the outbox, not the model.
let triageImpl = async () => ({ triage: { category: 'support', urgency: 'normal', language: 'en', summary: 'Pricing question', needsHuman: false, reasons: [] }, draft: 'Thanks for asking. The team will follow up.' });
let triageCalls = 0;
await mock.module('../src/lib/support/ai-triage.ts', { namedExports: { AiUnavailable: class AiUnavailable extends Error {}, triageConversation: async (input) => { triageCalls++; return triageImpl(input); } } });

const service = await import('../src/lib/support/service.ts');
const delivery = await import('../src/lib/support/delivery.ts');
const conversations = await import('../src/lib/support/conversations.ts');
const autoreply = await import('../src/lib/support/autoreply.ts');
const outbox = await import('../src/lib/support/slack/outbox.ts');

const secret = 'whsec_' + Buffer.from('test-only-signing-key-never-a-real-secret').toString('base64');
const env = {
  RESEND_API_KEY: 're_test_only', RESEND_WEBHOOK_SECRET: secret, SUPPORT_INBOX_EMAIL: 'owner@example.com', SUPPORT_FROM_EMAIL: 'Support <support@example.com>', SUPPORT_REPLY_DOMAIN: 'chat.example.com', SUPPORT_ALLOWED_REPLY_EMAILS: '',
  SLACK_BOT_TOKEN: 'xoxb-test-only', SLACK_SIGNING_SECRET: 'test-only-slack-signing', SUPPORT_SLACK_CHANNEL_ID: 'C0SUPPORT1', SUPPORT_SLACK_AGENT_IDS: 'U0AGENT01',
};
const config = { apiKey: env.RESEND_API_KEY, webhookSecret: secret, from: env.SUPPORT_FROM_EMAIL, inbox: 'owner@example.com', replyDomain: 'chat.example.com', allowedSenders: ['owner@example.com'] };
const input = (patch = {}) => ({ id: randomUUID(), text: 'Do you have pricing info?', name: 'Test', email: 'visitor@example.net', page: '/pricing', ...patch });

// Fake provider state: Resend sends, Resend inbound bodies, and Slack Web API calls.
let resendSent = [];
let slackCalls = [];
let slackHandler = () => ({ ok: true, ts: '1700000000.000100' });
let inboundEmails = new Map();
const router = (url, options) => {
  if (url.startsWith('https://slack.com/api/')) {
    const method = url.slice('https://slack.com/api/'.length);
    slackCalls.push({ method, body: JSON.parse(options.body), headers: Object.fromEntries(new Headers(options.headers)) });
    return slackHandler(method, JSON.parse(options.body));
  }
  if (url.includes('/emails/receiving/')) {
    const id = url.split('/emails/receiving/')[1].split('?')[0];
    assert.ok(inboundEmails.has(id), 'unknown inbound email ' + id);
    return Response.json(inboundEmails.get(id));
  }
  if (options.method === 'POST' && url.includes('api.resend.com/emails')) {
    resendSent.push({ body: JSON.parse(options.body), headers: Object.fromEntries(new Headers(options.headers)) });
    return Response.json({ id: 'resend-' + resendSent.length });
  }
  throw new Error('unexpected fetch ' + url);
};
function transport() { return mock.method(globalThis, 'fetch', async (url, options) => router(String(url), options)); }
function setup() {
  rows.clear(); resendSent = []; slackCalls = []; inboundEmails = new Map(); triageCalls = 0;
  slackHandler = () => Response.json({ ok: true, ts: '1700000000.000100' });
  triageImpl = async () => ({ triage: { category: 'support', urgency: 'normal', language: 'en', summary: 'Pricing question', needsHuman: false, reasons: [] }, draft: 'Thanks for asking. The team will follow up.' });
  cookieToken = service.newSupportToken();
  for (const key of ['SUPPORT_SLACK', 'SUPPORT_EMAIL_NOTIFY']) delete process.env[key];
  Object.assign(process.env, env);
}
const jobs = () => [...rows.keys()].filter((key) => key.startsWith('supportSlackOutbox/')).map((key) => ({ id: key.split('/')[1], ...rows.get(key) }));
const inbound = (id, patch = {}) => ({ id, from: 'Dana Levi <dana@example.net>', to: ['owner@example.com'], cc: [], received_for: ['owner@example.com'], subject: 'Pricing', text: 'Hi, how much does it cost?', html: null, message_id: '<m1@mail.example.net>', headers: {}, ...patch });
const jobId = (conversationId, messageId, type) => outbox.slackJobId(conversationId, messageId, type);

test('chat message enqueues exactly one message job and one draft job, and a retry does not duplicate them', async () => {
  setup(); const request = input(); const fetch = transport();
  try {
    const failing = mock.method(globalThis, 'fetch', async () => Response.json({ name: 'internal_server_error' }, { status: 500 }));
    await assert.rejects(() => service.sendSupportMessage(config, cookieToken, null, request), { code: 'SEND_FAILED' });
    failing.mock.restore();
    const conversationId = service.digest(cookieToken);
    const expected = [jobId(conversationId, request.id, 'message'), jobId(conversationId, request.id, 'draft')].sort();
    assert.deepEqual(jobs().map((job) => job.id).sort(), expected);
    assert.deepEqual(jobs().map((job) => job.type).sort(), ['draft', 'message']);
    assert.equal(rows.get(`supportConversations/${conversationId}`).channel, 'chat');
    // Retry of the same message: the existing-message branch must not enqueue again.
    await service.sendSupportMessage(config, cookieToken, null, request);
    assert.equal(jobs().length, 2);
    // Re-running the enqueue inside a transaction reuses the same deterministic job ids.
    await db.runTransaction((tx) => outbox.enqueueSlackJobs(tx, conversationId, request.id, ['message', 'draft']));
    assert.equal(jobs().length, 2);
    assert.equal(slackCalls.length, 0);
  } finally { fetch.mock.restore(); }
});

test('chat notification email carries a stable root Message-ID, and follow-ups reference the root', async () => {
  setup(); const fetch = transport();
  try {
    const first = input(); const second = input({ text: 'Follow-up question' });
    await service.sendSupportMessage(config, cookieToken, null, first);
    await service.sendSupportMessage(config, cookieToken, null, second);
    const [one, two] = resendSent.map((sent) => ({ headers: sent.body.headers }));
    const conversationId = service.digest(cookieToken);
    const root = `<chat-${conversationId}-root@chat.example.com>`;
    assert.equal(one.headers['Message-ID'], root); assert.equal(one.headers['In-Reply-To'], undefined); assert.equal(one.headers.References, undefined);
    assert.equal(two.headers['Message-ID'], `<chat-${conversationId}-${second.id}@chat.example.com>`);
    assert.equal(two.headers['In-Reply-To'], root); assert.equal(two.headers.References, root);
    assert.equal(one.headers['X-Entity-Ref-ID'], conversationId);
  } finally { fetch.mock.restore(); }
});

test('with email notifications switched off, Slack-configured chat messages are delivered without the inbox email', async () => {
  setup(); process.env.SUPPORT_EMAIL_NOTIFY = 'off'; const fetch = transport();
  try {
    const request = input();
    const sent = await service.sendSupportMessage(config, cookieToken, null, request);
    assert.equal(sent.delivery, 'sent'); assert.equal(resendSent.length, 0);
    assert.equal(jobs().length, 2);
  } finally { fetch.mock.restore(); }
});

test('inbound human email creates one email conversation, and a follow-up with In-Reply-To joins it', async () => {
  setup(); const first = randomUUID(); const second = randomUUID(); const fetch = transport();
  try {
    inboundEmails.set(first, inbound(first));
    assert.equal((await autoreply.handleInboundEmail(config, first)).recorded, true);
    const conversationId = service.digest('email:dana@example.net:<m1@mail.example.net>');
    const conversation = rows.get(`supportConversations/${conversationId}`);
    assert.equal(conversation.channel, 'email'); assert.equal(conversation.email, 'dana@example.net'); assert.equal(conversation.name, 'Dana Levi'); assert.equal(conversation.uid, null);
    assert.equal(conversation.emailThread.subject, 'Pricing'); assert.equal(conversation.emailThread.lastMessageId, '<m1@mail.example.net>');
    assert.equal(rows.get(`supportConversations/${conversationId}/messages/email-${first}`).text, 'Hi, how much does it cost?');
    assert.deepEqual(jobs().map((job) => job.type).sort(), ['draft', 'message']);

    inboundEmails.set(second, inbound(second, { message_id: '<m2@mail.example.net>', subject: 'Re: Pricing', text: 'Also, is there a trial?', headers: { 'in-reply-to': '<m1@mail.example.net>', references: '<m1@mail.example.net>' } }));
    await autoreply.handleInboundEmail(config, second);
    const conversationKeys = [...rows.keys()].filter((key) => /^supportConversations\/[a-f0-9]{64}$/.test(key));
    assert.deepEqual(conversationKeys, [`supportConversations/${conversationId}`]);
    assert.equal(rows.get(`supportConversations/${conversationId}`).emailThread.lastMessageId, '<m2@mail.example.net>');
    assert.deepEqual(rows.get(`supportConversations/${conversationId}`).emailThread.references, ['<m1@mail.example.net>', '<m2@mail.example.net>']);
    assert.equal(rows.has(`supportConversations/${conversationId}/messages/email-${second}`), true);
    assert.equal(jobs().length, 4);
  } finally { fetch.mock.restore(); }
});

test('redelivery of the same email id does not duplicate the conversation message or its jobs', async () => {
  setup(); const emailId = randomUUID(); const fetch = transport();
  try {
    inboundEmails.set(emailId, inbound(emailId));
    const email = inboundEmails.get(emailId);
    const firstRecord = await conversations.recordInboundEmail(config, emailId, email);
    const again = await conversations.recordInboundEmail(config, emailId, email);
    assert.deepEqual(again.jobIds, []); assert.equal(again.conversationId, firstRecord.conversationId);
    assert.equal(jobs().length, 2);
    const messages = [...rows.keys()].filter((key) => key.startsWith(`supportConversations/${firstRecord.conversationId}/messages/`));
    assert.equal(messages.length, 1);
    // Full webhook redelivery goes through the same path and is a duplicate at the top of handleInboundEmail.
    await autoreply.handleInboundEmail(config, emailId);
    assert.equal((await autoreply.handleInboundEmail(config, emailId)).duplicate, true);
    assert.equal(jobs().length, 2);
  } finally { fetch.mock.restore(); }
});

test('auto-replies and machine senders are not recorded as conversations', async () => {
  setup(); const emailId = randomUUID(); const fetch = transport();
  try {
    inboundEmails.set(emailId, inbound(emailId, { from: 'noreply@example.net' }));
    assert.equal(await conversations.recordInboundEmail(config, emailId, inboundEmails.get(emailId)), null);
    assert.equal([...rows.keys()].filter((key) => key.startsWith('supportConversations/')).length, 0);
  } finally { fetch.mock.restore(); }
});

test('agent reply to a chat conversation is stored once per key and marks the conversation waiting', async () => {
  setup(); const fetch = transport();
  try {
    await service.sendSupportMessage(config, cookieToken, null, input());
    const conversationId = service.digest(cookieToken);
    const first = await delivery.deliverAgentReply(config, conversationId, '  Here is the answer.  ', { key: 'msg/1700.1', agentId: 'U0AGENT01' });
    assert.deepEqual(first, { delivered: true });
    const again = await delivery.deliverAgentReply(config, conversationId, 'Here is the answer.', { key: 'msg/1700.1', agentId: 'U0AGENT01' });
    assert.deepEqual(again, { delivered: true, duplicate: true });
    const support = [...rows.entries()].filter(([key, value]) => key.includes('/messages/slack-') && value.sender === 'support');
    assert.equal(support.length, 1);
    assert.equal(support[0][1].text, 'Here is the answer.'); assert.equal(support[0][1].delivery, 'sent'); assert.equal(support[0][1].agent, 'U0AGENT01'); assert.equal(support[0][1].source, 'slack');
    assert.equal(rows.get(`supportConversations/${conversationId}`).status, 'waiting_on_customer');
    assert.equal(resendSent.length, 1); // only the notification to the inbox, no outbound email for chat
    await assert.rejects(() => delivery.deliverAgentReply(config, 'a'.repeat(64), 'x', { key: 'k', agentId: 'U0AGENT01' }), { code: 'NOT_FOUND' });
    await assert.rejects(() => delivery.deliverAgentReply(config, conversationId, '   ', { key: 'k2', agentId: 'U0AGENT01' }), { code: 'EMPTY' });
  } finally { fetch.mock.restore(); }
});

test('agent reply to an email conversation is sent with In-Reply-To and References, recorded as sent, and not repeated', async () => {
  setup(); const emailId = randomUUID(); const fetch = transport();
  try {
    inboundEmails.set(emailId, inbound(emailId));
    const recorded = await conversations.recordInboundEmail(config, emailId, inboundEmails.get(emailId));
    const before = resendSent.length;
    const result = await delivery.deliverAgentReply(config, recorded.conversationId, 'Plans start at 50 EUR.', { key: 'msg/42', agentId: 'U0AGENT01' });
    assert.deepEqual(result, { delivered: true });
    assert.equal(resendSent.length, before + 1);
    const sentMail = resendSent.at(-1); const mail = { body: sentMail.body, headers: sentMail.body.headers };
    assert.deepEqual(mail.body.to, ['dana@example.net']); assert.equal(mail.body.subject, 'Re: Pricing'); assert.equal(mail.body.reply_to, 'owner@example.com'); assert.equal(mail.body.text, 'Plans start at 50 EUR.');
    assert.equal(mail.headers['In-Reply-To'], '<m1@mail.example.net>');
    assert.equal(mail.headers.References, '<m1@mail.example.net>');
    assert.match(mail.headers['Message-ID'], /^<slack-[a-f0-9]{40}@example\.com>$/);
    const messageDoc = [...rows.entries()].find(([key, value]) => key.includes('/messages/slack-') && value.sender === 'support');
    assert.equal(messageDoc[1].delivery, 'sent'); assert.equal(messageDoc[1].emailId, 'resend-' + resendSent.length);
    assert.equal(rows.get(`supportEmailThreads/${service.digest(mail.headers['Message-ID'])}`).conversationId, recorded.conversationId);
    assert.equal(rows.get(`supportConversations/${recorded.conversationId}`).emailThread.lastMessageId, mail.headers['Message-ID']);
    // Same key again: no second provider send.
    assert.deepEqual(await delivery.deliverAgentReply(config, recorded.conversationId, 'Plans start at 50 EUR.', { key: 'msg/42', agentId: 'U0AGENT01' }), { delivered: true, duplicate: true });
    assert.equal(resendSent.length, before + 1);
  } finally { fetch.mock.restore(); }
});

test('a failed email reply is marked failed and retried with the same message id', async () => {
  setup(); const emailId = randomUUID(); let fail = true; const fetch = mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST' && String(url).includes('api.resend.com/emails') && fail) return Response.json({ name: 'internal_server_error' }, { status: 500 });
    return router(String(url), options);
  });
  try {
    inboundEmails.set(emailId, inbound(emailId));
    const recorded = await conversations.recordInboundEmail(config, emailId, inboundEmails.get(emailId));
    await assert.rejects(() => delivery.deliverAgentReply(config, recorded.conversationId, 'Answer', { key: 'msg/7', agentId: 'U0AGENT01' }), { code: 'SEND_FAILED' });
    const failed = [...rows.entries()].find(([key]) => key.includes('/messages/slack-'))[1];
    assert.equal(failed.delivery, 'failed');
    fail = false;
    assert.deepEqual(await delivery.deliverAgentReply(config, recorded.conversationId, 'Answer', { key: 'msg/7', agentId: 'U0AGENT01' }), { delivered: true });
    assert.equal([...rows.entries()].find(([key]) => key.includes('/messages/slack-'))[1].delivery, 'sent');
  } finally { fetch.mock.restore(); }
});

test('setConversationStatus updates the conversation and queues one card refresh job', async () => {
  setup(); const fetch = transport();
  try {
    await service.sendSupportMessage(config, cookieToken, null, input());
    const conversationId = service.digest(cookieToken);
    await delivery.setConversationStatus(conversationId, 'closed');
    assert.equal(rows.get(`supportConversations/${conversationId}`).status, 'closed');
    assert.equal(jobs().filter((job) => job.type === 'card').length, 1);
  } finally { fetch.mock.restore(); }
});

test('processSlackJob message creates exactly one parent card and one thread reply', async () => {
  setup(); const fetch = transport(); const request = input();
  let ts = 0;
  slackHandler = (method) => Response.json({ ok: true, ts: method === 'chat.postMessage' ? `1700000000.00010${++ts}` : '0' });
  try {
    await service.sendSupportMessage(config, cookieToken, null, request);
    const conversationId = service.digest(cookieToken);
    const messageJob = jobId(conversationId, request.id, 'message');
    assert.equal(await outbox.processSlackJob(messageJob), 'done');
    const posts = slackCalls.filter((call) => call.method === 'chat.postMessage');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].body.thread_ts, undefined);
    assert.equal(posts[0].body.channel, 'C0SUPPORT1');
    assert.equal(posts[1].body.thread_ts, '1700000000.000101');
    assert.match(posts[1].body.text, /U0AGENT01/);
    assert.equal(posts[0].headers.authorization, 'Bearer xoxb-test-only');
    assert.deepEqual(rows.get(`supportConversations/${conversationId}`).slack, { channel: 'C0SUPPORT1', ts: '1700000000.000101' });
    assert.equal(rows.get(`supportSlackThreads/${service.digest('C0SUPPORT1:1700000000.000101')}`).conversationId, conversationId);
    assert.equal(rows.get(`supportSlackOutbox/${messageJob}`).state, 'done');
    assert.equal('nextAt' in rows.get(`supportSlackOutbox/${messageJob}`), false);
    // A second run of the finished job posts nothing.
    assert.equal(await outbox.processSlackJob(messageJob), 'skipped');
    assert.equal(slackCalls.filter((call) => call.method === 'chat.postMessage').length, 2);
  } finally { fetch.mock.restore(); }
});

test('processSlackJob draft posts one draft card in the thread and stores the triage on the conversation', async () => {
  setup(); const fetch = transport(); const request = input();
  try {
    await service.sendSupportMessage(config, cookieToken, null, request);
    const conversationId = service.digest(cookieToken);
    await outbox.processSlackJob(jobId(conversationId, request.id, 'message'));
    const draftJob = jobId(conversationId, request.id, 'draft');
    assert.equal(await outbox.processSlackJob(draftJob), 'done');
    const draftPost = slackCalls.filter((call) => call.method === 'chat.postMessage').at(-1);
    assert.equal(draftPost.body.thread_ts, rows.get(`supportConversations/${conversationId}`).slack.ts);
    assert.equal(rows.get(`supportSlackDrafts/${draftJob}`).state, 'open');
    assert.equal(rows.get(`supportSlackDrafts/${draftJob}`).draft, 'Thanks for asking. The team will follow up.');
    assert.equal(rows.get(`supportConversations/${conversationId}`).triage.category, 'support');
    assert.equal(triageCalls, 1);
  } finally { fetch.mock.restore(); }
});

test('Slack errors schedule retries with backoff, honour Retry-After, and fail after the attempt limit', async () => {
  setup(); const fetch = transport(); const request = input();
  try {
    await service.sendSupportMessage(config, cookieToken, null, request);
    const conversationId = service.digest(cookieToken);
    const messageJob = jobId(conversationId, request.id, 'message');
    slackHandler = () => Response.json({ ok: false, error: 'channel_not_found' });
    const before = Date.now();
    assert.equal(await outbox.processSlackJob(messageJob), 'retry');
    let job = rows.get(`supportSlackOutbox/${messageJob}`);
    assert.equal(job.state, 'pending'); assert.equal(job.attempts, 1);
    assert.ok(job.nextAt - before >= 59_000 && job.nextAt - before <= 61_000, 'first backoff is about 60s');
    // Due again: a rate limit with Retry-After 300 wins over the computed backoff.
    rows.set(`supportSlackOutbox/${messageJob}`, { ...job, nextAt: 0 });
    slackHandler = () => new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), { status: 429, headers: { 'retry-after': '300' } });
    const retriedAt = Date.now();
    assert.equal(await outbox.processSlackJob(messageJob), 'retry');
    job = rows.get(`supportSlackOutbox/${messageJob}`);
    assert.equal(job.attempts, 2);
    assert.ok(job.nextAt - retriedAt >= 300_000, 'Retry-After is honoured');
    // Not yet due: a sweep leaves the message job untouched (the draft job may run, and fails on the same 429).
    const untouched = rows.get(`supportSlackOutbox/${messageJob}`).nextAt;
    await outbox.processDueSlackJobs();
    assert.equal(rows.get(`supportSlackOutbox/${messageJob}`).nextAt, untouched);
    // Exhausted attempts end in failed and drop out of the sweep query.
    rows.set(`supportSlackOutbox/${messageJob}`, { ...job, nextAt: 0, attempts: 7 });
    assert.equal(await outbox.processSlackJob(messageJob), 'failed');
    job = rows.get(`supportSlackOutbox/${messageJob}`);
    assert.equal(job.state, 'failed'); assert.equal('nextAt' in job, false);
  } finally { fetch.mock.restore(); }
});

test('the sweep processes due jobs without a composite-index query and removes finished jobs from it', async () => {
  setup(); const fetch = transport(); const request = input();
  let ts = 0;
  slackHandler = (method) => Response.json({ ok: true, ts: method === 'chat.postMessage' ? `1700000000.00020${++ts}` : '0' });
  try {
    await service.sendSupportMessage(config, cookieToken, null, request);
    const counts = await outbox.processDueSlackJobs(20);
    assert.deepEqual(counts, { done: 2, retry: 0, failed: 0 });
    assert.equal(jobs().every((job) => job.state === 'done' && !('nextAt' in job)), true);
    assert.deepEqual(await outbox.processDueSlackJobs(20), { done: 0, retry: 0, failed: 0 });
  } finally { fetch.mock.restore(); }
});

test('kickSlackJobs never throws outside a request', () => {
  assert.doesNotThrow(() => outbox.kickSlackJobs(['a'.repeat(64)]));
  assert.doesNotThrow(() => outbox.kickSlackJobs([]));
});

test('a retried first message keeps its thread-root headers after later messages arrive, and sending reopens the conversation', async () => {
  setup(); const fetch = transport(); const first = input();
  try {
    const failing = mock.method(globalThis, 'fetch', async () => Response.json({ name: 'internal_server_error' }, { status: 500 }));
    await assert.rejects(() => service.sendSupportMessage(config, cookieToken, null, first), { code: 'SEND_FAILED' });
    failing.mock.restore();
    const conversationId = service.digest(cookieToken);
    const root = `<chat-${conversationId}-root@chat.example.com>`;
    await service.sendSupportMessage(config, cookieToken, null, input({ text: 'Second question' }));
    await delivery.setConversationStatus(conversationId, 'closed');
    await service.sendSupportMessage(config, cookieToken, null, input({ text: 'Third question' }));
    assert.equal(rows.get(`supportConversations/${conversationId}`).status, 'open');
    // The messageCount is now 3, but the retry must still use the root headers the first attempt would have used.
    await service.sendSupportMessage(config, cookieToken, null, first);
    const retry = resendSent.at(-1).body.headers;
    assert.equal(retry['Message-ID'], root);
    assert.equal(retry['In-Reply-To'], undefined);
    assert.equal(retry.References, undefined);
    assert.equal(resendSent.at(-2).body.headers['In-Reply-To'], root);
  } finally { fetch.mock.restore(); }
});

test('a visitor message refreshes the parent card, so a reopened conversation shows open again', async () => {
  setup(); const fetch = transport(); const first = input(); const second = input({ text: 'Back again' });
  try {
    await service.sendSupportMessage(config, cookieToken, null, first);
    const conversationId = service.digest(cookieToken);
    await outbox.processSlackJob(jobId(conversationId, first.id, 'message'));
    await delivery.setConversationStatus(conversationId, 'closed');
    await service.sendSupportMessage(config, cookieToken, null, second);
    slackCalls = [];
    assert.equal(await outbox.processSlackJob(jobId(conversationId, second.id, 'message')), 'done');
    const updates = slackCalls.filter((call) => call.method === 'chat.update');
    assert.equal(updates.length, 1);
    assert.match(JSON.stringify(updates[0].body.blocks), /\*Status\*\\nopen/);
  } finally { fetch.mock.restore(); }
});

test('a failed parent card refresh does not fail the message job', async () => {
  setup(); const fetch = transport(); const request = input();
  try {
    await service.sendSupportMessage(config, cookieToken, null, request);
    const conversationId = service.digest(cookieToken);
    slackHandler = (method) => (method === 'chat.update' ? Response.json({ ok: false, error: 'internal_error' }) : Response.json({ ok: true, ts: '1700000000.000100' }));
    assert.equal(await outbox.processSlackJob(jobId(conversationId, request.id, 'message')), 'done');
    assert.equal(rows.get(`supportSlackOutbox/${jobId(conversationId, request.id, 'message')}`).state, 'done');
  } finally { fetch.mock.restore(); }
});

test('a delivered agent reply queues one card refresh, for chat and email alike, and a duplicate delivery queues nothing more', async () => {
  setup(); const fetch = transport();
  try {
    await service.sendSupportMessage(config, cookieToken, null, input());
    const chatId = service.digest(cookieToken);
    await delivery.deliverAgentReply(config, chatId, 'Done.', { key: 'msg/card-1', agentId: 'U0AGENT01' });
    assert.equal(jobs().filter((job) => job.type === 'card').length, 1);
    await delivery.deliverAgentReply(config, chatId, 'Done.', { key: 'msg/card-1', agentId: 'U0AGENT01' });
    assert.equal(jobs().filter((job) => job.type === 'card').length, 1);

    const emailId = randomUUID(); inboundEmails.set(emailId, inbound(emailId));
    const recorded = await conversations.recordInboundEmail(config, emailId, inboundEmails.get(emailId));
    await delivery.deliverAgentReply(config, recorded.conversationId, 'Emailed answer', { key: 'msg/card-2', agentId: 'U0AGENT01' });
    assert.equal(jobs().filter((job) => job.type === 'card').length, 2);
  } finally { fetch.mock.restore(); }
});

test('a follow-up in an existing email conversation is recorded without an acknowledgment, and stays silent on redelivery', async () => {
  setup(); const first = randomUUID(); const second = randomUUID(); const fetch = transport();
  try {
    inboundEmails.set(first, inbound(first));
    assert.equal((await autoreply.handleInboundEmail(config, first)).recorded, true);
    assert.equal(resendSent.length, 1);
    inboundEmails.set(second, inbound(second, { message_id: '<m2@mail.example.net>', subject: 'Re: Pricing', text: 'Also, is there a trial?', headers: { 'in-reply-to': '<m1@mail.example.net>', references: '<m1@mail.example.net>' } }));
    assert.deepEqual(await autoreply.handleInboundEmail(config, second), { recorded: true, ignored: true, reason: 'existing-conversation' });
    assert.deepEqual(await autoreply.handleInboundEmail(config, second), { recorded: true, ignored: true, reason: 'existing-conversation' });
    assert.equal(resendSent.length, 1);
  } finally { fetch.mock.restore(); }
});

test('a new email whose acknowledgment failed is acknowledged on redelivery', async () => {
  setup(); const emailId = randomUUID(); const transportMock = transport();
  try {
    inboundEmails.set(emailId, inbound(emailId));
    const failing = mock.method(globalThis, 'fetch', async (url, options) => (options.method === 'POST' && String(url).includes('api.resend.com/emails') ? Response.json({ name: 'internal_server_error' }, { status: 500 }) : router(String(url), options)));
    await assert.rejects(() => autoreply.handleInboundEmail(config, emailId), { code: 'AUTOREPLY_FAILED' });
    failing.mock.restore();
    const retried = await autoreply.handleInboundEmail(config, emailId);
    assert.equal(retried.autoReplied, true);
    assert.equal(retried.recorded, true);
    assert.equal(resendSent.length, 1);
  } finally { transportMock.mock.restore(); }
});

test('a new draft supersedes earlier open drafts of the same conversation, and their cards say so', async () => {
  setup(); const fetch = transport(); const first = input(); const second = input({ text: 'Another question' });
  try {
    await service.sendSupportMessage(config, cookieToken, null, first);
    const conversationId = service.digest(cookieToken);
    await outbox.processSlackJob(jobId(conversationId, first.id, 'message'));
    await outbox.processSlackJob(jobId(conversationId, first.id, 'draft'));
    assert.equal(rows.get(`supportSlackDrafts/${jobId(conversationId, first.id, 'draft')}`).state, 'open');
    await service.sendSupportMessage(config, cookieToken, null, second);
    assert.equal(await outbox.processSlackJob(jobId(conversationId, second.id, 'draft')), 'done');
    assert.equal(rows.get(`supportSlackDrafts/${jobId(conversationId, first.id, 'draft')}`).state, 'superseded');
    assert.equal(rows.get(`supportSlackDrafts/${jobId(conversationId, second.id, 'draft')}`).state, 'open');
    const resolved = slackCalls.filter((call) => call.method === 'chat.update' && call.body.text === '↪️ Superseded by a newer draft');
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].body.ts, '1700000000.000100');
    // Reprocessing the same draft job does not supersede the newest draft.
    assert.equal(await outbox.processSlackJob(jobId(conversationId, second.id, 'draft')), 'skipped');
    assert.equal(rows.get(`supportSlackDrafts/${jobId(conversationId, second.id, 'draft')}`).state, 'open');
  } finally { fetch.mock.restore(); }
});
