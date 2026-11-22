import 'server-only';
import { createHash } from 'node:crypto';
import { revalidateTag, unstable_cache } from 'next/cache';
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import {
  HANDLES_COLLECTION, HEADHUNTERS_COLLECTION, HEADHUNTERS_TAG, HEADHUNTER_CONFIG, headhunterTag,
} from '@/lib/headhunters/constants';
import { isHandleFormat } from '@/lib/headhunters/handle';
import { HEADHUNTER_API_ERRORS } from '@/lib/headhunters/messages';
import * as store from '@/lib/headhunters/store';
import { headhunterPublicState } from '@/lib/headhunters/state';
import { isTrialRunning } from '@/lib/headhunters/trial';
import type { HandleRecord, HeadhunterRecord, PublicHeadhunterTag } from '@/lib/headhunters/types';
import { accountState } from '@/lib/security/marketplace-policy';

// Server wrapper over src/lib/headhunters/store.ts: binds Firestore, adds the cached public reads and the
// cache invalidation. Public reads are cached for 60 seconds (tag `headhunters`, plus `headhunter:<handle>`).
const REVALIDATE_SECONDS = 60;
const PUBLIC_UID_LIMIT = 100;

export type HeadhunterConfig = { enabled: boolean; applicationsOpen: boolean };

/** The feature switch: Firestore document `config/headhunters`. Missing or malformed means off. */
export const getHeadhunterConfig = unstable_cache(async (): Promise<HeadhunterConfig> => {
  const snapshot = await firestore().collection(HEADHUNTER_CONFIG.collection).doc(HEADHUNTER_CONFIG.doc).get();
  return { enabled: snapshot.get('enabled') === true, applicationsOpen: snapshot.get('applicationsOpen') === true };
}, ['headhunter-config'], { revalidate: REVALIDATE_SECONDS, tags: [HEADHUNTERS_TAG] });

/** Whether to show the entry card that links to the headhunter editor; an unreadable switch means off. */
export async function headhunterEntryEnabled(): Promise<boolean> {
  try { return (await getHeadhunterConfig()).enabled; } catch { return false; }
}

/**
 * Gate for every headhunter route: 404 while the feature is off (the routes do not exist for the public), 403 for an
 * application while applications are closed, 503 when the switch cannot be read (fails closed).
 */
export async function headhunterGate(options: { applications?: boolean } = {}): Promise<{ ok: true; config: HeadhunterConfig } | { ok: false; response: Response }> {
  let config: HeadhunterConfig;
  try { config = await getHeadhunterConfig(); }
  catch { return { ok: false, response: Response.json({ error: HEADHUNTER_API_ERRORS.UNAVAILABLE }, { status: 503, headers: { 'Cache-Control': 'no-store' } }) }; }
  if (!config.enabled) return { ok: false, response: Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: { 'Cache-Control': 'no-store' } }) };
  if (options.applications && !config.applicationsOpen) return { ok: false, response: Response.json({ code: 'APPLICATIONS_CLOSED', error: HEADHUNTER_API_ERRORS.APPLICATIONS_CLOSED }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) };
  return { ok: true, config };
}

/** Firestore Timestamps become milliseconds, so a record is plain JSON (cacheable and serialisable). */
function plain<T>(data: unknown): T {
  const convert = (value: unknown): unknown => {
    const ms = store.millis(value);
    if (ms !== null && typeof value === 'object') return ms;
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, convert(inner)]));
    return value;
  };
  return convert(data) as T;
}

const toRecord = (snapshot: DocumentSnapshot) => plain<HeadhunterRecord>({ ...snapshot.data(), ownerUid: snapshot.id });

/** The owner's own record, always fresh. */
export async function getHeadhunter(uid: string): Promise<HeadhunterRecord | null> {
  const snapshot = await firestore().collection(HEADHUNTERS_COLLECTION).doc(uid).get();
  return snapshot.exists ? toRecord(snapshot) : null;
}

export type HandleLookup = { kind: 'active'; record: HeadhunterRecord } | { kind: 'redirect'; to: string };

/**
 * Resolve a URL handle. The format is checked BEFORE any read, so probes such as `/.env` never reach Firestore.
 * `active` returns the record whatever its status (the page decides visibility with `headhunterPublicState`);
 * `redirect` is a retired handle that points to its owner's current handle; anything else is null (a real 404).
 */
export function getHeadhunterByHandle(handle: string): Promise<HandleLookup | null> {
  if (!isHandleFormat(handle)) return Promise.resolve(null);
  return unstable_cache(async (): Promise<HandleLookup | null> => {
    const db = firestore();
    const doc = await db.collection(HANDLES_COLLECTION).doc(handle).get();
    if (!doc.exists) return null;
    const entry = doc.data() as HandleRecord;
    if (entry.state === 'retired') return typeof entry.pointsTo === 'string' && isHandleFormat(entry.pointsTo) ? { kind: 'redirect', to: entry.pointsTo } : null;
    const snapshot = await db.collection(HEADHUNTERS_COLLECTION).doc(entry.ownerUid).get();
    // The ledger and the record must agree; a record that moved on is not served under the old handle.
    if (!snapshot.exists || snapshot.get('handle') !== handle) return null;
    return { kind: 'active', record: toRecord(snapshot) };
  }, ['headhunter-by-handle', handle], { revalidate: REVALIDATE_SECONDS, tags: [HEADHUNTERS_TAG, headhunterTag(handle)] })();
}

/**
 * The tag data for a set of project owners: one batched read of the distinct uids, then one of their account
 * states. Only live headhunters are included (approved, eligible, account active), through `headhunterPublicState`.
 */
export async function getPublicHeadhunters(uids: string[]): Promise<Map<string, PublicHeadhunterTag>> {
  const distinct = [...new Set(uids.filter((uid): uid is string => typeof uid === 'string' && uid.length > 0))].sort().slice(0, PUBLIC_UID_LIMIT);
  if (distinct.length === 0) return new Map();
  const key = createHash('sha256').update(JSON.stringify(distinct)).digest('hex');
  const entries = await unstable_cache(async (): Promise<[string, PublicHeadhunterTag][]> => {
    const db = firestore();
    const records = await db.getAll(...distinct.map((uid) => db.collection(HEADHUNTERS_COLLECTION).doc(uid)));
    const candidates = records.filter((snapshot) => snapshot.exists && snapshot.get('status') === 'approved' && (snapshot.get('eligibleAt') != null || snapshot.get('fastTrack') === true));
    if (candidates.length === 0) return [];
    const security = await db.getAll(...candidates.map((snapshot) => db.collection('accountSecurity').doc(snapshot.id)));
    const active = new Map(security.map((snapshot) => [snapshot.id, accountState(snapshot.get('state')) === 'active']));
    const found: [string, PublicHeadhunterTag][] = [];
    for (const snapshot of candidates) {
      const eligible = snapshot.get('eligibleAt') != null;
      // The trial verdict is taken when this cache entry is built, so a tag can outlive the window by at most REVALIDATE_SECONDS.
      const trialRunning = isTrialRunning({ status: snapshot.get('status'), fastTrack: snapshot.get('fastTrack'), eligible, trialEndsAt: store.millis(snapshot.get('trialEndsAt')) }, Date.now());
      const state = headhunterPublicState({ status: snapshot.get('status'), eligible, accountActive: active.get(snapshot.id) === true, openProjects: 0, trialRunning });
      const name = snapshot.get('displayName');
      const handle = snapshot.get('handle');
      if (state.live && typeof name === 'string' && typeof handle === 'string' && isHandleFormat(handle)) found.push([snapshot.id, { name, handle }]);
    }
    return found;
  }, ['headhunters-public', key], { revalidate: REVALIDATE_SECONDS, tags: [HEADHUNTERS_TAG] })();
  return new Map(entries);
}

/** Whether the account may be shown publicly (same source as `accountWriteDenied`: `accountSecurity/{uid}.state`). */
export async function isAccountActive(uid: string): Promise<boolean> {
  const snapshot = await firestore().collection('accountSecurity').doc(uid).get();
  return accountState(snapshot.get('state')) === 'active';
}

/** Drop the cached public reads after a change. Runs in the request handler (revalidateTag cannot run in Proxy). */
export function invalidateHeadhunterCache(handle?: string): void {
  const tags = [HEADHUNTERS_TAG, ...(handle && isHandleFormat(handle) ? [headhunterTag(handle)] : [])];
  for (const tag of tags) {
    try { revalidateTag(tag, { expire: 0 }); }
    catch (error) { console.warn('Headhunter cache invalidation failed', { error: error instanceof Error ? error.name : 'Error' }); }
  }
}

// --- Writes: the shared store bound to Firestore --------------------------------------------------------------------

export const applyAsHeadhunter = (...args: [string, Parameters<typeof store.applyAsHeadhunter>[2], string, string[]]) => store.applyAsHeadhunter(firestore(), ...args);
export const updateHeadhunter = (uid: string, input: Parameters<typeof store.updateHeadhunter>[2]) => store.updateHeadhunter(firestore(), uid, input);
export const renameHandle = (uid: string, handle: string, flags: string[]) => store.renameHandle(firestore(), uid, handle, flags);
export const checkHandleAvailability = (uid: string, handle: string) => store.checkHandleAvailability(firestore(), uid, handle);
export const decideHeadhunter = (decision: Parameters<typeof store.decideHeadhunter>[1]) => store.decideHeadhunter(firestore(), decision);
export const reconcileHeadhunter = (uid: string, options?: { write?: boolean }) => store.reconcileHeadhunter(firestore(), uid, options);
export const listHeadhuntersForReview = (options?: Parameters<typeof store.listHeadhuntersForReview>[1]) => store.listHeadhuntersForReview(firestore(), options);

/** The counter, for the project-create (and later archive / removal) transactions. */
export const readHeadhunterForCounter = (tx: Transaction, uid: string) => store.readHeadhunterForCounter(tx, firestore(), uid);
export const { applyProjectCreated, applyProjectRemoved } = store;
export type { CounterOutcome } from '@/lib/headhunters/store';

/** After a counter change: drop the caches only when the visible state (status or unlock) can have changed. */
export function invalidateAfterCounter(outcome: store.CounterOutcome | null | undefined): void {
  if (outcome && (outcome.statusChanged || outcome.becameEligible)) invalidateHeadhunterCache(outcome.handle);
}
