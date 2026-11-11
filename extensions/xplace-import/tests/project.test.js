'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FPX, dom, fixture } = require('./helpers/load');

const url = 'https://www.xplace.com/il/job-bids/123456';

test('flight JSON extraction uses the allowlist only', () => {
  const doc = dom(fixture('project-rsc.html'), 'https://www.xplace.com/project?id=123456').window.document;
  const p = FPX.project.extractProjectFromDocument(doc, { projectId: '123456', url, ownerSignal: null });
  assert.equal(p.kind, 'project');
  assert.equal(p.projectId, '123456');
  assert.equal(p.ownerSignal, false);
  assert.equal(p.amount, 5000);
  assert.equal(p.dueDate, null);
  assert.equal(p.publisherName, 'Osys | אוסיס פתרונות תוכנה');
  assert.deepEqual(p.categories, ['Microsoft, MCITP, MCSE', 'וורדפרס, microsoft']);
  assert.ok(!p.title.includes('<') && p.title.startsWith('Need a WordPress developer'));
  assert.ok(p.description.includes('Line one') && !p.description.includes('<b>'));
  const json = JSON.stringify(p);
  for (const canary of ['CANARYFIRST', 'CANARYLAST', '+972 50', 'canary-logo', '2027-01-07', 'userDto', 'lastLogin']) assert.ok(!json.includes(canary), canary);
  assert.deepEqual(Object.keys(p).sort(), ['amount', 'categories', 'description', 'dueDate', 'kind', 'ownerSignal', 'projectId', 'publisherName', 'title', 'url']);
});

test('id mismatch is rejected', () => {
  const doc = dom(fixture('project-rsc.html')).window.document;
  assert.equal(FPX.project.extractProjectFromDocument(doc, { projectId: '999999', url }), null);
});

test('legacy page: exactly one same-origin fetch, parsed the same way', async () => {
  const calls = [];
  const fetchImpl = async (...args) => { calls.push(args); return { ok: true, text: async () => fixture('project-rsc.html') }; };
  const p = await FPX.project.fetchLegacyProject({ projectId: '123456', url, ownerSignal: true, fetchImpl });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['/project?id=123456', { credentials: 'same-origin' }]);
  assert.equal(p.title.startsWith('Need a WordPress'), true);
  assert.equal(await FPX.project.fetchLegacyProject({ projectId: '123456', url, fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await FPX.project.fetchLegacyProject({ projectId: '111111', url, fetchImpl }), null);
});

test('amount, due date and publisher fallbacks', () => {
  const rec = { projectId: 5555, title: 'T', description: 'D', amount: '1,200', projectDueDate: '2026-12-31T00:00:00', isProjectOwner: true, companyDto: { companyNameHe: '', companyNameEn: 'ACME' }, projectCategories: [{ nameHe: '', nameEn: 'Web' }, 'bad'] };
  const p = FPX.project.capturedFromRecord(rec, url, null);
  assert.equal(p.amount, 1200); assert.equal(p.dueDate, '2026-12-31'); assert.equal(p.publisherName, 'ACME'); assert.deepEqual(p.categories, ['Web']); assert.equal(p.ownerSignal, true);
  assert.equal(FPX.project.capturedFromRecord({ ...rec, projectDueDate: '2026-02-31' }, url, null).dueDate, null);
});
