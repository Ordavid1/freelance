import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './helpers/load-ts.mjs';

function fixture({ failing = false } = {}) {
  const records = new Map();
  let queue = Promise.resolve();
  const db = {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction(work) {
      if (failing) return Promise.reject(new Error('firestore down'));
      const run = queue.then(() => work({
        get: async ref => ({ get: key => records.get(ref.id)?.[key] }),
        set: (ref, value) => records.set(ref.id, value),
      }));
      queue = run.catch(() => undefined);
      return run;
    },
  };
  const load = (env = {}) => loadModule('src/lib/security/rate-limit.ts', { env, stubs: {
    'node:crypto': { createHash },
    'firebase-admin/firestore': { Timestamp: { fromMillis: value => value } },
    '@/lib/db/firestore': { firestore: () => db },
  } });
  return { records, load };
}
const HOUR = 3_600_000;

test('a global budget is one shared document per feature and stops everyone at the hourly ceiling', async () => {
  const { records, load } = fixture();
  const limiter = load({ GLOBAL_BUDGET_AI_PROFILE_HOURLY: '5' });
  const instances = [limiter, load({ GLOBAL_BUDGET_AI_PROFILE_HOURLY: '5' })];
  const answers = await Promise.all(Array.from({ length: 8 }, (_, i) => instances[i % 2].enforceGlobalBudget('ai.profile')));
  assert.equal(answers.filter(answer => answer === null).length, 5);
  const denied = answers.find(Boolean);
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).code, 'FEATURE_BUDGET_EXHAUSTED');
  assert.ok(Number(denied.headers.get('retry-after')) >= 1);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.equal(records.size, 1, 'one document per feature, not per request or per caller');
  assert.deepEqual([...records.keys()], ['global:ai.profile']);
  // Other features have their own budget.
  assert.equal(await limiter.enforceGlobalBudget('ai.projectBrief'), null);
  assert.equal(records.size, 2);
});

test('the daily ceiling holds after the hourly window rolls over, and expired windows reset by themselves', async () => {
  const { records, load } = fixture();
  const limiter = load({ GLOBAL_BUDGET_IMPORT_XPLACE_HOURLY: '100', GLOBAL_BUDGET_IMPORT_XPLACE_DAILY: '2' });
  assert.equal(await limiter.enforceGlobalBudget('import.xplace'), null);
  assert.equal(await limiter.enforceGlobalBudget('import.xplace'), null);
  const record = records.get('global:import.xplace');
  record.windows[0].start -= HOUR;
  const denied = await limiter.enforceGlobalBudget('import.xplace');
  assert.equal(denied.status, 503, 'the daily budget is spent even though the hour is new');
  record.windows[1].start -= 24 * HOUR;
  assert.equal(await limiter.enforceGlobalBudget('import.xplace'), null);
  assert.deepEqual(Array.from(records.get('global:import.xplace').windows, window => window.count), [1, 1]);
});

test('the document carries a TTL field and no caller identity', async () => {
  const { records, load } = fixture();
  await load().enforceGlobalBudget('ai.supportTriage');
  const record = records.get('global:ai.supportTriage');
  assert.ok(Number.isFinite(record.expiresAt) && record.expiresAt > Date.now());
  assert.deepEqual(Object.keys(record).sort(), ['expiresAt', 'windows']);
});

test('defaults apply without environment, and invalid overrides are ignored', async () => {
  const { load } = fixture();
  const defaults = load().globalBudgetPolicies('ai.profile');
  assert.deepEqual(Array.from(defaults, policy => [policy.windowMs, policy.max]), [[HOUR, 60], [24 * HOUR, 300]]);
  const tuned = load({ GLOBAL_BUDGET_AI_PROJECT_BRIEF_HOURLY: '7', GLOBAL_BUDGET_AI_PROJECT_BRIEF_DAILY: 'many' }).globalBudgetPolicies('ai.projectBrief');
  assert.deepEqual(Array.from(tuned, policy => policy.max), [7, 1000]);
  assert.equal(load({ GLOBAL_BUDGET_AI_PROFILE_HOURLY: '0' }).globalBudgetPolicies('ai.profile')[0].max, 0, 'zero switches a feature off');
  for (const bad of ['-3', '2.5', '']) assert.equal(load({ GLOBAL_BUDGET_AI_PROFILE_HOURLY: bad }).globalBudgetPolicies('ai.profile')[0].max, 60, bad);
});

test('every feature key maps to its documented environment name', async () => {
  const { load } = fixture();
  const env = { GLOBAL_BUDGET_AI_PROFILE_HOURLY: '1', GLOBAL_BUDGET_AI_PROJECT_BRIEF_HOURLY: '2', GLOBAL_BUDGET_AI_SUPPORT_TRIAGE_HOURLY: '3', GLOBAL_BUDGET_IMPORT_XPLACE_HOURLY: '4' };
  const limiter = load(env);
  assert.deepEqual(['ai.profile', 'ai.projectBrief', 'ai.supportTriage', 'import.xplace'].map(feature => limiter.globalBudgetPolicies(feature)[0].max), [1, 2, 3, 4]);
});

test('a budget that cannot be read fails closed: no spend, an unavailable answer, nothing about the caller logged', async () => {
  const { load } = fixture({ failing: true });
  const warn = console.warn;
  const logs = [];
  console.warn = value => logs.push(String(value));
  try {
    const limiter = load();
    const response = await limiter.enforceGlobalBudget('ai.profile');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'SECURITY_CHECK_UNAVAILABLE');
    assert.equal((await limiter.consumeGlobalBudget('ai.profile')).status, 'unavailable');
  } finally { console.warn = warn; }
  assert.ok(logs.every(line => line === 'security_rate_limit_unavailable'));
});

test('consumeGlobalBudget reports ok, exhausted and unavailable without building a response', async () => {
  const { load } = fixture();
  const limiter = load({ GLOBAL_BUDGET_AI_SUPPORT_TRIAGE_HOURLY: '1' });
  assert.equal((await limiter.consumeGlobalBudget('ai.supportTriage')).status, 'ok');
  const exhausted = await limiter.consumeGlobalBudget('ai.supportTriage');
  assert.equal(exhausted.status, 'exhausted');
  assert.ok(exhausted.retryAfter >= 1);
});

test('anonymous limits are per client address and action, shared by instances, and store only a hash', async () => {
  const { records, load } = fixture();
  const instances = [load(), load()];
  const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => instances[i % 2].enforceAnonymousLimit('203.0.113.7', 'support.message')));
  assert.equal(answers.filter(answer => answer === null).length, 10);
  const denied = answers.find(Boolean);
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).code, 'RATE_LIMITED');
  assert.ok(Number(denied.headers.get('retry-after')) >= 1);
  // A different address, and a different action of the same address, have their own budget.
  assert.equal(await instances[0].enforceAnonymousLimit('203.0.113.8', 'support.message'), null);
  assert.equal(await instances[0].enforceAnonymousLimit('203.0.113.7', 'notifications.unsubscribe'), null);
  assert.equal(records.size, 3);
  assert.equal(JSON.stringify([...records]).includes('203.0.113'), false, 'the address is hashed');
  for (const id of records.keys()) assert.match(id, /^[0-9a-f]{64}$/);
});

test('the per-address budget is a window: the daily budget survives the short window resetting', async () => {
  const { records, load } = fixture();
  const limiter = load();
  await limiter.enforceAnonymousLimit('198.51.100.1', 'notifications.unsubscribe');
  const record = [...records.values()][0];
  record.windows[0].start -= 600_000;
  record.windows[1].count = 100;
  assert.equal((await limiter.enforceAnonymousLimit('198.51.100.1', 'notifications.unsubscribe')).status, 429);
});

test('an anonymous limiter outage fails closed', async () => {
  const { load } = fixture({ failing: true });
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal((await load().enforceAnonymousLimit('203.0.113.7', 'support.message')).status, 503); } finally { console.warn = warn; }
});

test('per-account and anonymous budgets never share a document', async () => {
  const { records, load } = fixture();
  const limiter = load();
  await limiter.enforceActionLimit('203.0.113.7', 'support.message');
  await limiter.enforceAnonymousLimit('203.0.113.7', 'support.message');
  assert.equal(records.size, 2);
});

test('profile.update and support.message have per-account budgets', async () => {
  const { load } = fixture();
  const limiter = load();
  const results = [];
  for (let i = 0; i < 21; i++) results.push(await limiter.enforceActionLimit('uid', 'profile.update'));
  assert.equal(results.filter(result => result === null).length, 20);
  assert.equal(results.at(-1).status, 429);
});
