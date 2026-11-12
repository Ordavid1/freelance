import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHmac } from 'node:crypto';
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
await mock.module('../src/lib/auth/session.ts', { namedExports: { getCurrentUser: async () => null, isSameOrigin: () => true, publicAppOrigin: () => 'https://example.com' } });

const service = await import('../src/lib/support/service.ts');
const digest = service.digest;
const events = await import('../src/app/api/support/slack/events/route.ts');
const interactions = await import('../src/app/api/support/slack/interactions/route.ts');
const dispatch = await import('../src/app/api/support/slack/dispatch/route.ts');

const SIGNING = 'test-only-slack-signing-secret';
const CHANNEL = 'C0TESTCHAN';
const AGENT = 'U0AGENT01';
const OTHER = 'U0OTHER001';
const THREAD = '1700000000.000100';
const CONV = digest('conversation-under-test');
const DRAFT = digest('draft-under-test');
const env = {
  SLACK_BOT_TOKEN: 'xoxb-test-only', SLACK_SIGNING_SECRET: SIGNING, SUPPORT_SLACK_CHANNEL_ID: CHANNEL, SUPPORT_SLACK_AGENT_IDS: AGENT,
  RESEND_API_KEY: 're_test_only', RESEND_WEBHOOK_SECRET: 'whsec_' + Buffer.from('test-only-signing-key-never-a-real-secret').toString('base64'),
  SUPPORT_FROM_EMAIL: 'Support <support@example.com>', SUPPORT_REPLY_DOMAIN: 'chat.example.com', SUPPORT_INBOX_EMAIL: 'owner@example.com',
  SUPPORT_SLACK: undefined, SUPPORT_SLACK_SCHEDULER_EMAIL: undefined,
};
Object.assign(process.env, env);

let slackCalls = [];
mock.method(globalThis, 'fetch', async (url, options) => {
  const method = String(url).split('/api/')[1];
  slackCalls.push({ method, body: JSON.parse(options.body) });
  return Response.json({ ok: true, ts: '1700000999.000001' });
});
const calls = (method) => slackCalls.filter((call) => call.method === method);

function seed() {
  rows.clear(); slackCalls = [];
  rows.set(`supportConversations/${CONV}`, { channel: 'chat', name: 'Dana', email: 'dana@example.net', uid: null, replyToken: 'a'.repeat(32), messageCount: 1, status: 'waiting_on_customer', createdAt: Timestamp.fromMillis(Date.now()), updatedAt: Timestamp.fromMillis(Date.now()) });
  rows.set(`supportSlackThreads/${digest(`${CHANNEL}:${THREAD}`)}`, { conversationId: CONV });
}
const supportMessages = () => [...rows.entries()].filter(([key]) => key.startsWith(`supportConversations/${CONV}/messages/`)).map(([, value]) => value);

function signed(path, raw, { contentType = 'application/json', timestamp = Math.floor(Date.now() / 1000), signature } = {}) {
  const ts = String(timestamp);
  const sig = 'v0=' + createHmac('sha256', SIGNING).update(`v0:${ts}:${raw}`).digest('hex');
  return new Request('https://example.com' + path, { method: 'POST', body: raw, headers: { 'content-type': contentType, 'x-slack-request-timestamp': ts, 'x-slack-signature': signature ?? sig } });
}
const eventRequest = (body, options) => signed('/api/support/slack/events', JSON.stringify(body), options);
const messageEvent = (patch = {}) => ({ type: 'event_callback', event_id: 'Ev' + Math.random().toString(36).slice(2, 10), event: { type: 'message', channel: CHANNEL, user: AGENT, text: 'Hello from the team', ts: '1700000100.000200', thread_ts: THREAD, client_msg_id: 'cm-' + Math.random().toString(36).slice(2, 8), ...patch } });
const interactionRequest = (payload, options) => signed('/api/support/slack/interactions', 'payload=' + encodeURIComponent(JSON.stringify(payload)), { contentType: 'application/x-www-form-urlencoded', ...options });
const triage = { category: 'support', urgency: 'normal', language: 'en', summary: 'Asks about a project.', needsHuman: false, reasons: [] };
function seedDraft(state = 'open', draft = 'Thanks, we are on it.') {
  rows.set(`supportSlackDrafts/${DRAFT}`, { conversationId: CONV, draft, triage, state, slack: { channel: CHANNEL, ts: '1700000050.000100' } });
}
const action = (actionId, value, user = AGENT) => ({ type: 'block_actions', user: { id: user }, channel: { id: CHANNEL }, trigger_id: 'trig.1', actions: [{ action_id: actionId, value }] });

test('after() is only usable inside a request scope, so the routes fall back to inline work in tests', async () => {
  const { after } = await import('next/server.js');
  assert.throws(() => after(() => {}));
});

test('url_verification echoes the challenge', async () => {
  seed();
  const response = await events.POST(eventRequest({ type: 'url_verification', challenge: 'abc123' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: 'abc123' });
});

test('bad or stale signatures are rejected before parsing', async () => {
  seed();
  const body = JSON.stringify(messageEvent());
  assert.equal((await events.POST(signed('/api/support/slack/events', body, { signature: 'v0=' + '0'.repeat(64) }))).status, 401);
  assert.equal((await events.POST(signed('/api/support/slack/events', body, { timestamp: Math.floor(Date.now() / 1000) - 3600 }))).status, 401);
  assert.equal((await interactions.POST(signed('/api/support/slack/interactions', 'payload={}', { contentType: 'application/x-www-form-urlencoded', signature: 'v0=bad' }))).status, 401);
  assert.equal(rows.has(`supportConversations/${CONV}`), true);
  assert.equal(supportMessages().length, 0);
});

test('an agent reply in the conversation thread is delivered to the chat and acknowledged with a reaction', async () => {
  seed();
  const response = await events.POST(eventRequest(messageEvent({ text: 'Hello <https://example.com/x|the site> & more' })));
  assert.equal(response.status, 200);
  const messages = supportMessages();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].sender, 'support');
  assert.equal(messages[0].delivery, 'sent');
  assert.match(messages[0].text, /Hello/);
  assert.equal(messages[0].text.includes('<'), false, 'Slack markup is converted to plain text');
  assert.equal(rows.get(`supportConversations/${CONV}`).status, 'waiting_on_customer');
  assert.deepEqual(calls('reactions.add').map((call) => call.body.name), ['white_check_mark']);
});

test('a retried event (same event_id) is not delivered twice', async () => {
  seed();
  const body = messageEvent();
  assert.equal((await events.POST(eventRequest(body))).status, 200);
  const retry = await events.POST(eventRequest(body));
  assert.deepEqual(await retry.json(), { duplicate: true });
  assert.equal(supportMessages().length, 1);
});

test('internal notes get a lock reaction and are not delivered', async () => {
  seed();
  assert.equal((await events.POST(eventRequest(messageEvent({ text: '// check the refund history first' })))).status, 200);
  assert.equal(supportMessages().length, 0);
  assert.deepEqual(calls('reactions.add').map((call) => call.body.name), ['lock']);
});

test('non-agents get an ephemeral notice and nothing is delivered', async () => {
  seed();
  assert.equal((await events.POST(eventRequest(messageEvent({ user: OTHER })))).status, 200);
  assert.equal(supportMessages().length, 0);
  const ephemeral = calls('chat.postEphemeral');
  assert.equal(ephemeral.length, 1);
  assert.equal(ephemeral[0].body.user, OTHER);
  assert.match(ephemeral[0].body.text, /Only support agents/);
});

test('bot messages, edits, top-level posts and other channels are ignored', async () => {
  seed();
  const base = messageEvent().event;
  const { bot_id: _bot, user: _user, ...botBase } = base;
  const cases = {
    bot: { ...botBase, bot_id: 'B0BOT' },
    botSubtype: { ...base, subtype: 'bot_message' },
    edited: { ...base, subtype: 'message_changed' },
    topLevel: { ...base, thread_ts: undefined },
    parentItself: { ...base, thread_ts: base.ts },
    otherChannel: { ...base, channel: 'C0OTHER' },
  };
  for (const [name, event] of Object.entries(cases)) {
    const response = await events.POST(eventRequest({ type: 'event_callback', event_id: 'Ev-' + name, event }));
    assert.equal(response.status, 200, name);
  }
  assert.equal(supportMessages().length, 0);
  assert.equal(slackCalls.length, 0);
});

test('a failed delivery is reported in the thread with a warning reaction', async () => {
  seed();
  assert.equal((await events.POST(eventRequest(messageEvent({ text: '   ' })))).status, 200);
  assert.equal(supportMessages().length, 0);
  assert.deepEqual(calls('reactions.add').map((call) => call.body.name), ['warning']);
  assert.match(calls('chat.postEphemeral')[0].body.text, /Not delivered/);
});

test('draft send delivers once as the agent and the card is updated; a second click is a no-op', async () => {
  seed(); seedDraft();
  const first = await interactions.POST(interactionRequest(action('draft_send', DRAFT)));
  assert.equal(first.status, 200);
  const messages = supportMessages();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'Thanks, we are on it.');
  assert.equal(rows.get(`supportSlackDrafts/${DRAFT}`).state, 'sent');
  assert.equal(calls('chat.update').length, 1);
  assert.equal(calls('chat.update')[0].body.ts, '1700000050.000100');

  slackCalls = [];
  assert.equal((await interactions.POST(interactionRequest(action('draft_send', DRAFT)))).status, 200);
  assert.equal(supportMessages().length, 1);
  assert.match(calls('chat.postEphemeral')[0].body.text, /already handled/);
});

test('a non-agent cannot send or discard a draft', async () => {
  seed(); seedDraft();
  await interactions.POST(interactionRequest(action('draft_send', DRAFT, OTHER)));
  await interactions.POST(interactionRequest(action('draft_discard', DRAFT, OTHER)));
  assert.equal(supportMessages().length, 0);
  assert.equal(rows.get(`supportSlackDrafts/${DRAFT}`).state, 'open');
  assert.match(calls('chat.postEphemeral')[0].body.text, /Only support agents/);
});

test('discard marks the draft and resolves the card without sending anything', async () => {
  seed(); seedDraft();
  assert.equal((await interactions.POST(interactionRequest(action('draft_discard', DRAFT)))).status, 200);
  assert.equal(rows.get(`supportSlackDrafts/${DRAFT}`).state, 'discarded');
  assert.equal(supportMessages().length, 0);
  assert.equal(calls('chat.update').length, 1);
});

test('edit opens the modal, and submitting it sends the edited text once', async () => {
  seed(); seedDraft();
  const opened = [];
  slackCalls = [];
  assert.equal((await interactions.POST(interactionRequest(action('draft_edit', DRAFT)))).status, 200);
  opened.push(...calls('views.open'));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].body.view.private_metadata, DRAFT);
  const submission = { type: 'view_submission', user: { id: AGENT }, view: { callback_id: 'draft_edit_submit', private_metadata: DRAFT, state: { values: { reply: { text: { type: 'plain_text_input', value: '  Edited reply for the customer  ' } } } } } };
  const response = await interactions.POST(interactionRequest(submission));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(supportMessages()[0].text, 'Edited reply for the customer');
  assert.equal(rows.get(`supportSlackDrafts/${DRAFT}`).state, 'sent');
});

test('an edit that cannot be delivered reverts the draft and reports the error in the modal', async () => {
  seed(); seedDraft('open', 'Original');
  const submission = { type: 'view_submission', user: { id: AGENT }, view: { callback_id: 'draft_edit_submit', private_metadata: DRAFT, state: { values: { reply: { text: { value: '   ' } } } } } };
  const response = await interactions.POST(interactionRequest(submission));
  const body = await response.json();
  assert.equal(body.response_action, 'errors');
  assert.ok(body.errors.reply);
  assert.equal(rows.get(`supportSlackDrafts/${DRAFT}`).state, 'open');
  assert.equal(supportMessages().length, 0);
});

test('close and reopen change the conversation status from the parent card', async () => {
  seed();
  await interactions.POST(interactionRequest(action('conv_close', CONV)));
  assert.equal(rows.get(`supportConversations/${CONV}`).status, 'closed');
  await interactions.POST(interactionRequest(action('conv_reopen', CONV)));
  assert.equal(rows.get(`supportConversations/${CONV}`).status, 'open');
});

test('dispatch requires the scheduler identity', async () => {
  const previous = process.env.SUPPORT_SLACK_SCHEDULER_EMAIL;
  try {
    delete process.env.SUPPORT_SLACK_SCHEDULER_EMAIL;
    assert.equal((await dispatch.POST(new Request('https://example.com/api/support/slack/dispatch', { method: 'POST' }))).status, 503);
    process.env.SUPPORT_SLACK_SCHEDULER_EMAIL = 'scheduler@example.iam.gserviceaccount.com';
    assert.equal((await dispatch.POST(new Request('https://example.com/api/support/slack/dispatch', { method: 'POST', headers: { authorization: 'Bearer not-a-jwt' } }))).status, 401);
    assert.equal((await dispatch.POST(new Request('https://example.com/api/support/slack/dispatch', { method: 'POST' }))).status, 401);
  } finally { if (previous === undefined) delete process.env.SUPPORT_SLACK_SCHEDULER_EMAIL; else process.env.SUPPORT_SLACK_SCHEDULER_EMAIL = previous; }
});

test('a superseded draft counts as already handled: it cannot be sent or edited', async () => {
  seed(); seedDraft('superseded');
  assert.equal((await interactions.POST(interactionRequest(action('draft_send', DRAFT)))).status, 200);
  assert.equal((await interactions.POST(interactionRequest(action('draft_edit', DRAFT)))).status, 200);
  assert.equal(supportMessages().length, 0);
  assert.equal(calls('views.open').length, 0);
  assert.equal(rows.get(`supportSlackDrafts/${DRAFT}`).state, 'superseded');
  assert.ok(calls('chat.postEphemeral').every((call) => /already handled/.test(call.body.text)));
});

test('the Slack routes do their work before responding: no after() deferral remains in the handlers', async () => {
  const { readFileSync } = await import('node:fs');
  for (const route of ['events', 'interactions']) {
    const source = readFileSync(new URL(`../src/app/api/support/slack/${route}/route.ts`, import.meta.url), 'utf8');
    assert.equal(/next\/server|after\(/.test(source), false, route);
  }
  // The delivery is visible as soon as the response object exists.
  seed();
  const response = await events.POST(eventRequest(messageEvent({ text: 'Inline delivery check' })));
  assert.equal(response.status, 200);
  assert.equal(supportMessages().length, 1);
});
