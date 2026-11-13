// One-off / repeatable backfill: copies existing Google sign-in users from Firebase Auth into the
// Resend audience (segment). Safe to re-run: it is the same idempotent upsert the sign-in path uses.
//
//   node --experimental-transform-types scripts/audience/backfill-resend-audience.ts \
//     --project <gcp-project-id> [--apply] [--limit N]
//
// Dry run by default (reads Firebase Auth, prints the plan, calls Resend for nothing). Writes only
// with --apply. Needs Application Default Credentials plus RESEND_API_KEY and
// RESEND_AUDIENCE_SEGMENT_ID in the environment. New contacts follow RESEND_AUDIENCE_NEW_CONTACTS
// (default: unsubscribed). Existing Resend contacts keep their subscription state.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { audienceConfig, upsertAudienceContact } from '../../src/lib/audience/resend-contact.ts';
import { deriveName, preferName, type PersonName } from '../../src/lib/audience/names.ts';

// Resend's default limit is 2 requests per second and an upsert can take up to 4 calls.
const PAUSE_MS = 2200;

function args(argv: string[]) {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const limit = Number(value('--limit') || Infinity);
  return { project: value('--project') || process.env.GOOGLE_CLOUD_PROJECT, apply: argv.includes('--apply'), limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity };
}

async function main() {
  const { project, apply, limit } = args(process.argv.slice(2));
  if (!project) { console.error('Pass --project <gcp-project-id> (or set GOOGLE_CLOUD_PROJECT).'); process.exit(2); }
  const config = audienceConfig();
  if (apply && !config) { console.error('--apply needs RESEND_API_KEY and RESEND_AUDIENCE_SEGMENT_ID.'); process.exit(2); }
  const app = initializeApp({ credential: applicationDefault(), projectId: project });
  const auth = getAuth(app), db = getFirestore(app);
  const resend = config ? new Resend(config.apiKey) : null;
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}; project: ${project}; new contacts ${config?.newContactsUnsubscribed === false ? 'SUBSCRIBED' : 'unsubscribed'}`);

  const counts = { seen: 0, skipped: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    pageToken = page.pageToken;
    for (const user of page.users) {
      if (counts.seen >= limit) { pageToken = undefined; break; }
      const google = user.providerData.find(provider => provider.providerId === 'google.com');
      if (!google || !user.email || !user.emailVerified || user.disabled) { counts.skipped++; continue; }
      counts.seen++;
      const ref = db.collection('audienceContacts').doc(user.uid);
      const saved = (await ref.get()).data();
      const stored: PersonName | null = saved ? { firstName: String(saved.firstName || ''), lastName: String(saved.lastName || ''), source: saved.nameSource || 'none' } : null;
      const name = preferName(stored, deriveName({ displayName: user.displayName || google.displayName }));
      if (!apply || !config || !resend) { console.log(`  would sync ${user.uid}  name=${name.firstName ? `${name.firstName} | ${name.lastName}` : '(none)'} [${name.source}]`); continue; }
      const email = user.email.toLowerCase();
      await ref.set({ email, firstName: name.firstName, lastName: name.lastName, nameSource: name.source, ...(saved ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
      const outcome = await upsertAudienceContact(resend, config, { email, firstName: name.firstName, lastName: name.lastName }, { ensureSegment: true });
      if (outcome.ok) {
        counts[outcome.action]++;
        await ref.set({ resendContactId: outcome.contactId, resendSyncState: 'synced', resendSyncError: FieldValue.delete(), resendSyncedAt: FieldValue.serverTimestamp() }, { merge: true });
      } else {
        counts.failed++;
        console.error(`  failed ${user.uid}: ${outcome.code}`);
        await ref.set({ resendSyncState: 'error', resendSyncError: outcome.code, resendSyncRetryable: outcome.retryable }, { merge: true });
      }
      await new Promise(resolve => setTimeout(resolve, PAUSE_MS));
    }
  } while (pageToken);
  console.log(`Done. ${JSON.stringify(counts)}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
