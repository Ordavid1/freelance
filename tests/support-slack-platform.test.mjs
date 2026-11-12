import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHmac } from 'node:crypto';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export{}', shortCircuit: true };
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  if (specifier === 'next/server' || specifier === 'next/headers') return next(specifier + '.js', context);
  return next(specifier, context);
} });

const { verifySlackSignature } = await import('../src/lib/support/slack/verify.ts');
const { SlackApiError, slackApi, postMessage, addReaction, openView } = await import('../src/lib/support/slack/client.ts');
const { slackTextToPlain, escapeSlack, isInternalNote } = await import('../src/lib/support/slack/text.ts');
const { supportSlackConfig, emailNotifyEnabled, isAgent } = await import('../src/lib/support/slack/config.ts');
const blocks = await import('../src/lib/support/slack/blocks.ts');

const secret = 'test-only-signing-secret';
const now = 1_800_000_000;
function sign(body, timestamp = String(now), key = secret) {
  return 'v0=' + createHmac('sha256', key).update(`v0:${timestamp}:${body}`).digest('hex');
}

test('verifies a fresh v0 signature and rejects tampered, stale, future-dated, or malformed requests', () => {
  const body = 'token=x&payload=%7B%7D';
  const headers = { timestamp: String(now), signature: sign(body) };
  assert.equal(verifySlackSignature(body, headers, secret, now), true);
  assert.equal(verifySlackSignature(body + '&extra=1', headers, secret, now), false);
  assert.equal(verifySlackSignature(body, { timestamp: String(now), signature: sign(body, String(now), 'other') }, secret, now), false);
  assert.equal(verifySlackSignature(body, headers, secret, now + 301), false);
  assert.equal(verifySlackSignature(body, headers, secret, now - 301), false);
  assert.equal(verifySlackSignature(body, { timestamp: String(now + 1000), signature: sign(body, String(now + 1000)) }, secret, now), false);
  assert.equal(verifySlackSignature(body, { timestamp: 'abc', signature: sign(body, 'abc') }, secret, now), false);
  assert.equal(verifySlackSignature(body, { timestamp: null, signature: headers.signature }, secret, now), false);
  assert.equal(verifySlackSignature(body, { timestamp: String(now), signature: null }, secret, now), false);
  assert.equal(verifySlackSignature(body, { timestamp: String(now), signature: 'v0=short' }, secret, now), false);
});

test('slackApi posts JSON with bearer auth and maps 429, HTTP, and ok:false failures to SlackApiError', async () => {
  const calls = [];
  let next = () => Response.json({ ok: true, ts: '1.2' });
  const fetch = mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return next(); });
  try {
    assert.deepEqual(await slackApi('xoxb-test', 'chat.postMessage', { channel: 'C1' }), { ok: true, ts: '1.2' });
    assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer xoxb-test');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(JSON.parse(calls[0].options.body).channel, 'C1');
    assert.ok(calls[0].options.signal);

    next = () => new Response('', { status: 429, headers: { 'retry-after': '12' } });
    await assert.rejects(slackApi('t', 'chat.update', {}), (error) => error instanceof SlackApiError && error.code === 'ratelimited' && error.retryAfterSeconds === 12);
    next = () => new Response('', { status: 429 });
    await assert.rejects(slackApi('t', 'chat.update', {}), (error) => error.code === 'ratelimited' && error.retryAfterSeconds === 30);

    next = () => new Response('', { status: 500 });
    await assert.rejects(slackApi('t', 'chat.update', {}), (error) => error instanceof SlackApiError && error.code === 'http_500');

    next = () => Response.json({ ok: false, error: 'channel_not_found' });
    await assert.rejects(slackApi('t', 'chat.update', {}), (error) => error.code === 'channel_not_found');
    next = () => Response.json({ ok: false });
    await assert.rejects(slackApi('t', 'chat.update', {}), (error) => error.code === 'unknown');

    await assert.rejects(slackApi('t', 'not-a-method', {}), (error) => error.code === 'invalid_method');
    assert.equal(fetch.mock.callCount(), 6);
  } finally {
    mock.restoreAll();
  }
});

test('convenience wrappers call the right methods and swallow already_reacted', async () => {
  const seen = [];
  let next = () => Response.json({ ok: true, ts: '9.9' });
  mock.method(globalThis, 'fetch', async (url, options) => { seen.push({ url, body: JSON.parse(options.body) }); return next(); });
  try {
    await postMessage('t', { channel: 'C1', text: 'hi', thread_ts: '1.1' });
    assert.equal(seen[0].url, 'https://slack.com/api/chat.postMessage');
    assert.equal(seen[0].body.unfurl_links, false);
    assert.equal(seen[0].body.thread_ts, '1.1');
    await openView('t', { trigger_id: 'T1', view: { type: 'modal' } });
    assert.equal(seen[1].url, 'https://slack.com/api/views.open');
    next = () => Response.json({ ok: false, error: 'already_reacted' });
    assert.equal((await addReaction('t', { channel: 'C1', timestamp: '1.1', name: 'lock' })).ok, true);
    assert.equal(seen[2].url, 'https://slack.com/api/reactions.add');
    next = () => Response.json({ ok: false, error: 'invalid_name' });
    await assert.rejects(addReaction('t', { channel: 'C1', timestamp: '1.1', name: 'x' }), (error) => error.code === 'invalid_name');
  } finally {
    mock.restoreAll();
  }
});

test('converts Slack mrkdwn to plain text and unescapes entities once', () => {
  assert.equal(slackTextToPlain('<mailto:a@b.com|a@b.com>'), 'a@b.com');
  assert.equal(slackTextToPlain('<https://x.example/p|Pricing page>'), 'Pricing page (https://x.example/p)');
  assert.equal(slackTextToPlain('<https://x.example/p|https://x.example/p>'), 'https://x.example/p');
  assert.equal(slackTextToPlain('<https://x.example/p>'), 'https://x.example/p');
  assert.equal(slackTextToPlain('<@U123ABC> hello'), '@user hello');
  assert.equal(slackTextToPlain('<@U123ABC|dana> hello'), '@dana hello');
  assert.equal(slackTextToPlain('<#C1|support> see'), '#support see');
  assert.equal(slackTextToPlain('<!here> ping <!subteam^S1|@team> done'), 'ping  done');
  assert.equal(slackTextToPlain('a &lt;b&gt; &amp;amp; c'), 'a <b> &amp; c');
  assert.equal(slackTextToPlain('  hi\u0000  '), 'hi');
});

test('escapes mrkdwn control characters', () => {
  assert.equal(escapeSlack('<!channel> & <@U1>'), '&lt;!channel&gt; &amp; &lt;@U1&gt;');
});

test('detects internal notes by // or note: prefix', () => {
  assert.equal(isInternalNote('// do not send'), true);
  assert.equal(isInternalNote('  NOTE: check refund'), true);
  assert.equal(isInternalNote('note to self'), false);
  assert.equal(isInternalNote('Hello // not a note'), false);
});

test('config is null unless every setting is valid and the kill switch is unset', () => {
  const valid = {
    SLACK_BOT_TOKEN: 'xoxb-test-only', SLACK_SIGNING_SECRET: secret,
    SUPPORT_SLACK_CHANNEL_ID: 'C0123456789', SUPPORT_SLACK_AGENT_IDS: 'U0AGENT01, W0AGENT02',
  };
  const config = supportSlackConfig(valid);
  assert.deepEqual(config, { botToken: 'xoxb-test-only', signingSecret: secret, channelId: 'C0123456789', agentIds: ['U0AGENT01', 'W0AGENT02'] });
  for (const off of ['off', 'false', '0', 'disabled', ' OFF ']) assert.equal(supportSlackConfig({ ...valid, SUPPORT_SLACK: off }), null);
  assert.ok(supportSlackConfig({ ...valid, SUPPORT_SLACK: 'on' }));
  assert.equal(supportSlackConfig({ ...valid, SLACK_BOT_TOKEN: '' }), null);
  assert.equal(supportSlackConfig({ ...valid, SLACK_BOT_TOKEN: 'xoxp-user-token' }), null);
  assert.equal(supportSlackConfig({ ...valid, SLACK_SIGNING_SECRET: undefined }), null);
  assert.equal(supportSlackConfig({ ...valid, SUPPORT_SLACK_CHANNEL_ID: 'general' }), null);
  assert.equal(supportSlackConfig({ ...valid, SUPPORT_SLACK_AGENT_IDS: '' }), null);
  assert.equal(supportSlackConfig({ ...valid, SUPPORT_SLACK_AGENT_IDS: 'U0AGENT01,bot' }), null);
  assert.equal(supportSlackConfig({ ...valid, SUPPORT_SLACK_AGENT_IDS: 'B0BOT0001' }), null);
});

test('email notification flag defaults on and agents are matched exactly', () => {
  assert.equal(emailNotifyEnabled({}), true);
  assert.equal(emailNotifyEnabled({ SUPPORT_EMAIL_NOTIFY: 'disabled' }), false);
  assert.equal(emailNotifyEnabled({ SUPPORT_EMAIL_NOTIFY: 'on' }), true);
  const config = { botToken: 't', signingSecret: 's', channelId: 'C0123456', agentIds: ['U0AGENT01'] };
  assert.equal(isAgent(config, 'U0AGENT01'), true);
  assert.equal(isAgent(config, 'U0AGENT0'), false);
  assert.equal(isAgent(config, undefined), false);
  assert.equal(isAgent(config, ['U0AGENT01']), false);
});

test('Block Kit builders escape user input and carry the right action ids', () => {
  const triage = { category: 'billing', urgency: 'high', language: 'en', summary: 'Asks <refund> & more', needsHuman: true, reasons: ['refund <requested>'] };
  const evil = '<!channel> <https://evil.example|click> & <@U0AGENT01>';
  const parent = blocks.parentCard({ conversationId: 'a'.repeat(64), channel: 'chat', name: '<b>Dana</b>', email: 'dana@example.net', page: '/x?<y>', status: 'open', triage });
  const parentJson = JSON.stringify(parent);
  assert.match(parentJson, /conv_close/);
  assert.match(parentJson, /Asks &lt;refund&gt; &amp; more/);
  assert.doesNotMatch(parentJson, /<refund>/);
  assert.match(parent.text, /Chat/);
  const closed = JSON.stringify(blocks.parentCard({ conversationId: 'b'.repeat(64), channel: 'email', name: 'Dana', email: 'd@x.net', subject: 'Hi', status: 'closed' }));
  assert.match(closed, /conv_reopen/);
  assert.doesNotMatch(closed, /conv_close/);
  assert.match(closed, /✉️ Email/);

  const message = blocks.customerMessage({ name: 'Dana', text: evil, mentionIds: ['U0AGENT01', 'W0AGENT02'], attachmentCount: 2 });
  const messageJson = JSON.stringify(message);
  assert.match(messageJson, /<@U0AGENT01> <@W0AGENT02> \*Dana\* wrote:/);
  assert.match(messageJson, /&lt;!channel&gt; &lt;https:\/\/evil.example\|click&gt; &amp; &lt;@U0AGENT01&gt;/);
  assert.match(messageJson, /2 attachments/);
  assert.ok(!messageJson.includes('<!channel>'));

  const draft = blocks.draftCard({ draftId: 'd'.repeat(64), draft: 'Hello & welcome', triage });
  const draftJson = JSON.stringify(draft);
  for (const id of ['draft_send', 'draft_edit', 'draft_discard']) assert.match(draftJson, new RegExp(id));
  assert.match(draftJson, /Needs a human/);
  assert.match(draftJson, /refund &lt;requested&gt;/);
  const noDraft = JSON.stringify(blocks.draftCard({ draftId: 'd', draft: null, triage: { ...triage, needsHuman: false, reasons: [] } }));
  assert.doesNotMatch(noDraft, /draft_send/);

  const resolved = JSON.stringify(blocks.draftResolvedCard({ draft: 'x', triage, outcome: 'sent', userId: 'U0AGENT01' }));
  assert.match(resolved, /Sent by <@U0AGENT01>/);
  const discarded = blocks.draftResolvedCard({ draft: 'x', triage, outcome: 'discarded', userId: 'U0AGENT01' });
  assert.match(JSON.stringify(discarded), /Discarded/);

  const modal = blocks.editDraftModal({ draftId: 'd1', draft: 'a'.repeat(5000) });
  assert.equal(modal.type, 'modal');
  assert.equal(modal.callback_id, 'draft_edit_submit');
  assert.equal(modal.private_metadata, 'd1');
  assert.equal(modal.blocks[0].block_id, 'reply');
  assert.equal(modal.blocks[0].element.action_id, 'text');
  assert.equal(modal.blocks[0].element.initial_value.length, 3000);
});

test('section text is truncated to 2900 characters without splitting entities', () => {
  const long = 'x'.repeat(2890) + '<<<<<<<<<<';
  const message = blocks.customerMessage({ name: 'Dana', text: long, mentionIds: [] });
  for (const block of message.blocks.filter((b) => b.type === 'section')) assert.ok(block.text.text.length <= 2900);
  const amp = blocks.customerMessage({ name: 'D', text: 'y'.repeat(2896) + '&', mentionIds: [] });
  const quoted = amp.blocks[1].text.text;
  assert.ok(quoted.length <= 2900);
  assert.doesNotMatch(quoted, /&(?!$|…)/);
});
