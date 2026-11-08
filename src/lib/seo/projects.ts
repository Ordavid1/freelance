import 'server-only';
import { cache } from 'react';
import { FieldPath } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { getOpenProject, listOpenProjects } from '@/lib/db/projects';
import { getProject } from '@/lib/data';
import { isDiscoverableProject } from './publication';

export const readPublicProject = cache(async (slug: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(slug)) return null;
  return getProject(slug) || getOpenProject(slug);
});
export const discoveryProjects = cache(async () => {
  try { return await listOpenProjects(); }
  catch (error) { console.error('Public project discovery unavailable', error instanceof Error ? error.name : 'Error'); return []; }
});
// Separate from the UI's 100-item feed: every published record is considered.
// A failed DB read must fail the sitemap, not publish a misleading empty snapshot.
export async function sitemapProjects() {
  const entries: { slug: string; updatedAt?: Date }[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = firestore().collection('projects').where('status', '==', 'open').orderBy(FieldPath.documentId()).limit(1000);
    if (cursor) query = query.startAfter(cursor);
    const batch = await query.get();
    for (const doc of batch.docs) {
      const record = doc.data();
      if (!isDiscoverableProject(record)) continue;
      const timestamp = record.updatedAt || record.createdAt;
      const updatedAt = typeof timestamp?.toDate === 'function' ? timestamp.toDate() as Date : undefined;
      entries.push({ slug: doc.id, updatedAt: updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt : undefined });
      if (entries.length > 49000) throw new Error('Project sitemap requires sharding before publishing more than 49,000 entries.');
    }
    if (batch.size < 1000) return entries;
    cursor = batch.docs[batch.docs.length - 1].id;
  }
}
