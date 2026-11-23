import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

function setup({ env = {}, seed = {}, readFails = false, globals } = {}) {
  const db = createFakeFirestore(seed);
  let reads = 0;
  const original = db.collection;
  db.collection = name => {
    const collection = original(name);
    return { ...collection, doc: id => {
      const ref = collection.doc(id);
      return { ...ref, get: async () => { if (name === 'runtimeSwitches') { reads++; if (readFails) throw new Error('firestore down'); } return ref.get(); } };
    } };
  };
  const mod = loadModule('src/lib/security/runtime-switch.ts', { env, ...(globals ? { globals } : {}), stubs: {
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'now' } },
    '@/lib/db/firestore': { firestore: () => db },
  } });
  return { mod, db, reads: () => reads };
}

test('the environment switch alone stops a feature, without reading Firestore', async () => {
  const { mod, reads } = setup({ env: { AI_GENERATION_ENABLED: 'false' } });
  assert.equal(await mod.featureEnabled('ai'), false);
  assert.equal(reads(), 0);
});

test('enabled by default: no variable and no document', async () => {
  const { mod } = setup();
  assert.equal(await mod.featureEnabled('ai'), true);
});

test('the Firestore switch stops a feature the environment allows, and only an explicit false does', async () => {
  assert.equal(await setup({ seed: { runtimeSwitches: { ai: { enabled: false, reason: 'manual' } } } }).mod.featureEnabled('ai'), false);
  assert.equal(await setup({ seed: { runtimeSwitches: { ai: { enabled: true } } } }).mod.featureEnabled('ai'), true);
  assert.equal(await setup({ seed: { runtimeSwitches: { ai: { reason: 'no flag' } } } }).mod.featureEnabled('ai'), true);
});

test('the Firestore switch cannot re-enable what the environment turned off', async () => {
  const { mod } = setup({ env: { AI_GENERATION_ENABLED: 'false' }, seed: { runtimeSwitches: { ai: { enabled: true } } } });
  assert.equal(await mod.featureEnabled('ai'), false);
});

test('the switch is read once per 30 seconds per instance', async () => {
  let offset = 0;
  const clock = { now: () => Date.now() + offset };
  const { mod, reads } = setup({ globals: { Date: clock } });
  for (let i = 0; i < 5; i++) await mod.featureEnabled('ai');
  assert.equal(reads(), 1);
  offset = 29_000;
  await mod.featureEnabled('ai');
  assert.equal(reads(), 1);
  offset = 31_000;
  await mod.featureEnabled('ai');
  assert.equal(reads(), 2);
});

test('a read error falls back to the environment value, briefly cached', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { mod, reads } = setup({ readFails: true });
    assert.equal(await mod.featureEnabled('ai'), true);
    assert.equal(await mod.featureEnabled('ai'), true);
    assert.equal(reads(), 1, 'an outage is not turned into a read per request');
    const off = setup({ readFails: true, env: { AI_GENERATION_ENABLED: 'false' } });
    assert.equal(await off.mod.featureEnabled('ai'), false);
  } finally { console.warn = warn; }
});

test('disableFeature writes the switch and one audit event, takes effect locally at once, and is idempotent', async () => {
  const { mod, db } = setup();
  assert.equal(await mod.featureEnabled('ai'), true);
  const first = await mod.disableFeature('ai', 'budget', { threshold: 1, budget: 'Monthly' });
  assert.equal(first.changed, true);
  assert.equal(await mod.featureEnabled('ai'), false, 'the local cache does not wait out its 30 seconds');
  const stored = db.docs('runtimeSwitches').ai;
  assert.equal(stored.enabled, false);
  assert.equal(stored.reason, 'budget');
  assert.equal(stored.threshold, 1);
  assert.ok(stored.at);
  const audit = Object.values(db.docs('securityAuditEvents'));
  assert.equal(audit.length, 1);
  assert.deepEqual({ ...audit[0], createdAt: undefined }, { actorUid: 'system:budget', action: 'runtime.switch.disable', feature: 'ai', reason: 'budget', threshold: 1, budget: 'Monthly', createdAt: undefined });
  const again = await mod.disableFeature('ai', 'budget', { threshold: 1 });
  assert.equal(again.changed, false);
  assert.equal(Object.keys(db.docs('securityAuditEvents')).length, 1, 'repeated notifications do not repeat the audit event');
});

test('nothing in the module can turn a switch back on', () => {
  const mod = setup().mod;
  assert.deepEqual(Object.keys(mod).sort(), ['disableFeature', 'featureEnabled', 'resetRuntimeSwitchCache']);
});
