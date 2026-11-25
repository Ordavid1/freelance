import 'server-only';
import { projectSkills } from '@/lib/projects/skills';
import { unstable_cache } from 'next/cache';
import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Project } from '@/lib/data';
import { firestore } from './firestore';
import { isDiscoverableProject, isListableProject, isSyntheticProject } from '@/lib/seo/publication';
import { HEADHUNTERS_TAG, HEADHUNTER_CLOSED_LIMIT, HEADHUNTER_PAGE_SIZE, HEADHUNTER_PROJECT_READ_LIMIT, headhunterTag } from '@/lib/headhunters/constants';
import { getHeadhunterConfig, getPublicHeadhunters } from '@/lib/db/headhunters';
import { SAMPLE_CLIENT_HISTORY } from '@/lib/projects/presentation';
import { employmentTypeOf, type EmploymentType } from '@/lib/projects/employment';

export type ProjectDocument = {
  title?: string; category?: string; description?: string; budget?: string; deadline?: string;
  clientName?: string; ownerUid?: string; unreal?: boolean; owner?: { kind?: string; name?: string; persona?: string }; skills?: string[]; status?: string; proposals?: number; createdAt?: unknown; visibility?: string; sample?: boolean; employmentType?: EmploymentType;
};

export function toPublicProject(slug: string, record: ProjectDocument): Project {
  const agent = record.sample === true && record.owner?.kind === 'ai-agent' ? record.owner : null;
  const name = record.clientName || agent?.name || 'לקוח/ה חדש/ה';
  return {
    slug,
    title: record.title || '',
    category: record.category || 'כללי',
    description: record.description || '',
    budget: record.budget || 'התקציב בשיחה',
    deadline: record.deadline || 'גמיש',
    employmentType: employmentTypeOf(record),
    posted: 'פרויקט חדש',
    client: name,
    clientHistory: record.sample === true ? SAMPLE_CLIENT_HISTORY : 'פרויקט ראשון ב־Freelance Place',
    skills: projectSkills({title:record.title||'',description:record.description||'',skills:Array.isArray(record.skills)?record.skills:[]}),
    fit: 'בדקו אם הפרויקט מתאים לכם',
    activity: 'פתוח להצעות',
    proposals: Number(record.proposals) || 0,
    status: record.status || 'open',
    createdAt: (record.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.(),
    updatedAt: (record as { updatedAt?: { toMillis?: () => number } }).updatedAt?.toMillis?.(),
    ...(record.sample === true ? { sample: true } : {}),
    ...(agent ? { ownerKind: 'ai-agent' as const, ...(agent.persona ? { ownerPersona: agent.persona } : {}) } : {}),
  };
}

// Public reads are cached for 60 seconds (tag `projects`, plus `project:<slug>`). Cached values
// are plain JSON: toPublicProject already turns Firestore Timestamps into millisecond numbers.
const PUBLIC_PROJECT_REVALIDATE_SECONDS = 60;
const newestFirst = (a: Project, b: Project) => (b.createdAt || 0) - (a.createdAt || 0);

type Entry = { project: Project; record: ProjectDocument };
const toEntry = (doc: { id: string; data(): unknown }): Entry => {
  const record = doc.data() as ProjectDocument;
  return { project: toPublicProject(doc.id, record), record };
};

// The headhunter tag is derived from the project owner, never stored on the project: one batched read of the
// distinct owners of the page (getPublicHeadhunters), none for showcase projects, none while the feature switch is
// off, and none for a headhunter that is not live. Only { name, handle } is attached; the owner uid never leaves
// this function. The readers below list the `headhunters` cache tag, so a suspension or rename drops their cache.
// A failed headhunter read only costs the tags, never the projects.
async function withHeadhunterTags(entries: Entry[]): Promise<Project[]> {
  const plain = entries.map((entry) => entry.project);
  const ownerOf = (entry: Entry) => (!isSyntheticProject(entry.record) && typeof entry.record.ownerUid === 'string' && entry.record.ownerUid ? entry.record.ownerUid : null);
  const owners = entries.map(ownerOf).filter((uid): uid is string => uid !== null);
  if (owners.length === 0) return plain;
  try {
    if (!(await getHeadhunterConfig()).enabled) return plain;
    const found = await getPublicHeadhunters(owners);
    return entries.map((entry) => {
      const uid = ownerOf(entry);
      const tag = uid ? found.get(uid) : undefined;
      return tag ? { ...entry.project, headhunter: { name: tag.name, handle: tag.handle } } : entry.project;
    });
  } catch (error) {
    console.warn('Headhunter tags unavailable', error instanceof Error ? error.name : 'Error');
    return plain;
  }
}

// Discovery lists are capped at 100 projects, and the cap counts discoverable projects only. Showcase
// and incomplete documents are skipped while paging (document-ID order, the order the plain query
// returned), so they can never use up the cap and push real projects out of a public list.
const DISCOVERY_LIMIT = 100;
const DISCOVERY_PAGE_SIZE = 100;
const DISCOVERY_MAX_PAGES = 50;
async function discoverableDocuments() {
  const found: QueryDocumentSnapshot[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < DISCOVERY_MAX_PAGES && found.length < DISCOVERY_LIMIT; page++) {
    let query = firestore().collection('projects').where('status', '==', 'open').orderBy(FieldPath.documentId()).limit(DISCOVERY_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const batch = await query.get();
    for (const doc of batch.docs) {
      if (found.length < DISCOVERY_LIMIT && isDiscoverableProject(doc.data())) found.push(doc);
    }
    if (batch.size < DISCOVERY_PAGE_SIZE) break;
    cursor = batch.docs[batch.docs.length - 1].id;
  }
  return found;
}

export const listOpenProjects = unstable_cache(async (): Promise<Project[]> => {
  const entries = (await discoverableDocuments()).map(toEntry);
  return (await withHeadhunterTags(entries)).sort(newestFirst);
}, ['public-projects-open'], { revalidate: PUBLIC_PROJECT_REVALIDATE_SECONDS, tags: ['projects', HEADHUNTERS_TAG] });

// The feed shown on the home page and returned by the public GET /api/marketplace/projects:
// open and closed listable projects, newest first.
export const listFeedProjects = unstable_cache(async (): Promise<Project[]> => {
  const snapshot = await firestore().collection('projects').where('status', 'in', ['open', 'closed']).limit(100).get();
  const entries = snapshot.docs.filter((doc) => isListableProject(doc.data())).map(toEntry);
  return (await withHeadhunterTags(entries)).sort(newestFirst);
}, ['public-projects-feed'], { revalidate: PUBLIC_PROJECT_REVALIDATE_SECONDS, tags: ['projects', HEADHUNTERS_TAG] });

export function getOpenProject(slug: string): Promise<Project | null> {
  return unstable_cache(async (): Promise<Project | null> => {
    const snapshot = await firestore().collection('projects').doc(slug).get();
    if (!snapshot.exists || !(snapshot.get('status') === 'open' && isListableProject(snapshot.data() || {}))) return null;
    return (await withHeadhunterTags([toEntry(snapshot)]))[0];
  }, ['public-project', slug], { revalidate: PUBLIC_PROJECT_REVALIDATE_SECONDS, tags: ['projects', `project:${slug}`, HEADHUNTERS_TAG] })();
}

export type HeadhunterProjects = {
  /** Open projects of this owner (all pages). */
  openCount: number;
  /** Open and closed projects shown on the site (the "published" figure). */
  publishedCount: number;
  /** The requested page of open projects, newest first. Empty when the page is out of range. */
  items: Project[];
  /** The most recently closed projects (titles only on the page; closed projects have no public page). */
  closed: Project[];
};

/**
 * Pure selection for one headhunter's minisite, with the same public predicates as the feed: listable, not a
 * showcase project. Open projects newest first (paged), closed ones by closing time (updatedAt), capped.
 */
export function selectHeadhunterProjects(documents: readonly { id: string; data(): unknown }[], page: number, size: number = HEADHUNTER_PAGE_SIZE): HeadhunterProjects {
  const shown = documents
    .filter((doc) => { const record = doc.data() as ProjectDocument; return isListableProject(record) && !isSyntheticProject(record); })
    .map((doc) => toPublicProject(doc.id, doc.data() as ProjectDocument));
  const open = shown.filter((project) => project.status === 'open').sort(newestFirst);
  const closed = shown.filter((project) => project.status === 'closed')
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, HEADHUNTER_CLOSED_LIMIT);
  const start = (page - 1) * size;
  return { openCount: open.length, publishedCount: shown.length, items: open.slice(start, start + size), closed };
}

/**
 * The minisite data of one headhunter, cached per handle and page for 60 seconds (tags `projects`, `headhunters`,
 * `headhunter:<handle>`). A single-field `ownerUid ==` query (indexed automatically); only the requested page and the
 * counts are cached, so the cached value stays small whatever the size of the account.
 */
export function getHeadhunterProjects(ownerUid: string, handle: string, page: number): Promise<HeadhunterProjects> {
  return unstable_cache(async (): Promise<HeadhunterProjects> => {
    const snapshot = await firestore().collection('projects').where('ownerUid', '==', ownerUid).limit(HEADHUNTER_PROJECT_READ_LIMIT).get();
    return selectHeadhunterProjects(snapshot.docs, page);
  }, ['headhunter-projects', handle, String(page)], { revalidate: PUBLIC_PROJECT_REVALIDATE_SECONDS, tags: ['projects', HEADHUNTERS_TAG, headhunterTag(handle)] })();
}
