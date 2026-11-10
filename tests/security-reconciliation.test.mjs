import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBilling } from '../scripts/security/reconcile-billing.mjs';
const paid = { terminal: 1, transactionId: '123', amountAgorot: 1999, currency: 'ILS', status: 'paid' };
test('reconciliation matches by terminal and transaction and excludes raw customer fields', () => {
  const report = reconcileBilling([{ ...paid, token: 'PRIVATE_TOKEN', email: 'private@example.test' }], [paid]);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.exceptions, []);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TOKEN|private@example/);
});
test('missing processor/internal rows and refund/amount differences require review', () => {
  const report = reconcileBilling([paid, { ...paid, transactionId: '456' }], [{ ...paid, amountAgorot: 1000, status: 'refunded' }, { ...paid, terminal: 2 }]);
  assert.deepEqual(report.exceptions.map(e => e.reason), ['MISMATCH', 'MISSING_PROCESSOR', 'MISSING_INTERNAL']);
  assert.deepEqual(report.exceptions[0].fields, ['amountAgorot', 'status']);
});
test('duplicate and malformed rows fail rather than silently selecting a transaction', () => {
  assert.throws(() => reconcileBilling([paid, paid], []), /duplicate/);
  assert.throws(() => reconcileBilling([{ ...paid, amountAgorot: 19.99 }], []), /invalid/);
  assert.throws(() => reconcileBilling([], [{ ...paid, status: 'unknown' }]), /invalid/);
});
