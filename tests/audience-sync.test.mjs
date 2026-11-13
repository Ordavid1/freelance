import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanNamePart, deriveName, preferName, splitDisplayName } from '../src/lib/audience/names.ts';
import { audienceConfig, upsertAudienceContact } from '../src/lib/audience/resend-contact.ts';

test('Google profile parts win; the display name is split only as a fallback', () => {
  assert.deepEqual(deriveName({ givenName: 'אור', familyName: 'דוד', displayName: 'ignored name' }), { firstName: 'אור', lastName: 'דוד', source: 'google-profile' });
  assert.deepEqual(deriveName({ displayName: 'Ada Lovelace King' }), { firstName: 'Ada', lastName: 'Lovelace King', source: 'display-name' });
  assert.deepEqual(deriveName({ displayName: 'Madonna' }), { firstName: 'Madonna', lastName: '', source: 'display-name' });
  assert.deepEqual(deriveName({}), { firstName: '', lastName: '', source: 'none' });
});

test('names are stripped of markup, template syntax, control and bidi characters and capped', () => {
  assert.equal(cleanNamePart('  ‮A<b>da</b> {{{x}}}\u0000  '), 'Abda/b x');
  assert.equal(cleanNamePart('x'.repeat(300)).length, 100);
  assert.equal(cleanNamePart(42), '');
  assert.deepEqual(splitDisplayName('  '), { firstName: '', lastName: '' });
});

test('a weaker later sign-in never replaces a name that came from the Google profile', () => {
  const profile = { firstName: 'אור', lastName: 'דוד', source: 'google-profile' };
  assert.deepEqual(preferName(profile, { firstName: 'אור', lastName: 'דוד כהן', source: 'display-name' }), profile);
  assert.deepEqual(preferName(profile, { firstName: '', lastName: '', source: 'none' }), profile);
  assert.equal(preferName(null, { firstName: 'A', lastName: '', source: 'display-name' }).firstName, 'A');
});

test('the audience feature is dormant without a segment and new contacts default to unsubscribed', () => {
  assert.equal(audienceConfig({ RESEND_API_KEY: 're_x' }), null);
  assert.equal(audienceConfig({ RESEND_AUDIENCE_SEGMENT_ID: 'seg' }), null);
  assert.equal(audienceConfig({ RESEND_API_KEY: 're_x', RESEND_AUDIENCE_SEGMENT_ID: 'seg' }).newContactsUnsubscribed, true);
  assert.equal(audienceConfig({ RESEND_API_KEY: 're_x', RESEND_AUDIENCE_SEGMENT_ID: 'seg', RESEND_AUDIENCE_NEW_CONTACTS: 'subscribed' }).newContactsUnsubscribed, false);
});

function fakeResend(existing, { memberships = [], failOn } = {}) {
  const calls = [];
  const reply = (name, data) => async payload => { calls.push([name, payload]); return failOn === name ? { data: null, error: { name: 'rate_limit_exceeded', statusCode: 429 } } : { data, error: null }; };
  return { calls, client: { contacts: {
    get: async options => { calls.push(['get', options]); return existing ? { data: existing, error: null } : { data: null, error: { name: 'not_found', statusCode: 404 } }; },
    create: reply('create', { id: 'c_new' }),
    update: reply('update', { id: existing?.id }),
    segments: { list: async options => { calls.push(['segments.list', options]); return { data: { data: memberships }, error: null }; }, add: reply('segments.add', { id: 'm' }) },
  } } };
}
const config = { segmentId: 'seg_1', newContactsUnsubscribed: true };

test('a new contact is created with names, the segment and the configured subscription', async () => {
  const { client, calls } = fakeResend(null);
  const result = await upsertAudienceContact(client, config, { email: ' Or@Example.com ', firstName: 'אור', lastName: 'דוד' });
  assert.deepEqual(result, { ok: true, action: 'created', contactId: 'c_new', subscribed: false });
  assert.deepEqual(calls.at(-1)[1], { email: 'or@example.com', firstName: 'אור', lastName: 'דוד', unsubscribed: true, segments: [{ id: 'seg_1' }] });
});

test('an existing contact is never resubscribed and keeps names that are already set', async () => {
  const { client, calls } = fakeResend({ id: 'c_1', first_name: 'Dashboard', last_name: null, unsubscribed: true });
  const result = await upsertAudienceContact(client, { ...config, newContactsUnsubscribed: false }, { email: 'a@b.co', firstName: 'Other', lastName: 'Last' });
  assert.deepEqual(result, { ok: true, action: 'updated', contactId: 'c_1', subscribed: false });
  const update = calls.find(([name]) => name === 'update')[1];
  assert.deepEqual(update, { email: 'a@b.co', lastName: 'Last' });
  assert.ok(!('unsubscribed' in update));
  assert.ok(!calls.some(([name]) => name === 'create' || name === 'segments.add'));
});

test('segment membership is only repaired when asked, and only if missing', async () => {
  const input = { email: 'a@b.co', firstName: '', lastName: '' };
  const plain = fakeResend({ id: 'c_1', first_name: 'x', last_name: 'y' });
  assert.equal((await upsertAudienceContact(plain.client, config, input)).action, 'unchanged');
  assert.ok(!plain.calls.some(([name]) => name.startsWith('segments')));
  const repair = fakeResend({ id: 'c_1', first_name: 'x', last_name: 'y' }, { memberships: [] });
  assert.equal((await upsertAudienceContact(repair.client, config, input, { ensureSegment: true })).action, 'updated');
  assert.deepEqual(repair.calls.at(-1), ['segments.add', { email: 'a@b.co', segmentId: 'seg_1' }]);
  const member = fakeResend({ id: 'c_1', first_name: 'x', last_name: 'y' }, { memberships: [{ id: 'seg_1' }] });
  assert.equal((await upsertAudienceContact(member.client, config, input, { ensureSegment: true })).action, 'unchanged');
});

test('API failures are reported with a retryable flag instead of throwing', async () => {
  const { client } = fakeResend(null, { failOn: 'create' });
  assert.deepEqual(await upsertAudienceContact(client, config, { email: 'a@b.co', firstName: '', lastName: '' }), { ok: false, code: 'rate_limit_exceeded', retryable: true });
  assert.deepEqual(await upsertAudienceContact(client, config, { email: ' ', firstName: '', lastName: '' }), { ok: false, code: 'missing_email', retryable: false });
});
