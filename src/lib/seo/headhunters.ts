import 'server-only';
import { FieldPath } from 'firebase-admin/firestore';
import { getHeadhunterConfig } from '@/lib/db/headhunters';
import { firestore } from '@/lib/db/firestore';
import { HEADHUNTER_PROJECT_READ_LIMIT, HEADHUNTERS_COLLECTION } from '@/lib/headhunters/constants';
import { indexableHeadhunterEntries, type HeadhunterSitemapInput, type IndexableHeadhunterPage } from '@/lib/headhunters/seo';
import { accountState } from '@/lib/security/marketplace-policy';
import { isDiscoverableProject } from './publication';

const BATCH = 1000;
const LOOKUP_CHUNK = 300;
const CONCURRENCY = 8;
const MAX_PAGES = 49000;

function toDate(value: unknown): Date | undefined {
  const date = typeof (value as { toDate?: unknown } | null)?.toDate === 'function' ? (value as { toDate(): Date }).toDate() : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

/**
 * Whether the agency-page landing (the registry page at HEADHUNTER_EDITOR_PATH) is being served: it answers 404 while the headhunter
 * feature switch is off, so the sitemap lists it only while the switch is on. Fails closed like `indexableHeadhunterPages()`.
 */
export async function headhunterLandingServed(): Promise<boolean> {
  return (await getHeadhunterConfig()).enabled;
}

/**
 * The minisites search engines and AI crawlers may list (sitemap, llms-full): approved, eligible, account active and at
 * least one open project, through `headhunterPublicState(...).indexable`. Page 1 only: later `?page=n` pages are served
 * noindex, so they are never listed. `lastModified` is the newest open project change or the record's own update.
 * Like `sitemapProjects()` it fails closed: any failed read throws, so a partial snapshot is never published.
 * Uses single-field queries only (`status ==` on headhunters, `ownerUid ==` on projects), so no composite index.
 */
export async function indexableHeadhunterPages(): Promise<IndexableHeadhunterPage[]> {
  if (!(await getHeadhunterConfig()).enabled) return [];
  const db = firestore();
  const approved: { id: string; data: Record<string, unknown> }[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = db.collection(HEADHUNTERS_COLLECTION).where('status', '==', 'approved').orderBy(FieldPath.documentId()).limit(BATCH);
    if (cursor) query = query.startAfter(cursor);
    const batch = await query.get();
    for (const doc of batch.docs) if (doc.get('eligibleAt') != null) approved.push({ id: doc.id, data: doc.data() });
    if (approved.length > MAX_PAGES) throw new Error('Headhunter sitemap requires sharding before publishing more than 49,000 entries.');
    if (batch.size < BATCH) break;
    cursor = batch.docs[batch.docs.length - 1].id;
  }
  if (approved.length === 0) return [];

  const active = new Map<string, boolean>();
  for (let index = 0; index < approved.length; index += LOOKUP_CHUNK) {
    const chunk = approved.slice(index, index + LOOKUP_CHUNK);
    const snapshots = await db.getAll(...chunk.map(({ id }) => db.collection('accountSecurity').doc(id)));
    for (const snapshot of snapshots) active.set(snapshot.id, accountState(snapshot.get('state')) === 'active');
  }

  const rows: HeadhunterSitemapInput[] = [];
  for (let index = 0; index < approved.length; index += CONCURRENCY) {
    rows.push(...await Promise.all(approved.slice(index, index + CONCURRENCY).map(async ({ id, data }): Promise<HeadhunterSitemapInput> => {
      const accountActive = active.get(id) === true;
      let openProjects = 0;
      let latest: Date | undefined;
      if (accountActive) {
        const snapshot = await db.collection('projects').where('ownerUid', '==', id).limit(HEADHUNTER_PROJECT_READ_LIMIT).get();
        for (const doc of snapshot.docs) {
          const record = doc.data();
          if (!isDiscoverableProject(record)) continue;
          openProjects += 1;
          const changed = toDate(record.updatedAt) ?? toDate(record.createdAt);
          if (changed && (!latest || changed > latest)) latest = changed;
        }
      }
      const own = toDate(data.updatedAt);
      const lastModified = latest && own ? (latest > own ? latest : own) : latest ?? own;
      return { handle: data.handle, displayName: data.displayName, status: data.status, eligible: true, accountActive, openProjects, ...(lastModified ? { lastModified } : {}) };
    })));
  }
  return indexableHeadhunterEntries(rows);
}
