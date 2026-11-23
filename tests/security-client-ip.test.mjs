import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const load = (env = {}) => loadModule('src/lib/security/client-ip.ts', { env });
const request = (forwarded) => new Request('https://example.test/api/support', { headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } });

// The Google external Application Load Balancer appends "<client>, <load balancer>" to what the caller sent.
test('the client is the entry before the load balancer address', () => {
  const { clientIp } = load();
  assert.equal(clientIp(request('203.0.113.7, 130.211.0.5')), '203.0.113.7');
});

test('entries a caller put in front of the load balancer entries never count (spoofed prefixes)', () => {
  const { clientIp } = load();
  assert.equal(clientIp(request('1.1.1.1, 203.0.113.7, 130.211.0.5')), '203.0.113.7');
  assert.equal(clientIp(request('9.9.9.9, 8.8.8.8, 7.7.7.7, 6.6.6.6, 203.0.113.7, 130.211.0.5')), '203.0.113.7');
  assert.equal(clientIp(request('2001:db8::1, 203.0.113.7, 130.211.0.5')), '203.0.113.7');
  // Garbage and injection attempts in the spoofed part are ignored as well.
  assert.equal(clientIp(request('<script>, ::, ,,, not-an-ip, 203.0.113.7, 130.211.0.5')), '203.0.113.7');
  // A caller cannot make two requests look different by changing only the prefix.
  assert.equal(clientIp(request('a, 203.0.113.7, 130.211.0.5')), clientIp(request('b, 203.0.113.7, 130.211.0.5')));
});

test('a spoofed entry in the client position is not an address and falls into one shared bucket', () => {
  const { clientIp, UNKNOWN_CLIENT } = load();
  assert.equal(clientIp(request('evil, 130.211.0.5')), UNKNOWN_CLIENT);
  assert.equal(clientIp(request('999.1.1.1, 130.211.0.5')), UNKNOWN_CLIENT);
  assert.equal(clientIp(request('')), UNKNOWN_CLIENT);
  assert.equal(clientIp(request(undefined)), UNKNOWN_CLIENT);
});

test('without a proxy (one entry, local development) that entry is used', () => {
  const { clientIp } = load();
  assert.equal(clientIp(request('198.51.100.9')), '198.51.100.9');
});

test('CLIENT_IP_TRUSTED_HOPS moves the trust boundary and invalid values fall back to the default', () => {
  const header = '203.0.113.7, 130.211.0.5, 10.0.0.1';
  assert.equal(load({ CLIENT_IP_TRUSTED_HOPS: '2' }).clientIp(request(header)), '203.0.113.7');
  assert.equal(load({ CLIENT_IP_TRUSTED_HOPS: '0' }).clientIp(request('203.0.113.7')), '203.0.113.7');
  for (const bad of ['-1', 'x', '1.5', '99', '']) assert.equal(load({ CLIENT_IP_TRUSTED_HOPS: bad }).clientIp(request('203.0.113.7, 130.211.0.5')), '203.0.113.7', bad);
});

test('IPv6 addresses are grouped by /64 so one subscriber cannot mint unlimited addresses', () => {
  const { clientIp } = load();
  const a = clientIp(request('2001:db8:abcd:12:1:2:3:4, 130.211.0.5'));
  const b = clientIp(request('2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff, 130.211.0.5'));
  const c = clientIp(request('2001:db8:abcd:13::1, 130.211.0.5'));
  assert.equal(a, '2001:db8:abcd:12::/64');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(clientIp(request('[2001:db8::1], 130.211.0.5')), '2001:db8:0:0::/64');
  assert.equal(clientIp(request('fe80::1%eth0, 130.211.0.5')), 'fe80:0:0:0::/64');
});

test('IPv4-mapped IPv6 is the same client as its IPv4 address; malformed IPv6 is rejected', () => {
  const { clientIp, normalizeIp, UNKNOWN_CLIENT } = load();
  assert.equal(clientIp(request('::ffff:203.0.113.7, 130.211.0.5')), '203.0.113.7');
  assert.equal(normalizeIp('::ffff:cb00:7107'), '203.0.113.7');
  for (const bad of ['1:2:3:4:5:6:7:8:9', '1::2::3', 'gggg::1', '12345::1', ':::', '1:2:3']) {
    assert.equal(normalizeIp(bad), null, bad);
    assert.equal(clientIp(request(`${bad}, 130.211.0.5`)), UNKNOWN_CLIENT, bad);
  }
});

test('IPv4 parsing is strict: no leading zeros, ranges or short forms', () => {
  const { normalizeIp } = load();
  assert.equal(normalizeIp('192.168.1.1'), '192.168.1.1');
  for (const bad of ['01.2.3.4', '256.1.1.1', '1.2.3', '1.2.3.4.5', '1.2.3.-4', '0x7f.0.0.1']) assert.equal(normalizeIp(bad), null, bad);
});
