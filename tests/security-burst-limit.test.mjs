import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const burst = loadModule('src/lib/security/burst-limit.ts');
const { burstLimits, consumeBurst, enforceBurstLimit, resetBurstLimits, burstTrackedKeys, BURST_MAX_KEYS } = burst;
const [PER_MINUTE, PER_TEN_MINUTES] = burstLimits['mcp.request'];
const T0 = Math.floor(1_800_000_000_000 / 600_000) * 600_000; // aligned to the start of both windows
beforeEach(() => resetBurstLimits());

test('the MCP limits are 120 per minute and 600 per ten minutes', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(burstLimits)), { 'mcp.request': [{ windowMs: 60_000, max: 120 }, { windowMs: 600_000, max: 600 }] });
});

test('calls are allowed up to the minute ceiling, then denied with the seconds until the window ends', () => {
  for (let i = 0; i < PER_MINUTE.max; i++) assert.equal(consumeBurst('203.0.113.9', 'mcp.request', T0 + 1000), 0, `call ${i + 1}`);
  assert.equal(consumeBurst('203.0.113.9', 'mcp.request', T0 + 1000), 59);
  assert.equal(consumeBurst('203.0.113.9', 'mcp.request', T0 + 59_000), 1);
  assert.equal(consumeBurst('203.0.113.9', 'mcp.request', T0 + 59_999), 1, 'never reports 0 while still blocked');
});

test('the window rolls over: the next minute starts a new count', () => {
  for (let i = 0; i < PER_MINUTE.max; i++) consumeBurst('a', 'mcp.request', T0);
  assert.ok(consumeBurst('a', 'mcp.request', T0 + 59_999) > 0);
  assert.equal(consumeBurst('a', 'mcp.request', T0 + 60_000), 0);
});

test('every window is checked before counting, and the longer window blocks with its own retry time', () => {
  // 5 minutes x 120 = 600: the ten-minute ceiling is hit at the fifth minute, whatever the minute window says.
  for (let minute = 0; minute < 5; minute++) for (let i = 0; i < PER_MINUTE.max; i++) assert.equal(consumeBurst('b', 'mcp.request', T0 + minute * 60_000), 0);
  const now = T0 + 5 * 60_000 + 10_000;
  assert.equal(consumeBurst('b', 'mcp.request', now), 290, 'seconds until the ten-minute window ends, not the minute one');
});

test('a blocked call is not counted', () => {
  for (let i = 0; i < PER_MINUTE.max; i++) consumeBurst('c', 'mcp.request', T0);
  for (let i = 0; i < 1000; i++) assert.ok(consumeBurst('c', 'mcp.request', T0 + 30_000) > 0);
  // Had the 1000 refusals been counted, the ten-minute window (600) would still block the next minute.
  assert.equal(consumeBurst('c', 'mcp.request', T0 + 60_000), 0);
  assert.equal(consumeBurst('c', 'mcp.request', T0 + 60_000), 0);
});

test('addresses are independent: IPv4, IPv6 /64 keys and the shared unknown bucket', () => {
  for (let i = 0; i < PER_MINUTE.max; i++) consumeBurst('unknown', 'mcp.request', T0);
  assert.ok(consumeBurst('unknown', 'mcp.request', T0) > 0);
  assert.equal(consumeBurst('203.0.113.9', 'mcp.request', T0), 0);
  assert.equal(consumeBurst('2001:db8:1:2::/64', 'mcp.request', T0), 0);
  assert.equal(consumeBurst('2001:db8:1:3::/64', 'mcp.request', T0), 0);
  for (let i = 0; i < PER_MINUTE.max - 1; i++) consumeBurst('2001:db8:1:2::/64', 'mcp.request', T0);
  assert.ok(consumeBurst('2001:db8:1:2::/64', 'mcp.request', T0) > 0);
  assert.equal(consumeBurst('2001:db8:1:3::/64', 'mcp.request', T0), 0);
});

test('odd keys are plain keys: nothing is inherited from Object.prototype', () => {
  for (const key of ['__proto__', 'constructor', 'toString', '']) assert.equal(consumeBurst(key, 'mcp.request', T0), 0, JSON.stringify(key));
  assert.equal(burstTrackedKeys(), 4);
});

test('memory is bounded: the table never exceeds its cap, and the oldest-inserted addresses go first', () => {
  const now = T0;
  for (let i = 0; i < BURST_MAX_KEYS; i++) consumeBurst(`ip-${i}`, 'mcp.request', now);
  assert.equal(burstTrackedKeys(), BURST_MAX_KEYS);
  for (let i = BURST_MAX_KEYS; i < BURST_MAX_KEYS + 500; i++) consumeBurst(`ip-${i}`, 'mcp.request', now);
  assert.equal(burstTrackedKeys(), BURST_MAX_KEYS);
  // ip-0 was evicted (forgotten, so it starts again); the newest address is still counted.
  for (let i = 0; i < PER_MINUTE.max - 1; i++) consumeBurst('ip-0', 'mcp.request', now);
  assert.equal(consumeBurst('ip-0', 'mcp.request', now), 0, 'evicted address was forgotten: a full window is left');
  for (let i = 0; i < PER_MINUTE.max - 1; i++) consumeBurst(`ip-${BURST_MAX_KEYS + 499}`, 'mcp.request', now);
  assert.ok(consumeBurst(`ip-${BURST_MAX_KEYS + 499}`, 'mcp.request', now) > 0, 'a recent address keeps its count');
  assert.equal(burstTrackedKeys(), BURST_MAX_KEYS);
});

test('when the table is full, expired entries are dropped before any live address is evicted', () => {
  for (let i = 0; i < BURST_MAX_KEYS; i++) consumeBurst(`old-${i}`, 'mcp.request', T0);
  for (let i = 0; i < PER_MINUTE.max; i++) consumeBurst('old-0', 'mcp.request', T0); // would be blocked while alive
  const later = T0 + 11 * 60_000; // every window of every entry has ended
  consumeBurst('fresh', 'mcp.request', later);
  assert.equal(burstTrackedKeys(), 1, 'all expired entries were swept');
  assert.equal(consumeBurst('old-1', 'mcp.request', later), 0);
});

test('a full table of live entries is not rescanned on every request', () => {
  for (let i = 0; i < BURST_MAX_KEYS; i++) consumeBurst(`live-${i}`, 'mcp.request', T0);
  const started = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) consumeBurst(`new-${i}`, 'mcp.request', T0 + 10);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1500, `2000 inserts into a full table took ${ms} ms`);
  assert.equal(burstTrackedKeys(), BURST_MAX_KEYS);
});

test('enforceBurstLimit answers null, then the same 429 the Firestore limits use', async () => {
  assert.equal(enforceBurstLimit('203.0.113.9', 'mcp.request', T0), null);
  for (let i = 1; i < PER_MINUTE.max; i++) enforceBurstLimit('203.0.113.9', 'mcp.request', T0);
  const denied = enforceBurstLimit('203.0.113.9', 'mcp.request', T0 + 20_000);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '40');
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await denied.json(), { code: 'RATE_LIMITED', error: 'בוצעו יותר מדי פעולות. המתינו ונסו שוב.' });
});

test('the 429 is defined once: the burst limiter and the Firestore limiter produce identical responses', async () => {
  const shared = loadModule('src/lib/security/rate-limited-response.ts').rateLimitedResponse(7);
  for (let i = 0; i < PER_MINUTE.max; i++) consumeBurst('d', 'mcp.request', T0);
  const burstDenied = enforceBurstLimit('d', 'mcp.request', T0 + 53_000);
  assert.equal(await burstDenied.text(), await shared.text());
  assert.equal(burstDenied.headers.get('retry-after'), shared.headers.get('retry-after'));
  const source = (await import('node:fs')).readFileSync(new URL('../src/lib/security/rate-limit.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('RATE_LIMITED'), false, 'rate-limit.ts must reuse the shared response, not repeat the literal');
});

test('resetBurstLimits forgets every counter', () => {
  for (let i = 0; i < PER_MINUTE.max; i++) consumeBurst('e', 'mcp.request', T0);
  assert.ok(consumeBurst('e', 'mcp.request', T0) > 0);
  resetBurstLimits();
  assert.equal(burstTrackedKeys(), 0);
  assert.equal(consumeBurst('e', 'mcp.request', T0), 0);
});

test('the limiter module is pure: it imports nothing but the shared response', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../src/lib/security/burst-limit.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '(.*)';$/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['@/lib/security/rate-limited-response']);
});
