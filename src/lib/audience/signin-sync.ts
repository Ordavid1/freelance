import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { firestore } from '@/lib/db/firestore';
import { audienceConfig, upsertAudienceContact } from './resend-contact.ts';
import { deriveName, preferName, type PersonName } from './names.ts';

// One Firestore document per signed-in Google user, written only by the server. It is the
// durable home of the separate first and last name (Firebase Auth keeps just a display name)
// and of the Resend sync state, so a later bulk job can retry whatever failed.
export const AUDIENCE_COLLECTION = 'audienceContacts';

export type SignInIdentity = { uid: string; email: string; displayName?: string | null; givenName?: unknown; familyName?: unknown };

// Called after the sign-in response has been sent. It never throws: a Resend outage must not
// affect signing in, and the failure is recorded on the document for the backfill to retry.
export async function recordSignInContact(identity: SignInIdentity): Promise<void> {
  const config = audienceConfig();
  if (!config) return;
  try {
    const email = identity.email.trim().toLowerCase();
    const ref = firestore().collection(AUDIENCE_COLLECTION).doc(identity.uid);
    const existing = (await ref.get()).data();
    const stored: PersonName | null = existing ? { firstName: String(existing.firstName || ''), lastName: String(existing.lastName || ''), source: existing.nameSource || 'none' } : null;
    const name = preferName(stored, deriveName({ givenName: identity.givenName, familyName: identity.familyName, displayName: identity.displayName }));
    await ref.set({ email, firstName: name.firstName, lastName: name.lastName, nameSource: name.source, lastSignInAt: FieldValue.serverTimestamp(), ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });

    const outcome = await upsertAudienceContact(new Resend(config.apiKey), config, { email, firstName: name.firstName, lastName: name.lastName });
    await ref.set(outcome.ok
      ? { resendContactId: outcome.contactId, resendSyncState: 'synced', resendSyncError: FieldValue.delete(), resendSyncedAt: FieldValue.serverTimestamp() }
      : { resendSyncState: 'error', resendSyncError: outcome.code, resendSyncRetryable: outcome.retryable }, { merge: true });
  } catch (error) {
    console.error('Audience sync failed', error instanceof Error ? error.message : 'unknown');
  }
}
