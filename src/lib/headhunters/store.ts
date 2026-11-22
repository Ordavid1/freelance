// Headhunter data layer over a Firestore instance that the caller passes in. It imports no Next.js code
// and no `@/` alias, so the routes (through src/lib/db/headhunters.ts) and the admin scripts run
// exactly the same transactions and the same rules.
//
// Collections: `headhunters/{ownerUid}` and `handles/{handle}` (plan sections 3 and 4). Every multi-document
// change is ONE transaction, and every transaction reads before it writes.
import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HANDLES_COLLECTION, HEADHUNTERS_COLLECTION, HEADHUNTER_RENAME_COOLDOWN_DAYS } from './constants.ts';
import { REVIEW_REASON_DISPLAY_NAME, REVIEW_REASON_FLAGGED_HANDLE, planCounter, type CounterPlan } from './counter.ts';
import { countPublishedProjects, countsTowardHeadhunter, isEligible, type CountableProject } from './counting.ts';
import { handleSkeleton } from './handle.ts';
import { nextStatus, type DecisionInput, type ModerationAction } from './moderation.ts';
import type { HeadhunterInput, HeadhunterStatus } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Projects read per owner when counting. A headhunter has hundreds at most; a full page is reported as `truncated`. */
export const PROJECT_SCAN_LIMIT = 1000;
const LOOKALIKE_SCAN_LIMIT = 20;
const HANDLE_FLAG_PREFIX = 'lookalike:';
export const AUDIT_COLLECTION = 'securityAuditEvents';

const headhunterRef = (db: Firestore, uid: string) => db.collection(HEADHUNTERS_COLLECTION).doc(uid);
const handleRef = (db: Firestore, handle: string) => db.collection(HANDLES_COLLECTION).doc(handle);
const now = () => FieldValue.serverTimestamp();

/** Milliseconds of a Firestore Timestamp, Date or number, else null. */
export function millis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Object.prototype.toString.call(value) === '[object Date]') return (value as Date).getTime();
  const toMillis = (value as { toMillis?: () => number } | null | undefined)?.toMillis;
  return typeof toMillis === 'function' ? toMillis.call(value) : null;
}

const present = (value: unknown) => value !== undefined && value !== null;
const publishedOf = (snapshot: DocumentSnapshot) => { const value = Number(snapshot.get('counters.published')); return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; };

// ---------------------------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------------------------

export type ClaimCheck = { ok: true; reclaim: boolean } | { ok: false; code: 'TAKEN' };
type HandleDoc = { exists: boolean; get(field: string): unknown };

/**
 * May `uid` hold `handle`? The handle must not exist in any state, unless it is a RETIRED handle of the same
 * owner (taking it back). A different owner's handle with the same look-alike skeleton is also refused.
 * One rule for the availability check and the claim transaction.
 */
export function evaluateClaim(uid: string, handle: string, existing: HandleDoc, lookalikes: { id: string; get(field: string): unknown }[]): ClaimCheck {
  if (existing.exists) {
    if (existing.get('state') === 'retired' && existing.get('ownerUid') === uid) return { ok: true, reclaim: true };
    return { ok: false, code: 'TAKEN' };
  }
  if (lookalikes.some((doc) => doc.id !== handle && doc.get('ownerUid') !== uid)) return { ok: false, code: 'TAKEN' };
  return { ok: true, reclaim: false };
}

const lookalikeQuery = (db: Firestore, handle: string) => db.collection(HANDLES_COLLECTION).where('skeleton', '==', handleSkeleton(handle)).limit(LOOKALIKE_SCAN_LIMIT);

export async function checkHandleAvailability(db: Firestore, uid: string, handle: string): Promise<ClaimCheck> {
  const [existing, lookalikes] = await Promise.all([handleRef(db, handle).get(), lookalikeQuery(db, handle).get()]);
  return evaluateClaim(uid, handle, existing, lookalikes.docs);
}

type HandleClaimRead = { claim: ClaimCheck };
async function readClaim(tx: Transaction, db: Firestore, uid: string, handle: string): Promise<HandleClaimRead> {
  const [existing, lookalikes] = await Promise.all([tx.get(handleRef(db, handle)), tx.get(lookalikeQuery(db, handle))]);
  return { claim: evaluateClaim(uid, handle, existing, lookalikes.docs) };
}

const withHandleFlags = (current: unknown, handleFlags: string[]): string[] =>
  [...(Array.isArray(current) ? current.filter((flag): flag is string => typeof flag === 'string' && !flag.startsWith(HANDLE_FLAG_PREFIX)) : []), ...handleFlags];

// ---------------------------------------------------------------------------------------------
// Apply, edit, rename
// ---------------------------------------------------------------------------------------------

export type ApplyResult =
  | { ok: true; status: HeadhunterStatus; handle: string; published: number; eligible: boolean }
  | { ok: false; code: 'EXISTS' | 'TAKEN' };

/**
 * Create the record and claim the handle in one transaction. The counter starts at the real count of the
 * owner's existing projects (read in the same transaction, so a project created concurrently is not missed):
 * `draft` below the threshold, `pending` (a review request) at or above it.
 */
export async function applyAsHeadhunter(db: Firestore, uid: string, input: HeadhunterInput, handle: string, handleFlags: string[]): Promise<ApplyResult> {
  return db.runTransaction(async (tx): Promise<ApplyResult> => {
    const ref = headhunterRef(db, uid);
    const [existing, read, projects] = await Promise.all([tx.get(ref), readClaim(tx, db, uid, handle), tx.get(db.collection('projects').where('ownerUid', '==', uid).limit(PROJECT_SCAN_LIMIT))]);
    if (existing.exists) return { ok: false, code: 'EXISTS' };
    if (!read.claim.ok) return { ok: false, code: 'TAKEN' };
    const published = countPublishedProjects(projects.docs.map((doc) => ({ id: doc.id, ...(doc.data() as CountableProject) }))).count;
    const plan = planCounter({ status: 'draft', published: 0, hasEligibleAt: false }, published);
    const status: HeadhunterStatus = plan.status ?? 'draft';
    tx.set(handleRef(db, handle), { handle, ownerUid: uid, state: 'active', skeleton: handleSkeleton(handle), createdAt: now() });
    tx.create(ref, {
      ownerUid: uid, status, handle, ...input,
      counters: { published: plan.published },
      ...(plan.setEligibleAt ? { eligibleAt: now() } : {}),
      flags: handleFlags,
      attestedAt: now(), version: 1, createdAt: now(), updatedAt: now(),
    });
    return { ok: true, status, handle, published: plan.published, eligible: plan.setEligibleAt };
  });
}

export type UpdateResult =
  | { ok: true; status: HeadhunterStatus; handle: string; statusChanged: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'BLOCKED' };

const OPTIONAL_FIELDS = ['city', 'tagline', 'about', 'share'] as const;

/**
 * Save the validated editable fields. Changing `displayName` on an approved record sends it back to review
 * (the name is what the tag shows); every other field keeps it approved. A draft that is already eligible
 * (for example after "request changes") is resubmitted as `pending`. Suspended and rejected records cannot be edited.
 */
export async function updateHeadhunter(db: Firestore, uid: string, input: HeadhunterInput): Promise<UpdateResult> {
  return db.runTransaction(async (tx): Promise<UpdateResult> => {
    const ref = headhunterRef(db, uid);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, code: 'NOT_FOUND' };
    const current = snapshot.get('status') as HeadhunterStatus;
    if (current === 'suspended' || current === 'rejected') return { ok: false, code: 'BLOCKED' };
    let status = current;
    let reviewReason: string | undefined;
    const nameChanged = snapshot.get('displayName') !== input.displayName;
    if (current === 'approved' && nameChanged) { status = 'pending'; reviewReason = REVIEW_REASON_DISPLAY_NAME; }
    else if (current === 'draft' && present(snapshot.get('eligibleAt'))) status = 'pending';
    const patch: Record<string, unknown> = {
      displayName: input.displayName, kind: input.kind, contact: input.contact,
      version: (Number(snapshot.get('version')) || 0) + 1, updatedAt: now(),
    };
    for (const key of OPTIONAL_FIELDS) patch[key] = input[key] === undefined ? FieldValue.delete() : input[key];
    if (status !== current) {
      patch.status = status;
      patch.reviewReason = reviewReason ?? FieldValue.delete();
    }
    tx.update(ref, patch);
    return { ok: true, status, handle: snapshot.get('handle') as string, statusChanged: status !== current };
  });
}

export type RenameResult =
  | { ok: true; handle: string; previous: string; status: HeadhunterStatus }
  | { ok: false; code: 'NOT_FOUND' | 'BLOCKED' | 'SAME' | 'TAKEN' }
  | { ok: false; code: 'COOLDOWN'; retryAfterDays: number };

/**
 * Change the handle in ONE transaction: claim the new handle doc, retire the old one with `pointsTo`, repoint every
 * other retired handle of the owner (so a redirect is always one hop) and update the record. One rename per
 * HEADHUNTER_RENAME_COOLDOWN_DAYS. A new handle with a watched-brand look-alike sends an approved record back to review.
 */
export async function renameHandle(db: Firestore, uid: string, handle: string, handleFlags: string[], at: number = Date.now()): Promise<RenameResult> {
  return db.runTransaction(async (tx): Promise<RenameResult> => {
    const ref = headhunterRef(db, uid);
    const [snapshot, read, owned] = await Promise.all([tx.get(ref), readClaim(tx, db, uid, handle), tx.get(db.collection(HANDLES_COLLECTION).where('ownerUid', '==', uid).limit(200))]);
    if (!snapshot.exists) return { ok: false, code: 'NOT_FOUND' };
    const status = snapshot.get('status') as HeadhunterStatus;
    if (status === 'suspended' || status === 'rejected') return { ok: false, code: 'BLOCKED' };
    const previous = snapshot.get('handle') as string;
    if (previous === handle) return { ok: false, code: 'SAME' };
    const renamedAt = millis(snapshot.get('renamedAt'));
    if (renamedAt !== null && at - renamedAt < HEADHUNTER_RENAME_COOLDOWN_DAYS * DAY_MS) {
      return { ok: false, code: 'COOLDOWN', retryAfterDays: (HEADHUNTER_RENAME_COOLDOWN_DAYS * DAY_MS - (at - renamedAt)) / DAY_MS };
    }
    if (!read.claim.ok) return { ok: false, code: 'TAKEN' };

    tx.set(handleRef(db, handle), { handle, ownerUid: uid, state: 'active', skeleton: handleSkeleton(handle), createdAt: now() });
    tx.update(handleRef(db, previous), { state: 'retired', pointsTo: handle, retiredAt: now() });
    for (const doc of owned.docs) {
      if (doc.id === handle || doc.id === previous || doc.get('state') !== 'retired') continue;
      tx.update(handleRef(db, doc.id), { pointsTo: handle });
    }
    const flagged = handleFlags.length > 0 && status === 'approved';
    tx.update(ref, {
      handle, renamedAt: new Date(at), version: (Number(snapshot.get('version')) || 0) + 1, updatedAt: now(),
      flags: withHandleFlags(snapshot.get('flags'), handleFlags),
      ...(flagged ? { status: 'pending', reviewReason: REVIEW_REASON_FLAGGED_HANDLE } : {}),
    });
    return { ok: true, handle, previous, status: flagged ? 'pending' : status };
  });
}

// ---------------------------------------------------------------------------------------------
// The published-project counter
// ---------------------------------------------------------------------------------------------

export type CounterOutcome = { handle: string; statusChanged: boolean; becameEligible: boolean; status: HeadhunterStatus };

function writeCounter(tx: Transaction, snapshot: DocumentSnapshot, plan: CounterPlan, options: { touchLastProject?: boolean } = {}): CounterOutcome {
  const patch: Record<string, unknown> = { 'counters.published': plan.published, updatedAt: now() };
  if (options.touchLastProject) patch['counters.lastProjectAt'] = now();
  if (plan.setEligibleAt) patch.eligibleAt = now();
  if (plan.status) {
    patch.status = plan.status;
    patch.version = (Number(snapshot.get('version')) || 0) + 1;
    if (plan.reviewReason) patch.reviewReason = plan.reviewReason;
  }
  tx.update(snapshot.ref, patch);
  return { handle: snapshot.get('handle') as string, statusChanged: plan.statusChanged, becameEligible: plan.becameEligible, status: (plan.status ?? snapshot.get('status')) as HeadhunterStatus };
}

const counterInput = (snapshot: DocumentSnapshot) => ({ status: snapshot.get('status'), published: publishedOf(snapshot), hasEligibleAt: present(snapshot.get('eligibleAt')) });

/**
 * Step 1 of the counter, inside a project transaction and BEFORE its writes: the owner's headhunter record, or
 * null when the owner has none (then nothing is counted).
 */
export async function readHeadhunterForCounter(tx: Transaction, db: Firestore, uid: string): Promise<DocumentSnapshot | null> {
  const snapshot = await tx.get(headhunterRef(db, uid));
  return snapshot.exists ? snapshot : null;
}

/**
 * Step 2: the project is being created. Counts it when it is a countable project (`countsTowardHeadhunter`),
 * unlocks at HEADHUNTER_MIN_PROJECTS, and turns an eligible draft into a review request. Duplicates are not detected
 * here; `reconcileHeadhunter` is the exact deduplicating authority.
 */
export function applyProjectCreated(tx: Transaction, snapshot: DocumentSnapshot | null, record: CountableProject): CounterOutcome | null {
  if (!snapshot || !countsTowardHeadhunter(record)) return null;
  const input = counterInput(snapshot);
  return writeCounter(tx, snapshot, planCounter(input, input.published + 1), { touchLastProject: true });
}

/**
 * The project (as it was) is leaving the published set: archived or removed by moderation. Below the review floor an
 * approved record goes back to review.
 */
export function applyProjectRemoved(tx: Transaction, snapshot: DocumentSnapshot | null, before: CountableProject): CounterOutcome | null {
  if (!snapshot || !countsTowardHeadhunter(before)) return null;
  const input = counterInput(snapshot);
  return writeCounter(tx, snapshot, planCounter(input, input.published - 1));
}

export type ReconcileResult = {
  uid: string; handle: string; stored: number; actual: number; drift: number; duplicates: number; truncated: boolean; written: boolean;
  /** Set when the written count changed the status or unlocked the record. */
  outcome?: CounterOutcome;
};

async function scanProjects(read: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot>, db: Firestore, uid: string) {
  const snapshot = await read(db.collection('projects').where('ownerUid', '==', uid).limit(PROJECT_SCAN_LIMIT));
  const counted = countPublishedProjects(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as CountableProject) })));
  return { actual: counted.count, duplicates: counted.duplicateIds.length, truncated: snapshot.size >= PROJECT_SCAN_LIMIT };
}

/**
 * Recount a headhunter's published projects from `projects` and compare with the stored counter. Writes the
 * recount (in a transaction, through the same rules as the live counter) only when `write` is true, and never from a
 * truncated scan.
 */
export async function reconcileHeadhunter(db: Firestore, uid: string, options: { write?: boolean } = {}): Promise<ReconcileResult | null> {
  if (!options.write) {
    const snapshot = await headhunterRef(db, uid).get();
    if (!snapshot.exists) return null;
    const scan = await scanProjects((query) => query.get(), db, uid);
    const stored = publishedOf(snapshot);
    return { uid, handle: snapshot.get('handle') as string, stored, ...scan, drift: scan.actual - stored, written: false };
  }
  return db.runTransaction(async (tx): Promise<ReconcileResult | null> => {
    const snapshot = await tx.get(headhunterRef(db, uid));
    if (!snapshot.exists) return null;
    const scan = await scanProjects((query) => tx.get(query), db, uid);
    const stored = publishedOf(snapshot);
    const base = { uid, handle: snapshot.get('handle') as string, stored, ...scan, drift: scan.actual - stored };
    const plan = planCounter(counterInput(snapshot), scan.actual);
    if (scan.truncated || (scan.actual === stored && !plan.setEligibleAt && !plan.statusChanged)) return { ...base, written: false };
    return { ...base, written: true, outcome: writeCounter(tx, snapshot, plan) };
  });
}

// ---------------------------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------------------------

export type DecisionResult =
  | { ok: true; action: ModerationAction; from: HeadhunterStatus; to: HeadhunterStatus; handle: string; displayName: string }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATE' | 'NOT_ELIGIBLE' };

const CLEARED = ['rejectedReason', 'suspendedReason', 'reviewReason'] as const;

/**
 * Apply a moderator decision and write its `securityAuditEvents` entry in the same transaction. `actor` is the
 * moderator uid (API) or `script:<label>` (admin script). Approval recounts the projects first (plan 15: the counter is
 * an optimisation, the recount is the truth), and requires the record to be eligible. Revoking never retires the handle.
 */
export async function decideHeadhunter(db: Firestore, decision: DecisionInput & { actor: string; via: 'api' | 'script' }): Promise<DecisionResult> {
  const { uid, action, reason, actor, via } = decision;
  return db.runTransaction(async (tx): Promise<DecisionResult> => {
    const ref = headhunterRef(db, uid);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return { ok: false, code: 'NOT_FOUND' };
    const from = snapshot.get('status') as HeadhunterStatus;
    const to = nextStatus(action, from, present(snapshot.get('approvedAt')));
    if (!to) return { ok: false, code: 'INVALID_STATE' };

    const patch: Record<string, unknown> = { status: to, version: (Number(snapshot.get('version')) || 0) + 1, updatedAt: now() };
    if (action === 'approve') {
      const scan = await scanProjects((query) => tx.get(query), db, uid);
      if (!present(snapshot.get('eligibleAt')) && !isEligible(scan.actual)) return { ok: false, code: 'NOT_ELIGIBLE' };
      patch['counters.published'] = scan.actual;
      if (!present(snapshot.get('eligibleAt'))) patch.eligibleAt = now();
      patch.approvedAt = now();
      patch.approvedBy = actor;
      for (const field of CLEARED) patch[field] = FieldValue.delete();
    } else if (action === 'reject') {
      patch.rejectedReason = reason;
    } else if (action === 'suspend') {
      patch.suspendedReason = reason;
    } else if (action === 'request-changes') {
      patch.reviewReason = reason;
    } else {
      for (const field of CLEARED) patch[field] = FieldValue.delete();
    }
    tx.update(ref, patch);
    tx.create(db.collection(AUDIT_COLLECTION).doc(), {
      actorUid: actor, targetUid: uid, action: `headhunter.${action}`, fromStatus: from, toStatus: to, via,
      ...(reason ? { reason } : {}), createdAt: now(),
    });
    return { ok: true, action, from, to, handle: snapshot.get('handle') as string, displayName: snapshot.get('displayName') as string };
  });
}

export type ReviewItem = {
  uid: string; status: string; displayName: string; handle: string; kind: string; city?: string; contact: unknown; flags: string[];
  published: number; lastProjectAt: number | null; eligibleAt: number | null; createdAt: number | null; reason?: string;
};

/** Review order: pending first. */
export const REVIEW_STATUS_ORDER: readonly HeadhunterStatus[] = ['pending', 'draft', 'approved', 'suspended', 'rejected'];

/** Headhunters by status (one equality query per status, no composite index), oldest first within a status. */
export async function listHeadhuntersForReview(db: Firestore, options: { status?: HeadhunterStatus; limit?: number } = {}): Promise<ReviewItem[]> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const statuses = options.status ? [options.status] : REVIEW_STATUS_ORDER;
  const groups = await Promise.all(statuses.map((status) => db.collection(HEADHUNTERS_COLLECTION).where('status', '==', status).limit(limit).get()));
  return groups.flatMap((group) => group.docs
    .map((doc): ReviewItem => ({
      uid: doc.id, status: doc.get('status'), displayName: doc.get('displayName'), handle: doc.get('handle'), kind: doc.get('kind'),
      ...(doc.get('city') ? { city: doc.get('city') as string } : {}), contact: doc.get('contact') ?? {},
      flags: Array.isArray(doc.get('flags')) ? doc.get('flags') : [], published: publishedOf(doc),
      lastProjectAt: millis(doc.get('counters.lastProjectAt')), eligibleAt: millis(doc.get('eligibleAt')), createdAt: millis(doc.get('createdAt')),
      ...(doc.get('rejectedReason') || doc.get('suspendedReason') || doc.get('reviewReason') ? { reason: (doc.get('rejectedReason') || doc.get('suspendedReason') || doc.get('reviewReason')) as string } : {}),
    }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)));
}
