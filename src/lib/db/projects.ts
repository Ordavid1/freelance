import 'server-only';
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
    ...(record.sample === true ? { sample: true } : {}),
    ...(agent ? { ownerKind: 'ai-agent' as const, ...(agent.persona ? { ownerPersona: agent.persona } : {}) } : {}),
  };
}

export async function listOpenProjects(): Promise<Project[]> {
  const snapshot = await firestore().collection('projects').where('status', '==', 'open').limit(100).get();
  return snapshot.docs
    .filter((doc) => isDiscoverableProject(doc.data()))
    .map((doc) => ({ project: toPublicProject(doc.id, doc.data() as ProjectDocument), createdAt: (doc.data() as ProjectDocument).createdAt as { toMillis?: () => number } | undefined }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    .map(({ project }) => project);
}

export async function getOpenProject(slug: string): Promise<Project | null> {
  const snapshot = await firestore().collection('projects').doc(slug).get();
  if (!snapshot.exists || !(snapshot.get('status') === 'open' && isListableProject(snapshot.data() || {}))) return null;
  return toPublicProject(snapshot.id, snapshot.data() as ProjectDocument);
}
