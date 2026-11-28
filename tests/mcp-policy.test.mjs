import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

// The MCP adapter of the operation registry (src/lib/mcp/policy.ts), over the real registry and a recording budget step.
function setup({ denial = null, budgetThrows = false } = {}) {
  const calls = [];
  const registry = loadModule('src/lib/security/operations.ts', { stubs: { '@/lib/headhunters/messages': { HEADHUNTER_API_ERRORS: { SIGN_IN: 's', FORBIDDEN: 'f' } } } });
  const mcp = loadModule('src/lib/mcp/policy.ts', { stubs: {
    '@/lib/security/operations': registry,
    '@/lib/security/budgets': { enforceOperationBudgets: async (operation, user, ip) => { calls.push({ operation, user, ip }); if (budgetThrows) throw new Error('boom'); return denial; } },
  } });
  return { mcp, calls, registry };
}
const plain = value => JSON.parse(JSON.stringify(value));
const caller = { ip: '203.0.113.9', user: null };

function capture() {
  const lines = { info: [], error: [] };
  const original = { info: console.info, error: console.error };
  console.info = line => lines.info.push(JSON.parse(line));
  console.error = line => lines.error.push(JSON.parse(line));
  return { lines, restore: () => Object.assign(console, original) };
}

test('a tool exists only under a registered operation an anonymous caller can use', () => {
  const { mcp } = setup();
  const run = async () => 1;
  assert.throws(() => mcp.defineTool({ name: 't', operation: 'no.such.operation', run }), /Unknown operation/);
  assert.throws(() => mcp.defineTool({ name: 't', operation: 'constructor', run }), /Unknown operation/, 'prototype keys are not operations');
  for (const id of ['profile.read', 'proposal.list']) assert.throws(() => mcp.defineTool({ name: 't', operation: id, run }), /no user identity yet/, id);
  assert.throws(() => mcp.defineTool({ name: 't', operation: 'moderation.account.queue', run }), /no moderator identity/);
  assert.throws(() => mcp.defineTool({ name: 't', operation: 'maintenance.budget', run }), /no scheduler identity/);
  assert.throws(() => mcp.defineTool({ name: 't', operation: 'support.message', run }), /human check/, 'a bot check cannot be skipped by calling through MCP');
  for (const id of ['project.list', 'catalog.read', 'agency.list', 'mcp.transport', 'seo.llms']) assert.equal(mcp.defineTool({ name: 't', operation: id, run }).operation, id, id);
});

test('every registry operation is classified: only identity-free ones can become tools', () => {
  const { mcp, registry } = setup();
  const allowed = [];
  for (const [id, operation] of Object.entries(registry.operations)) {
    try { mcp.defineTool({ name: 't', operation: id, run: async () => 1 }); allowed.push(id); } catch { /* refused */ }
    const needsIdentity = ['user', 'moderator', 'scheduler'].includes(operation.auth.kind) || operation.account === 'active' || operation.membership || operation.humanCheck;
    assert.equal(allowed.includes(id), !needsIdentity, id);
  }
});

test('a call spends the operation budgets as an anonymous caller at the caller address, then runs the handler', async () => {
  const { mcp, calls, registry } = setup();
  const seen = [];
  const tool = mcp.defineTool({ name: 'search_projects', operation: 'project.list', run: async (input, who) => { seen.push([input, who]); return { found: 2 }; } });
  const out = capture();
  try {
    const result = await tool.call({ q: 'x' }, caller);
    assert.deepEqual(plain(result), { ok: true, data: { found: 2 } });
  } finally { out.restore(); }
  assert.deepEqual(plain(seen), [[{ q: 'x' }, caller]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, registry.operations['project.list']);
  assert.equal(calls[0].user, null);
  assert.equal(calls[0].ip, '203.0.113.9');
});

test('a budget denial becomes an English outcome with retryAfter, and the handler never runs', async () => {
  const denial = Response.json({ code: 'RATE_LIMITED', error: 'בוצעו יותר מדי פעולות. המתינו ונסו שוב.' }, { status: 429, headers: { 'Retry-After': '42' } });
  const { mcp } = setup({ denial });
  let ran = false;
  const tool = mcp.defineTool({ name: 't', operation: 'catalog.read', run: async () => { ran = true; } });
  const out = capture();
  try {
    assert.deepEqual(plain(await tool.call({}, caller)), { ok: false, error: 'Rate limit reached. Retry after 42 seconds.', retryAfter: 42 });
    assert.equal(out.lines.info[0].outcome, 'denied');
  } finally { out.restore(); }
  assert.equal(ran, false);
});

test('a denial that is not a rate limit gets a fixed English refusal, never the limiter body', async () => {
  const cases = [
    new Response('nope', { status: 503 }),
    Response.json({ error: 'בוצעו יותר מדי פעולות.' }, { status: 429 }),
    Response.json({ error: 'בוצעו יותר מדי פעולות.' }, { status: 403, headers: { 'Retry-After': '9' } }),
    Response.json({ error: 'x' }, { status: 429, headers: { 'Retry-After': 'soon' } }),
  ];
  for (const denial of cases) {
    const { mcp } = setup({ denial });
    const tool = mcp.defineTool({ name: 't', operation: 'catalog.read', run: async () => 1 });
    const out = capture();
    try {
      const result = plain(await tool.call({}, caller));
      assert.deepEqual(result, { ok: false, error: 'The request was refused.' });
    } finally { out.restore(); }
  }
});

test('the retry hint reads naturally for one second and rounds a fraction up', async () => {
  for (const [header, expected] of [['1', 'Rate limit reached. Retry after 1 second.'], ['2.2', 'Rate limit reached. Retry after 3 seconds.']]) {
    const { mcp } = setup({ denial: Response.json({}, { status: 429, headers: { 'Retry-After': header } }) });
    const tool = mcp.defineTool({ name: 't', operation: 'catalog.read', run: async () => 1 });
    const out = capture();
    try { assert.equal((await tool.call({}, caller)).error, expected); } finally { out.restore(); }
  }
});

test('a handler exception becomes a generic error: no message, no stack, one structured error line', async () => {
  const { mcp } = setup();
  const tool = mcp.defineTool({ name: 'get_project', operation: 'project.list', run: async () => { throw Object.assign(new TypeError('secret-token-123 at /srv/app/db.ts:9'), {}); } });
  const out = capture();
  try {
    const result = await tool.call({ slug: 'x' }, caller);
    assert.deepEqual(plain(result), { ok: false, error: mcp.MCP_GENERIC_ERROR });
    assert.deepEqual(out.lines.error, [{ event: 'mcp_tool_error', severity: 'ERROR', tool: 'get_project', operation: 'project.list', error: 'TypeError' }]);
    assert.equal(JSON.stringify(out.lines).includes('secret-token'), false);
    assert.equal(out.lines.info[0].outcome, 'error');
  } finally { out.restore(); }
});

test('a failing budget step is a generic error too, never an unmetered call', async () => {
  const { mcp } = setup({ budgetThrows: true });
  let ran = false;
  const tool = mcp.defineTool({ name: 't', operation: 'catalog.read', run: async () => { ran = true; } });
  const out = capture();
  try { assert.deepEqual(plain(await tool.call({}, caller)), { ok: false, error: mcp.MCP_GENERIC_ERROR }); } finally { out.restore(); }
  assert.equal(ran, false);
});

test('every call logs exactly one line with tool, operation, outcome and duration, and no address or arguments', async () => {
  const { mcp } = setup();
  const ok = mcp.defineTool({ name: 'list_agencies', operation: 'agency.list', run: async () => ({ secret: 'payload' }) });
  const out = capture();
  try {
    await ok.call({ query: 'private-query' }, { ip: '198.51.100.77', user: null });
    assert.equal(out.lines.info.length, 1);
    const [line] = out.lines.info;
    assert.deepEqual(Object.keys(line).sort(), ['event', 'ms', 'operation', 'outcome', 'severity', 'tool']);
    assert.deepEqual({ ...line, ms: 0 }, { event: 'mcp_tool_call', severity: 'INFO', tool: 'list_agencies', operation: 'agency.list', outcome: 'ok', ms: 0 });
    assert.ok(Number.isFinite(line.ms) && line.ms >= 0);
    const text = JSON.stringify(out.lines);
    assert.equal(text.includes('198.51.100.77') || text.includes('private-query') || text.includes('payload'), false);
  } finally { out.restore(); }
});
