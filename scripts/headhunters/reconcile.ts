// Recount headhunters' published projects and report drift from the stored counters.
//
//   node --experimental-transform-types scripts/headhunters/reconcile.ts --project <gcp-project-id> [--uid <uid>] [--commit]
//
// Dry run by default. --commit writes the recount (through the same rules as the live counter: it can unlock a
// record or send an approved one below the review floor back to review) and needs an explicit --project.
import { HEADHUNTERS_COLLECTION } from '../../src/lib/headhunters/constants.ts';
import { reconcileHeadhunter } from '../../src/lib/headhunters/store.ts';
import { fail, openFirestore, parseCli } from './cli.ts';

async function main() {
  const parsed = parseCli(process.argv.slice(2), ['project', 'uid'], ['commit']);
  if (!parsed.ok) fail(parsed.error);
  const { options } = parsed;
  if (!options.project) fail('--project <gcp-project-id> is required (or set GOOGLE_CLOUD_PROJECT).');
  const db = openFirestore(options.project);
  const only = options.values.get('uid');
  const uids = only ? [only] : (await db.collection(HEADHUNTERS_COLLECTION).get()).docs.map((doc) => doc.id);
  console.log(`Mode: ${options.commit ? 'COMMIT' : 'DRY RUN'}; project: ${options.project}; headhunters: ${uids.length}`);

  let drifting = 0;
  let written = 0;
  for (const uid of uids) {
    const result = await reconcileHeadhunter(db, uid, { write: options.commit });
    if (!result) { console.log(`  ${uid}  no headhunter record`); continue; }
    if (result.drift !== 0) drifting += 1;
    if (result.written) written += 1;
    const notes = [
      result.drift !== 0 ? 'DRIFT' : 'ok',
      result.duplicates ? `${result.duplicates} duplicate(s) counted once` : '',
      result.truncated ? 'TRUNCATED scan, not written' : '',
      result.written ? `written${result.outcome?.statusChanged ? `, status -> ${result.outcome.status}` : ''}${result.outcome?.becameEligible ? ', unlocked' : ''}` : '',
    ].filter(Boolean).join('; ');
    console.log(`  ${uid}  /${result.handle}  stored ${result.stored}  actual ${result.actual}  drift ${result.drift >= 0 ? '+' : ''}${result.drift}  ${notes}`);
  }
  console.log(`\n${drifting} of ${uids.length} drifting.${options.commit ? ` Wrote ${written} record(s).` : ' Dry run: nothing was written. Re-run with --commit to apply.'}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
