import 'server-only';
import { projectSkills } from '@/lib/projects/skills';
import { unstable_cache } from 'next/cache';
import { FieldPath, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Project } from '@/lib/data';
import { firestore } from './firestore';
import { isDiscoverableProject, isListableProject } from '@/lib/seo/publication';
import { SAMPLE_CLIENT_HISTORY } from '@/lib/projects/presentation';

export type ProjectDocument = {
  title?: string; category?: string; description?: string; budget?: string; deadline?: string;
  clientName?: string; owner?: { kind?: string; name?: string; persona?: string }; skills?: string[]; status?: string; proposals?: number; createdAt?: unknown; visibility?: string; sample?: boolean;
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
  return (await discoverableDocuments())
    .map((doc) => toPublicProject(doc.id, doc.data() as ProjectDocument))
    .sort(newestFirst);
}, ['public-projects-open'], { revalidate: PUBLIC_PROJECT_REVALIDATE_SECONDS, tags: ['projects'] });

// The feed shown on the home page and returned by the public GET /api/marketplace/projects:
// open and closed listable projects, newest first.
export const listFeedProjects = unstable_cache(async (): Promise<Project[]> => {
  const snapshot = await firestore().collection('projects').where('status', 'in', ['open', 'closed']).limit(100).get();
  return snapshot.docs
    .filter((doc) => isListableProject(doc.data()))
    .map((doc) => toPublicProject(doc.id, doc.data() as ProjectDocument))
    .sort(newestFirst);
}, ['public-projects-feed'], { revalidate: PUBLIC_PROJECT_REVALIDATE_SECONDS, tags: ['projects'] });

export function getOpenProject(slug: string): Promise<Project | null> {
  return unstable_cache(async (): Promise<Project | null> => {
    const snapshot = await firestore().collection('projects').doc(slug).get();
    if (!snapshot.exists || !(snapshot.get('status') === 'open' && isListableProject(snapshot.data() || {}))) return null;
    return toPublicProject(snapshot.id, snapshot.data() as ProjectDocument);
  }, ['public-project', slug], { revalidate: PUBLIC_PROJECT_REVALIDATE_SECONDS, tags: ['projects', `project:${slug}`] })();
}
