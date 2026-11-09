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
test('verified paid access expires at the boundary without resetting the trial', () => {
  const record = { state: 'trial', trialStartedAt: 100, trialEndsAt: 200, paidUntil: 1000 };
  assert.equal(accessFromRecord(record, 999).state, 'paid');
  assert.equal(accessFromRecord(record, 999).canUseMarketplace, true);
  assert.equal(accessFromRecord(record, 1000).state, 'expired');
  assert.equal(accessFromRecord(record, 1000).canStartTrial, false);
  assert.equal(accessFromRecord({ ...record, paidUntil: Infinity }, 999).canUseMarketplace, false);
});
test('publisher profiles never start a freelancer trial; completing a freelancer profile does', async () => {
  const { shouldStartFreelancerTrial } = await import('../src/lib/membership/state.ts');
  const publisher = { profileType: 'publisher', name: 'Studio' };
  const freelancer = { profileType: 'freelancer', name: 'Or', headline: 'Developer', skills: ['React'] };
  assert.equal(shouldStartFreelancerTrial(publisher, { state: 'preview' }), false);
  assert.equal(shouldStartFreelancerTrial(freelancer, { state: 'preview' }, publisher), true);
  assert.equal(shouldStartFreelancerTrial(freelancer, { state: 'trial', freelancerTrialStarted: true }, publisher), false);
  assert.equal(shouldStartFreelancerTrial(freelancer, { state: 'expired', freelancerTrialStarted: true }, publisher), false);
  assert.equal(shouldStartFreelancerTrial(freelancer, { state: 'trial' }, publisher), true);
});
