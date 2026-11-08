import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessFromRecord, profileIsComplete, TRIAL_MS } from '../src/lib/membership/state.ts';
test('trial lasts exactly 14 days and expires at its boundary', () => {
  assert.equal(TRIAL_MS, 1209600000);
  const record = { state: 'trial', trialStartedAt: 1000, trialEndsAt: 1000 + TRIAL_MS };
  assert.equal(accessFromRecord(record, record.trialEndsAt - 1).canUseMarketplace, true);
  assert.equal(accessFromRecord(record, record.trialEndsAt).state, 'expired');
  assert.equal(accessFromRecord(record, record.trialEndsAt).canStartTrial, false);
});
test('preview is read-only and legacy retains access', () => {
  assert.equal(accessFromRecord({ state: 'preview' }).canUseMarketplace, false);
  assert.equal(accessFromRecord({ state: 'legacy' }).canUseMarketplace, true);
});
test('malformed trials fail closed without starting another trial', () => {
  const access = accessFromRecord({ state: 'trial', trialEndsAt: Infinity });
  assert.equal(access.state, 'expired');
  assert.equal(access.canUseMarketplace, false);
  assert.equal(access.canStartTrial, false);
});
test('publisher setup only needs a name, freelancer setup needs meaningful matching data', () => {
  assert.equal(profileIsComplete({ profileType: 'publisher', name: 'Studio' }), true);
  assert.equal(profileIsComplete({ profileType: 'publisher', name: '  ' }), false);
  assert.equal(profileIsComplete({ name: 'Or', headline: 'Developer', skills: [] }), false);
  assert.equal(profileIsComplete({ name: 'Or', headline: ' ', skills: ['React'] }), false);
  assert.equal(profileIsComplete({ name: 'Or', bio: 'Developer', skills: ['React'] }), true);
});
