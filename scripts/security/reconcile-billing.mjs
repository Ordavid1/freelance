// Offline comparison only. Feed normalized, authorized exports; never payment tokens.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function reconcileBilling(internal, processor) {
  const index = (rows, source) => {
    if (!Array.isArray(rows)) throw new Error(`${source}: expected an array`);
    const map = new Map();
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.terminal) || row.terminal <= 0 || typeof row.transactionId !== 'string' || !/^\d{1,30}$/.test(row.transactionId) || !Number.isSafeInteger(row.amountAgorot) || row.amountAgorot < 0 || !/^[A-Z]{3}$/.test(row.currency || '') || !['paid', 'refunded', 'declined'].includes(row.status)) throw new Error(`${source}: invalid normalized row`);
      const key = `${row.terminal}:${row.transactionId}`;
      if (map.has(key)) throw new Error(`${source}: duplicate transaction reference ${key}`);
      map.set(key, row);
    }
    return map;
  };
  const local = index(internal, 'internal');
  const remote = index(processor, 'processor');
  const exceptions = [];
  let matched = 0;
  for (const key of new Set([...local.keys(), ...remote.keys()])) {
    const a = local.get(key), b = remote.get(key);
    if (!a || !b) exceptions.push({ reference: key, reason: !a ? 'MISSING_INTERNAL' : 'MISSING_PROCESSOR' });
    else {
      const fields = ['amountAgorot', 'currency', 'status'].filter(field => a[field] !== b[field]);
      if (fields.length) exceptions.push({ reference: key, reason: 'MISMATCH', fields });
      else matched++;
    }
  }
  // Deliberately omit raw rows, identities, amounts and customer content.
  return { internalCount: local.size, processorCount: remote.size, matched, exceptions };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3) throw new Error('Usage: node scripts/security/reconcile-billing.mjs internal.json processor.json report.json');
    const report = reconcileBilling(JSON.parse(readFileSync(args[0], 'utf8')), JSON.parse(readFileSync(args[1], 'utf8')));
    writeFileSync(args[2], JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ matched: report.matched, exceptions: report.exceptions.length }));
    process.exitCode = report.exceptions.length ? 2 : 0;
  } catch { console.error('Reconciliation failed: check normalized inputs and use a new output path. No records were changed.'); process.exitCode = 1; }
}
