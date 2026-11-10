import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './helpers/load-ts.mjs';

function fixture() {
  const records = new Map();
  let queue = Promise.resolve();
  const db = {
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction(work) {
      // Serial transactions model the atomic read/check/write contract; two
      // independently loaded modules below share only this backing store.
      const run = queue.then(() => work({
        get: async ref => ({ get: key => records.get(ref.id)?.[key] }),
        set: (ref, value) => records.set(ref.id, value),
      }));
      queue = run.catch(() => undefined);
      return run;
    },
  };
  const load = (database = db) => loadModule('src/lib/security/rate-limit.ts', { stubs: {
    'node:crypto': { createHash },
    'firebase-admin/firestore': { Timestamp: { fromMillis: value => value } },
    '@/lib/db/firestore': { firestore: () => database },
  } });
  return { records, load };
}

test('two instances share one account budget under parallel requests; other accounts/actions are isolated', async () => {
  const { records, load } = fixture();
  const instances = [load(), load()];
  const responses = await Promise.all(Array.from({ length: 32 }, (_, i) => instances[i % 2].enforceActionLimit('account-one', 'message.send')));
  assert.equal(responses.filter(response => response === null).length, 30);
  assert.equal(responses.filter(response => response?.status === 429).length, 2);
  const denied = responses.find(Boolean);
  assert.ok(Number(denied.headers.get('retry-after')) >= 1);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.equal(await instances[0].enforceActionLimit('account-two', 'message.send'), null);
  assert.equal(await instances[1].enforceActionLimit('account-one', 'project.create'), null);
  assert.equal(records.size, 3, 'fixed key per account/action, no document per request');
  assert.equal(JSON.stringify([...records]).includes('account-one'), false);
});

test('daily budget survives short-window resets; expired windows reset without relying on TTL deletion', async () => {
  const { records, load } = fixture();
  const limiter = load();
  await limiter.enforceActionLimit('account', 'ai.profile');
  const record = [...records.values()][0];
  record.windows[0].start -= 600_000;
  record.windows[1].count = 20;
  const denied = await limiter.enforceActionLimit('account', 'ai.profile');
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).code, 'RATE_LIMITED');
  record.windows[1].start -= 86_400_000;
  assert.equal(await limiter.enforceActionLimit('account', 'ai.profile'), null);
  const reset = [...records.values()][0];
  assert.deepEqual(Array.from(reset.windows, window => window.count), [1, 1]);
});

test('a database failure closes the action and does not return provider details', async () => {
  const { load } = fixture();
  const response = await load({ collection() { throw new Error('PRIVATE_DATABASE_ERROR'); } }).enforceActionLimit('account', 'source.upload');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.doesNotMatch(await response.text(), /PRIVATE_DATABASE_ERROR|account/);
});
