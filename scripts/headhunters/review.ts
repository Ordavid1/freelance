// Review headhunter applications: list the queue and approve, reject, suspend, reinstate or request changes.
//
//   node --experimental-transform-types scripts/headhunters/review.ts --project <gcp-project-id> [--status pending]
//   node --experimental-transform-types scripts/headhunters/review.ts --project <id> --uid <uid> --action approve [--commit --actor <name>]
//   node --experimental-transform-types scripts/headhunters/review.ts --project <id> --uid <uid> --action reject --reason "..." --commit --actor <name>
//
// Dry run by default: a decision is checked and described, and only --commit writes. A commit needs --actor (who
// decided); it is recorded as `script:<name>` in the same `securityAuditEvents` entry the moderation API writes,
// because both run the same store code (src/lib/headhunters/store.ts). The public caches expire within 60 seconds.
import { isEligible } from '../../src/lib/headhunters/counting.ts';
import { HEADHUNTERS_COLLECTION, HEADHUNTER_STATUSES } from '../../src/lib/headhunters/constants.ts';
import { MODERATION_ACTIONS, nextStatus, parseDecision } from '../../src/lib/headhunters/moderation.ts';
import { decideHeadhunter, listHeadhuntersForReview, reconcileHeadhunter } from '../../src/lib/headhunters/store.ts';
import type { HeadhunterStatus } from '../../src/lib/headhunters/types.ts';
import { fail, openFirestore, parseCli } from './cli.ts';

async function main() {
  const parsed = parseCli(process.argv.slice(2), ['project', 'status', 'uid', 'action', 'reason', 'actor'], ['commit']);
  if (!parsed.ok) fail(parsed.error);
  const { options } = parsed;
  if (!options.project) fail('--project <gcp-project-id> is required (or set GOOGLE_CLOUD_PROJECT).');
  const db = openFirestore(options.project);
  const uid = options.values.get('uid');
  const action = options.values.get('action');

  if (!uid && !action) {
    const status = options.values.get('status') ?? 'pending';
    if (!(HEADHUNTER_STATUSES as readonly string[]).includes(status)) fail(`--status must be one of: ${HEADHUNTER_STATUSES.join(', ')}`);
    const items = await listHeadhuntersForReview(db, { status: status as HeadhunterStatus });
    console.log(`${items.length} headhunter(s) with status "${status}":`);
    for (const item of items) {
      console.log(`  ${item.uid}  ${item.displayName}  /${item.handle}  ${item.kind}  published ${item.published}${item.flags.length ? `  flags: ${item.flags.join(', ')}` : ''}${item.reason ? `  reason: ${item.reason}` : ''}`);
      console.log(`      contact: ${JSON.stringify(item.contact)}`);
    }
    return;
  }

  const decision = parseDecision({ uid, action, reason: options.values.get('reason') });
  if (!decision.ok) {
    fail(decision.code === 'REASON_REQUIRED' ? `--reason is required (3 to 500 characters) for ${action}.` : `--uid and --action (${MODERATION_ACTIONS.join(', ')}) are required, with a valid uid and a reason of at most 500 characters.`);
  }
  const record = await db.collection(HEADHUNTERS_COLLECTION).doc(decision.value.uid).get();
  if (!record.exists) fail(`No headhunter record for ${decision.value.uid}.`, 1);
  const from = record.get('status');
  const to = nextStatus(decision.value.action, from, record.get('approvedAt') != null);
  console.log(`Mode: ${options.commit ? 'COMMIT' : 'DRY RUN'}; ${record.get('displayName')} (/${record.get('handle')}): ${decision.value.action}: ${from} -> ${to ?? 'NOT ALLOWED from this status'}`);
  if (decision.value.action === 'approve') {
    const drift = await reconcileHeadhunter(db, decision.value.uid);
    if (drift) console.log(`  recount: stored ${drift.stored}, actual ${drift.actual} (${drift.duplicates} duplicate(s)); eligible: ${record.get('eligibleAt') != null || isEligible(drift.actual) ? 'yes' : 'NO'}`);
  }
  if (!options.commit) { console.log('Dry run: nothing was written. Re-run with --commit --actor <name> to apply.'); return; }

  const actor = options.values.get('actor');
  if (!actor || !/^[A-Za-z0-9_.@-]{1,64}$/.test(actor)) fail('--actor <name> is required with --commit (letters, digits, . _ - @).');
  const result = await decideHeadhunter(db, { ...decision.value, actor: `script:${actor}`, via: 'script' });
  if (!result.ok) fail(`Not applied: ${result.code}.`, 1);
  console.log(`Done: ${result.from} -> ${result.to}. Audit entry written.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
