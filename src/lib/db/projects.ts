import 'server-only';
import { unstable_cache } from 'next/cache';
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
    skills: Array.isArray(record.skills) ? record.skills : [],
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

export const listOpenProjects = unstable_cache(async (): Promise<Project[]> => {
  const snapshot = await firestore().collection('projects').where('status', '==', 'open').limit(100).get();
  return snapshot.docs
    .filter((doc) => isDiscoverableProject(doc.data()))
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
