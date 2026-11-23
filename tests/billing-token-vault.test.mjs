import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
registerHooks({resolve(specifier, context, next) {
  if(specifier === 'server-only') return {url:'data:text/javascript,export{}',shortCircuit:true};
  if(specifier.startsWith('@/')) return next(new URL('../src/'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  if(specifier === './cardcom') return next(new URL('../src/lib/billing/cardcom.ts',import.meta.url).href,context);
  return next(specifier,context);
}});
const KEY = 'projects/p/locations/me-west1/keyRings/freelance-billing/cryptoKeys/cardcom-tokens';
const VERSION = `${KEY}/cryptoKeyVersions/3`;
const vault = await import('../src/lib/billing/token-vault.ts');
const { sealTokens } = await import('../scripts/billing/seal-tokens.ts');
// Row-map Firestore double (keeps Timestamp instances, which the shared fake flattens); transactions are serialized.
function createDb() {
  const rows = new Map(); let tail = Promise.resolve();
  const snapshot = (key) => ({ exists: rows.has(key), data: () => rows.get(key), id: key.split('/')[1], ref: ref(key) });
  const ref = (key) => ({ key, id: key.split('/')[1], get: async () => snapshot(key), set: async (v, o) => { rows.set(key, o?.merge ? { ...rows.get(key), ...v } : v); }, update: async (v) => { rows.set(key, { ...rows.get(key), ...v }); } });
  return {
    docs: (name) => Object.fromEntries([...rows].filter(([k]) => k.startsWith(name + '/')).map(([k, v]) => [k.split('/')[1], v])),
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`), get: async () => ({ docs: [...rows.keys()].filter((k) => k.startsWith(name + '/')).map(snapshot) }) }),
    runTransaction: (fn) => {
      const run = tail.then(async () => {
        const writes = [];
        const tx = { get: async (r) => { assert.equal(writes.length, 0, 'reads before writes'); return snapshot(r.key); }, create: (r, v) => writes.push(() => rows.set(r.key, v)), set: (r, v, o) => writes.push(() => rows.set(r.key, o?.merge ? { ...rows.get(r.key), ...v } : v)), update: (r, v) => writes.push(() => rows.set(r.key, { ...rows.get(r.key), ...v })) };
        const value = await fn(tx); for (const w of writes) w(); return value;
      });
      tail = run.catch(() => {}); return run;
    },
  };
}
let db;
await mock.module('../src/lib/db/firestore.ts', { namedExports: { firestore: () => db } });
let access = { state: 'expired' };
await mock.module('../src/lib/membership/access.ts', { namedExports: { getMembershipAccess: async () => access } });
const service = await import('../src/lib/billing/service.ts');

// Stub KMS: real AES-256-GCM with the request's AAD, so a wrong AAD fails like it would at Google.
const kmsKey = randomBytes(32);
let kmsCalls = []; let kmsDown = false;
const b64 = (buffer) => buffer.toString('base64');
function stubKms() {
  vault.useKmsTransport(async (url, body) => {
    kmsCalls.push(url.endsWith(':encrypt') ? 'encrypt' : 'decrypt');
    if (kmsDown) throw Object.assign(new Error('kms secret-token-detail'), { response: { status: 503 } });
    assert.ok(url.startsWith(`https://cloudkms.googleapis.com/v1/${KEY}:`), 'decrypt/encrypt target the CryptoKey, not a version');
    const aadBytes = Buffer.from(body.additionalAuthenticatedData, 'base64');
    assert.equal(body.additionalAuthenticatedDataCrc32c, String(vault.crc32c(aadBytes)));
    if (url.endsWith(':encrypt')) {
      const plaintext = Buffer.from(body.plaintext, 'base64'); const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', kmsKey, iv); cipher.setAAD(aadBytes);
      const ct = Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
      return { name: VERSION, ciphertext: b64(ct), ciphertextCrc32c: String(vault.crc32c(ct)), verifiedPlaintextCrc32c: body.plaintextCrc32c === String(vault.crc32c(plaintext)), verifiedAdditionalAuthenticatedDataCrc32c: true, protectionLevel: 'SOFTWARE' };
    }
    const ct = Buffer.from(body.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', kmsKey, ct.subarray(0, 12)); decipher.setAAD(aadBytes); decipher.setAuthTag(ct.subarray(ct.length - 16));
    let plaintext;
    try { plaintext = Buffer.concat([decipher.update(ct.subarray(12, ct.length - 16)), decipher.final()]); }
    catch { throw Object.assign(new Error('INVALID_ARGUMENT'), { response: { status: 400 } }); }
    return { plaintext: b64(plaintext), plaintextCrc32c: String(vault.crc32c(plaintext)), usedPrimary: true };
  });
}
const owner = { uid: 'u', terminal: 123 };
const id = '11111111-1111-4111-8111-111111111111';
const lp = '22222222-2222-4222-8222-222222222222';
const result = (extra = {}) => ({ ResponseCode: 0, Operation: 'ChargeAndCreateToken', ReturnValue: id, LowProfileId: lp, TerminalNumber: 123, TranzactionId: 45, TokenInfo: { Token: 'secret-card-token', TokenExDateMonth: 1, TokenExDateYear: 2030 }, TranzactionInfo: { ResponseCode: 0, TerminalNumber: 123, Amount: 19.99, CoinId: 1, TranzactionId: 45, Last4CardDigitsString: '0008' }, DocumentInfo: { ResponseCode: 0, DocumentNumber: 90 }, ...extra });
const fakeFetch = (fn) => mock.method(globalThis, 'fetch', async (url, options) => Response.json(await fn(JSON.parse(options.body), url)));
const sub = () => db.docs('billingSubscriptions').u;
let logs;
beforeEach(() => {
  db = createDb(); kmsCalls = []; kmsDown = false; access = { state: 'expired' };
  stubKms();
  Object.assign(process.env, { BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '123', CARDCOM_API_NAME: 'fake', NEXT_PUBLIC_SITE_URL: 'https://example.com', BILLING_TOKEN_KMS_KEY: KEY });
  logs = [];
  for (const level of ['warn', 'error', 'info', 'log']) mock.method(console, level, (...args) => logs.push(args.join(' ')));
});
const seedOrder = async (extra = {}) => {
  await db.collection('billingOrders').doc(id).set({ uid: 'u', status: 'pending', lowProfileId: lp, terminal: 123, amountAgorot: 1999, name: 'Test', email: 't@example.com', ...extra });
  await db.collection('billingSubscriptions').doc('u').set({ pendingOrderId: id });
};
const noLeak = () => { const text = JSON.stringify(db.docs('billingSubscriptions')) + logs.join('\n'); assert.equal(text.includes('secret-card-token'), false); };

test('seal and open round trip with CRC checks; the stored shape carries version, key and ciphertext only', async () => {
  const sealed = await vault.sealToken('secret-card-token', owner);
  assert.deepEqual(Object.keys(sealed).sort(), ['ct', 'key', 'v']);
  assert.equal(sealed.v, 1); assert.equal(sealed.key, VERSION); assert.equal(sealed.ct.includes('secret-card-token'), false);
  assert.equal(await vault.openToken({ tokenSealed: sealed }, owner), 'secret-card-token');
  assert.equal(vault.hasStoredCard({ tokenSealed: sealed }), true);
  assert.equal(vault.aad(owner), 'freelance-billing-token:v1:u:123');
  assert.equal(vault.crc32c(Buffer.from('123456789')), 0xe3069283);
});
test('opening with another uid or terminal is rejected by the AAD binding', async () => {
  const sealed = await vault.sealToken('secret-card-token', owner);
  await assert.rejects(vault.openToken({ tokenSealed: sealed }, { uid: 'other', terminal: 123 }), { code: 'TOKEN_VAULT_UNAVAILABLE', status: 503 });
  await assert.rejects(vault.openToken({ tokenSealed: sealed }, { uid: 'u', terminal: 124 }), { code: 'TOKEN_VAULT_UNAVAILABLE' });
});
test('plaintext is written only when the key is unconfigured, with a once-per-instance warning', async () => {
  delete process.env.BILLING_TOKEN_KMS_KEY;
  assert.deepEqual(await vault.cardTokenFields('secret-card-token', owner), { token: 'secret-card-token', tokenSealed: null });
  await vault.cardTokenFields('secret-card-token', owner);
  assert.ok(logs.filter((line) => line.includes('billing_token_unencrypted')).length <= 1);
  assert.equal(kmsCalls.length, 0);
  process.env.BILLING_TOKEN_KMS_KEY = KEY;
  const fields = await vault.cardTokenFields('secret-card-token', owner);
  assert.equal(fields.token, null); assert.equal(vault.isSealedToken(fields.tokenSealed), true);
});
test('a configured key that fails never falls back to plaintext', async () => {
  kmsDown = true;
  await assert.rejects(vault.cardTokenFields('secret-card-token', owner), { code: 'TOKEN_VAULT_UNAVAILABLE', status: 503 });
  process.env.BILLING_TOKEN_KMS_KEY = 'not-a-key';
  await assert.rejects(vault.cardTokenFields('secret-card-token', owner), { code: 'TOKEN_VAULT_UNAVAILABLE' });
  assert.equal(logs.join('\n').includes('secret-token-detail'), false);
});
test('a sealed token cannot be opened when the key is unset, tampered, or from another key', async () => {
  const sealed = await vault.sealToken('secret-card-token', owner);
  delete process.env.BILLING_TOKEN_KMS_KEY;
  await assert.rejects(vault.openToken({ tokenSealed: sealed }, owner), { code: 'TOKEN_VAULT_UNAVAILABLE' });
  process.env.BILLING_TOKEN_KMS_KEY = KEY;
  await assert.rejects(vault.openToken({ tokenSealed: { ...sealed, ct: b64(randomBytes(40)) } }, owner), { code: 'TOKEN_VAULT_UNAVAILABLE' });
  await assert.rejects(vault.openToken({ tokenSealed: { ...sealed, key: 'projects/x/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1' } }, owner), { code: 'TOKEN_VAULT_UNAVAILABLE' });
  await assert.rejects(vault.openToken({ token: 'legacy', tokenSealed: { v: 2 } }, owner), { code: 'TOKEN_VAULT_UNAVAILABLE' });
});
test('responses that fail integrity checks are rejected', async () => {
  vault.useKmsTransport(async () => ({ name: VERSION, ciphertext: b64(Buffer.from('x')), ciphertextCrc32c: '1', verifiedPlaintextCrc32c: true, verifiedAdditionalAuthenticatedDataCrc32c: true }));
  await assert.rejects(vault.sealToken('t', owner), { code: 'TOKEN_VAULT_UNAVAILABLE' });
  vault.useKmsTransport(async () => ({ name: VERSION, ciphertext: b64(Buffer.from('x')), ciphertextCrc32c: String(vault.crc32c(Buffer.from('x'))), verifiedPlaintextCrc32c: false, verifiedAdditionalAuthenticatedDataCrc32c: true }));
  await assert.rejects(vault.sealToken('t', owner), { code: 'TOKEN_VAULT_UNAVAILABLE' });
});
test('hasStoredCard accepts either format and nothing else', () => {
  assert.equal(vault.hasStoredCard({ token: 'a' }), true);
  assert.equal(vault.hasStoredCard({ token: '', tokenSealed: null }), false);
  assert.equal(vault.hasStoredCard({ token: null, tokenSealed: { v: 1, key: 'k', ct: '' } }), false);
  assert.equal(vault.hasStoredCard(undefined), false);
});

test('checkout confirmation stores only the sealed token, and renewal sends the opened token to the gateway', async () => {
  await seedOrder();
  let gateway = fakeFetch(() => result());
  await service.confirmPayment(id, 'u'); gateway.mock.restore();
  assert.equal(sub().token, null); assert.equal(vault.isSealedToken(sub().tokenSealed), true); assert.equal(sub().autoRenew, true);
  noLeak();
  await db.collection('billingSubscriptions').doc('u').update({ nextChargeAt: Timestamp.fromMillis(Date.now() - 1000) });
  let sent;
  gateway = fakeFetch((body, url) => { if (url.endsWith('/Transactions/Transaction')) { sent = body; return { ...result().TranzactionInfo, TranzactionId: 46 }; } return {}; });
  await service.renewSubscription('u'); gateway.mock.restore();
  assert.equal(sent.Token, 'secret-card-token'); assert.equal(sent.CardExpirationMMYY, '0130');
  assert.equal(sub().renewalPending, false);
  noLeak();
});
test('a KMS outage on checkout leaves the order pending and stores no token, plaintext or sealed', async () => {
  await seedOrder(); kmsDown = true;
  const gateway = fakeFetch(() => result());
  await assert.rejects(service.confirmPayment(id, 'u'), { code: 'TOKEN_VAULT_UNAVAILABLE', status: 503 });
  gateway.mock.restore();
  assert.equal(db.docs('billingOrders')[id].status, 'pending'); assert.equal(sub().token, undefined); assert.equal(sub().tokenSealed, undefined);
  kmsDown = false;
  const retry = fakeFetch(() => result()); await service.confirmPayment(id, 'u'); retry.mock.restore();
  assert.equal(db.docs('billingOrders')[id].status, 'paid');
});
test('a KMS outage on renewal sends no charge and keeps the card', async () => {
  const sealed = await vault.sealToken('secret-card-token', owner);
  await db.collection('billingSubscriptions').doc('u').set({ autoRenew: true, status: 'active', tokenSealed: sealed, token: null, expiry: '0130', terminal: 123, name: 'T', email: 't@example.com', nextChargeAt: Timestamp.fromMillis(Date.now() - 1000) });
  kmsDown = true; let calls = 0;
  const gateway = fakeFetch(() => { calls++; return {}; });
  await assert.rejects(service.renewSubscription('u'), { code: 'TOKEN_VAULT_UNAVAILABLE' });
  gateway.mock.restore();
  assert.equal(calls, 0); assert.equal(sub().autoRenew, true); assert.deepEqual(sub().tokenSealed, sealed);
});
test('legacy plaintext tokens still renew while the key is configured (dual read)', async () => {
  await db.collection('billingSubscriptions').doc('u').set({ autoRenew: true, status: 'active', token: 'secret-card-token', expiry: '0130', terminal: 123, name: 'T', email: 't@example.com', nextChargeAt: Timestamp.fromMillis(Date.now() - 1000) });
  let sent; const gateway = fakeFetch((body) => { sent = body; return { ...result().TranzactionInfo, TranzactionId: 47 }; });
  await service.renewSubscription('u'); gateway.mock.restore();
  assert.equal(sent.Token, 'secret-card-token'); assert.equal(kmsCalls.length, 0);
});
test('card replacement and trial setup seal the new token; cancellation clears both fields', async () => {
  const old = await vault.sealToken('old-token', owner);
  kmsCalls = [];
  await db.collection('billingSubscriptions').doc('u').set({ autoRenew: true, status: 'trialing', tokenSealed: old, token: null, expiry: '0130', last4: '3838', terminal: 123, name: 'T', email: 't@example.com', nextChargeAt: Timestamp.fromMillis(Date.now() + 86400000) });
  let gateway = fakeFetch(() => ({ ResponseCode: 0, LowProfileId: lp, Url: 'https://secure.cardcom.solutions/replace' }));
  const session = await service.startCardUpdate({ uid: 'u', name: 'T', email: 't@example.com' }); gateway.mock.restore();
  assert.equal(kmsCalls.length, 0);
  await db.collection('billingOrders').doc(session.orderId).update({ lowProfileId: lp });
  gateway = fakeFetch(() => result({ ReturnValue: session.orderId, Operation: 'CreateTokenOnly' }));
  assert.equal((await service.confirmPayment(session.orderId, 'u')).cardUpdated, true); gateway.mock.restore();
  assert.equal(sub().token, null); assert.notDeepEqual(sub().tokenSealed, old);
  assert.equal(await vault.openToken(sub(), owner), 'secret-card-token');
  noLeak();
  await service.cancelSubscription('u');
  assert.equal(sub().token, null); assert.equal(sub().tokenSealed, null); assert.equal(vault.hasStoredCard(sub()), false);
});
test('a cancelled trial signup keeps no token in either field', async () => {
  await seedOrder({ kind: 'setup', trialEndsAt: Date.now() + 86400000 });
  await service.cancelSubscription('u');
  const gateway = fakeFetch(() => result({ Operation: 'CreateTokenOnly' })); await service.confirmPayment(id, 'u'); gateway.mock.restore();
  assert.equal(sub().autoRenew, false); assert.equal(vault.hasStoredCard(sub()), false);
});
test('with no key configured, behaviour is unchanged: plaintext token, no KMS call', async () => {
  delete process.env.BILLING_TOKEN_KMS_KEY; await seedOrder();
  const gateway = fakeFetch(() => result()); await service.confirmPayment(id, 'u'); gateway.mock.restore();
  assert.equal(sub().token, 'secret-card-token'); assert.equal(sub().tokenSealed ?? null, null); assert.equal(kmsCalls.length, 0);
});

test('migration: dry run writes nothing and never calls KMS; commit seals, verifies and clears plaintext; re-run is idempotent', async () => {
  const col = db.collection('billingSubscriptions');
  await col.doc('a').set({ token: 'tok-a', terminal: 123, autoRenew: true });
  await col.doc('b').set({ token: 'tok-b', terminal: 123, autoRenew: true });
  await col.doc('c').set({ token: null, tokenSealed: null, terminal: 123 });
  await col.doc('d').set({ tokenSealed: await vault.sealToken('tok-d', { uid: 'd', terminal: 123 }), token: null, terminal: 123 });
  kmsCalls = []; const before = JSON.stringify(db.docs('billingSubscriptions'));
  const dry = await sealTokens(db, { commit: false });
  assert.deepEqual(dry, { total: 4, alreadySealed: 1, plaintext: 2, migrated: 0, noCard: 1, failed: 0, changed: 0 });
  assert.equal(kmsCalls.length, 0); assert.equal(JSON.stringify(db.docs('billingSubscriptions')), before);
  const done = await sealTokens(db, { commit: true });
  assert.equal(done.migrated, 2); assert.equal(done.failed, 0);
  const docs = db.docs('billingSubscriptions');
  assert.equal(docs.a.token, null); assert.equal(await vault.openToken(docs.a, { uid: 'a', terminal: 123 }), 'tok-a');
  assert.equal(await vault.openToken(docs.b, { uid: 'b', terminal: 123 }), 'tok-b');
  assert.equal(JSON.stringify(docs).includes('"tok-a"'), false);
  const again = await sealTokens(db, { commit: true });
  assert.deepEqual(again, { total: 4, alreadySealed: 3, plaintext: 0, migrated: 0, noCard: 1, failed: 0, changed: 0 });
});
test('migration keeps the plaintext when sealing or verification fails', async () => {
  await db.collection('billingSubscriptions').doc('a').set({ token: 'tok-a', terminal: 123 });
  await db.collection('billingSubscriptions').doc('b').set({ token: 'tok-b' });
  kmsDown = true;
  let counts = await sealTokens(db, { commit: true });
  assert.equal(counts.failed, 2); assert.equal(db.docs('billingSubscriptions').a.token, 'tok-a');
  kmsDown = false;
  const lying = { seal: vault.sealToken, open: async () => 'something-else' };
  counts = await sealTokens(db, { commit: true, vault: lying });
  assert.equal(counts.migrated, 0); assert.equal(db.docs('billingSubscriptions').a.token, 'tok-a'); assert.equal(db.docs('billingSubscriptions').a.tokenSealed, undefined);
  assert.equal(logs.join('\n').includes('tok-a'), false);
});
