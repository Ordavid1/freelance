import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';
import { loadPolicy } from './helpers/policy.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

const ORIGIN = 'https://freelance-place.com';
const { isValidProfileImage, MAX_PROFILE_IMAGE_BYTES } = loadModule('src/lib/profile/image-validation.ts');
const { parseHttpsUrl } = loadModule('src/lib/security/url.ts');

const dataUrl = (type, bytes) => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
const pad = (head, total = 64) => Uint8Array.from({ length: total }, (_, i) => head[i] ?? 0);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const AVIF = pad([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);

test('png, jpeg, webp and avif images with matching bytes are accepted', () => {
  assert.equal(isValidProfileImage(dataUrl('png', PNG)), true);
  assert.equal(isValidProfileImage(dataUrl('jpeg', JPEG)), true);
  assert.equal(isValidProfileImage(dataUrl('webp', WEBP)), true);
  assert.equal(isValidProfileImage(dataUrl('avif', AVIF)), true);
});

test('svg, other types and non-images are rejected whatever they claim', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(isValidProfileImage(`data:image/svg+xml;base64,${svg.toString('base64')}`), false);
  assert.equal(isValidProfileImage(`data:image/svg+xml;utf8,<svg onload=alert(1)>`), false);
  assert.equal(isValidProfileImage(dataUrl('png', svg)), false, 'svg bytes under a png label');
  assert.equal(isValidProfileImage(dataUrl('gif', PNG)), false);
  assert.equal(isValidProfileImage('data:text/html;base64,PGh0bWw+'), false);
  assert.equal(isValidProfileImage('https://example.com/a.png'), false);
  assert.equal(isValidProfileImage('javascript:alert(1)'), false);
  assert.equal(isValidProfileImage(''), false);
});

test('the declared type must match the real bytes (magic bytes)', () => {
  assert.equal(isValidProfileImage(dataUrl('jpeg', PNG)), false);
  assert.equal(isValidProfileImage(dataUrl('png', JPEG)), false);
  assert.equal(isValidProfileImage(dataUrl('webp', PNG)), false);
  assert.equal(isValidProfileImage(dataUrl('avif', WEBP)), false);
  assert.equal(isValidProfileImage(dataUrl('png', pad([0x89, 0x50, 0x4e, 0x47]))), false, 'truncated signature');
});

test('malformed base64 and parameters are rejected', () => {
  const good = dataUrl('png', PNG);
  assert.equal(isValidProfileImage(good + '!'), false);
  assert.equal(isValidProfileImage(good.replace('base64,', 'base64,@@')), false);
  assert.equal(isValidProfileImage(good.replace(';base64', ';charset=utf-8;base64')), false);
  assert.equal(isValidProfileImage(`${good}\n<script>`), false);
  assert.equal(isValidProfileImage('data:image/png;base64,iVBOR'), false, 'not a whole number of base64 groups');
});

test('size: 1.5 MB decoded is the ceiling', () => {
  assert.equal(MAX_PROFILE_IMAGE_BYTES, 1_500_000);
  const at = new Uint8Array(MAX_PROFILE_IMAGE_BYTES); at.set(PNG);
  const over = new Uint8Array(MAX_PROFILE_IMAGE_BYTES + 3); over.set(PNG);
  assert.equal(isValidProfileImage(dataUrl('png', at)), true);
  assert.equal(isValidProfileImage(dataUrl('png', over)), false);
});

test('websites must be https links; the shared helper rejects every other scheme', () => {
  assert.ok(parseHttpsUrl('https://example.com/portfolio', 200));
  assert.ok(parseHttpsUrl('http://example.com', 200, { allowHttp: true }), 'allowHttp admits plain http');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'http://localhost']) assert.equal(parseHttpsUrl(bad, 200, { allowHttp: true }), null, bad);
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'https://user:pw@example.com', 'https://localhost', '//example.com', 'example.com', `https://example.com/${'a'.repeat(200)}`]) {
    assert.equal(parseHttpsUrl(bad, 200), null, bad);
  }
});

function profileRoute(seed = {}) {
  const db = createFakeFirestore(seed);
  const policy = loadPolicy({
    '@/lib/auth/session': { getCurrentUser: async () => ({ uid: 'uid-1', email: 'a@example.com', name: 'A', picture: null }), isSameOrigin: () => true, publicAppOrigin: () => ORIGIN },
  }, { NEXT_PUBLIC_SITE_URL: ORIGIN });
  const route = loadModule('src/app/api/marketplace/profile/route.ts', { stubs: {
    'firebase-admin/firestore': { FieldValue: { delete: () => null, serverTimestamp: () => 'now' }, Timestamp: { now: () => ({ toMillis: () => 0 }), fromMillis: v => v } },
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/db/firestore': { firestore: () => db },
    '@/lib/membership/access': { getMembershipAccess: async () => ({}) },
    '@/lib/security/policy': policy,
  } });
  const put = profile => route.PUT(new Request(`${ORIGIN}/api/marketplace/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile }) }));
  return { put, db };
}

test('PUT /api/marketplace/profile stores valid images and an https website', async () => {
  const { put, db } = profileRoute();
  const logo = dataUrl('webp', WEBP);
  const response = await put({ name: 'Dana', website: ' https://dana.example.com ', logo, avatar: '' });
  assert.equal(response.status, 200);
  const saved = db.docs('profiles')['uid-1'];
  assert.equal(saved.website, 'https://dana.example.com');
  assert.equal(saved.logo, logo);
  assert.equal(saved.avatar, '', 'an empty string clears the image');
});

test('PUT /api/marketplace/profile rejects unsafe websites and images with 400 and writes nothing', async () => {
  const { put, db } = profileRoute();
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
  for (const profile of [
    { website: 'javascript:alert(1)' }, { website: 'https://' + 'a'.repeat(250) + '.com' },
    { logo: svg }, { avatar: svg }, { avatar: dataUrl('png', JPEG) }, { logo: 'https://example.com/a.png' }, { avatar: 'not an image' },
  ]) {
    const response = await put(profile);
    assert.equal(response.status, 400, JSON.stringify(profile).slice(0, 60));
  }
  assert.equal(db.docs('profiles')['uid-1'], undefined);
});

test('the profile body cap is small: an oversized request is refused before parsing', async () => {
  const { put, db } = profileRoute();
  const response = await put({ name: 'x', bio: 'y'.repeat(1_100_000) });
  assert.equal(response.status, 413);
  assert.equal(db.docs('profiles')['uid-1'], undefined);
});

test('PUT /api/marketplace/profile keeps an existing http website and a legacy image that is resent unchanged', async () => {
  const legacy = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  const { put, db } = profileRoute({ profiles: { 'uid-1': { name: 'Dana', avatar: legacy } } });
  const response = await put({ name: 'Dana', website: 'http://dana.example.com', avatar: legacy });
  assert.equal(response.status, 200);
  assert.equal(db.docs('profiles')['uid-1'].website, 'http://dana.example.com/'.replace(/\/$/, ''));
  assert.equal(db.docs('profiles')['uid-1'].avatar, legacy);
  const changed = await put({ avatar: 'data:image/gif;base64,R0lGODlhAgACAAAAACw=' });
  assert.equal(changed.status, 400, 'a new image still has to pass the check');
});
