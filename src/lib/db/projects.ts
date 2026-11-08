import 'server-only';
import type { Project } from '@/lib/data';
import { firestore } from './firestore';

type ProjectDocument = {
  title?: string; category?: string; description?: string; budget?: string; deadline?: string;
  clientName?: string; skills?: string[]; status?: string; proposals?: number; createdAt?: unknown;
};

export function toPublicProject(slug: string, record: ProjectDocument): Project {
  const name = record.clientName || 'לקוח/ה חדש/ה';
  return {
    slug,
    title: record.title || '',
    category: record.category || 'כללי',
    description: record.description || '',
    budget: record.budget || 'התקציב בשיחה',
    deadline: record.deadline || 'גמיש',
    posted: 'פרויקט חדש',
    client: name,
    clientHistory: 'פרויקט ראשון ב־Freelance Zone',
    skills: Array.isArray(record.skills) ? record.skills : [],
    fit: 'בדקו אם הפרויקט מתאים לכם',
    activity: 'פתוח להצעות',
    proposals: Number(record.proposals) || 0,
  };
}

export async function listOpenProjects(): Promise<Project[]> {
  const snapshot = await firestore().collection('projects').where('status', '==', 'open').limit(100).get();
  return snapshot.docs
    .map((doc) => ({ project: toPublicProject(doc.id, doc.data() as ProjectDocument), createdAt: (doc.data() as ProjectDocument).createdAt as { toMillis?: () => number } | undefined }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    .map(({ project }) => project);
}

export async function getOpenProject(slug: string): Promise<Project | null> {
  const snapshot = await firestore().collection('projects').doc(slug).get();
  if (!snapshot.exists || snapshot.get('status') !== 'open') return null;
  return toPublicProject(snapshot.id, snapshot.data() as ProjectDocument);
}
