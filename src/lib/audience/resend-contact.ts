// Idempotent upsert of one Firebase user into the Resend audience (a Resend "segment").
// Takes the Resend client as a parameter, so the sign-in path, the backfill script and the tests
// share one implementation. The Resend Node SDK returns `{ data, error }` and does not throw.
//
// Rules this module enforces:
//  - `unsubscribed` is written only when a contact is created. A person who unsubscribed (via the
//    link in a broadcast, or in the dashboard) is never subscribed again by a later sign-in.
//  - Names only fill empty fields. Names edited in the Resend dashboard are never overwritten.
//  - Segment membership is added when the contact is created, or when `ensureSegment` is set
//    (backfill). A normal sign-in does not re-add a contact someone removed from the segment.

export type AudienceConfig = { apiKey: string; segmentId: string; newContactsUnsubscribed: boolean };

// Dormant unless both values are set. New contacts default to unsubscribed, so signing in is not
// treated as consent to marketing email: RESEND_AUDIENCE_NEW_CONTACTS=subscribed is an explicit,
// reviewed switch.
export function audienceConfig(env: Record<string, string | undefined> = process.env): AudienceConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const segmentId = env.RESEND_AUDIENCE_SEGMENT_ID?.trim();
  if (!apiKey || !segmentId) return null;
  return { apiKey, segmentId, newContactsUnsubscribed: env.RESEND_AUDIENCE_NEW_CONTACTS?.trim().toLowerCase() !== 'subscribed' };
}

type ApiError = { name?: string; message?: string; statusCode?: number | null } | null;
type Result<T> = Promise<{ data: T | null; error: ApiError }>;
export type ResendContactsClient = {
  contacts: {
    get(options: { email: string }): Result<{ id: string; first_name?: string | null; last_name?: string | null; unsubscribed?: boolean }>;
    create(payload: { email: string; firstName?: string; lastName?: string; unsubscribed?: boolean; segments?: { id: string }[] }): Result<{ id: string }>;
    update(payload: { email: string; firstName?: string; lastName?: string }): Result<{ id: string }>;
    segments: {
      list(options: { email: string }): Result<{ data: { id: string }[] }>;
      add(options: { email: string; segmentId: string }): Result<{ id: string }>;
    };
  };
};

export type ContactInput = { email: string; firstName: string; lastName: string };
export type SyncOutcome =
  | { ok: true; action: 'created' | 'updated' | 'unchanged'; contactId: string; subscribed: boolean }
  | { ok: false; code: string; retryable: boolean };

const fail = (error: ApiError, fallback: string): SyncOutcome => {
  const code = error?.name || fallback;
  return { ok: false, code, retryable: code === 'rate_limit_exceeded' || code === 'application_error' || code === 'internal_server_error' || (error?.statusCode ?? 0) >= 500 || !error?.name };
};

export async function upsertAudienceContact(resend: ResendContactsClient, config: Pick<AudienceConfig, 'segmentId' | 'newContactsUnsubscribed'>, input: ContactInput, options: { ensureSegment?: boolean } = {}): Promise<SyncOutcome> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, code: 'missing_email', retryable: false };
  const names = { ...(input.firstName ? { firstName: input.firstName } : {}), ...(input.lastName ? { lastName: input.lastName } : {}) };

  const found = await resend.contacts.get({ email });
  if (found.error && found.error.name !== 'not_found') return fail(found.error, 'lookup_failed');

  if (!found.data) {
    const created = await resend.contacts.create({ email, ...names, unsubscribed: config.newContactsUnsubscribed, segments: [{ id: config.segmentId }] });
    if (created.error || !created.data) return fail(created.error, 'create_failed');
    return { ok: true, action: 'created', contactId: created.data.id, subscribed: !config.newContactsUnsubscribed };
  }

  const contact = found.data;
  const fill = {
    ...(!contact.first_name && names.firstName ? { firstName: names.firstName } : {}),
    ...(!contact.last_name && names.lastName ? { lastName: names.lastName } : {}),
  };
  let changed = false;
  if (Object.keys(fill).length) {
    const updated = await resend.contacts.update({ email, ...fill });
    if (updated.error) return fail(updated.error, 'update_failed');
    changed = true;
  }
  if (options.ensureSegment) {
    const memberships = await resend.contacts.segments.list({ email });
    if (memberships.error) return fail(memberships.error, 'segment_lookup_failed');
    if (!memberships.data?.data?.some(segment => segment.id === config.segmentId)) {
      const added = await resend.contacts.segments.add({ email, segmentId: config.segmentId });
      if (added.error) return fail(added.error, 'segment_add_failed');
      changed = true;
    }
  }
  return { ok: true, action: changed ? 'updated' : 'unchanged', contactId: contact.id, subscribed: contact.unsubscribed !== true };
}
