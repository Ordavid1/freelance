import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const { matchPublisher } = loadModule('src/lib/imports/xplace/publisher-match.ts');

test('an empty publisher profile is reported before anything else', () => {
  assert.equal(matchPublisher('Osys | אוסיס פתרונות תוכנה', ''), 'no-profile');
  assert.equal(matchPublisher('', '   '), 'no-profile');
  assert.equal(matchPublisher('', ''), 'no-profile');
});

test('a page without a publisher name cannot contradict the profile', () => {
  assert.equal(matchPublisher('', 'Osys'), 'unknown');
  assert.equal(matchPublisher('  |  ', 'Osys'), 'unknown');
});

test('the same business matches across separators, case, legal suffixes and quotes', () => {
  assert.equal(matchPublisher('Osys | אוסיס פתרונות תוכנה', 'Osys'), 'match');
  assert.equal(matchPublisher('Osys | אוסיס פתרונות תוכנה', 'אוסיס פתרונות תוכנה'), 'match');
  assert.equal(matchPublisher('Osys | אוסיס פתרונות תוכנה', 'אוסיס'), 'match');
  assert.equal(matchPublisher('Noya Botanics Ltd.', 'noya botanics'), 'match');
  assert.equal(matchPublisher('סטודיו קו בע"מ', 'סטודיו קו'), 'match');
  assert.equal(matchPublisher('Studio Kav - Architecture', 'Studio Kav'), 'match');
  assert.equal(matchPublisher('אוסיס', 'אוֹסיס'), 'match');
});

test('different businesses do not match, and tiny fragments do not count as containment', () => {
  assert.equal(matchPublisher('Osys | אוסיס פתרונות תוכנה', 'Noya Botanics'), 'mismatch');
  assert.equal(matchPublisher('סטודיו קו', 'סטודיו לוז'), 'mismatch');
  assert.equal(matchPublisher('Luma Health', 'Luma Studio'), 'mismatch');
  assert.equal(matchPublisher('Big Corp International', 'AB'), 'mismatch');
  assert.equal(matchPublisher('Ltd.', 'Osys'), 'unknown');
});
