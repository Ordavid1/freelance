import 'server-only';
import { randomUUID } from 'node:crypto';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { userUploadsBucket } from '@/lib/db/storage';
const DAY = 86_400_000;
export function staleUpload(data: Record<string, unknown> | undefined, path: string, cutoff: number) {
  if (!data || !['uploading', 'cleanup'].includes(String(data.status))) return null;
  const uid = data.ownerUid, id = path.split('/').at(-1);
  const created = (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.();
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !id || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || path !== `users/${uid}/profileSources/${id}` || data.objectName !== `users/${uid}/profile-sources/${id}` || typeof created !== 'number' || !Number.isFinite(created) || created > cutoff) return null;
  return { uid, id, objectName: data.objectName as string };
}
export async function cleanupStaleUploads(now = Date.now()) {
  const db = firestore(), bucket = userUploadsBucket(), cutoff = now - DAY;
  const snapshot = await db.collectionGroup('profileSources').where('status', 'in', ['uploading', 'cleanup']).where('createdAt', '<=', Timestamp.fromMillis(cutoff)).orderBy('createdAt').limit(20).get();
  let deleted = 0, review = 0;
  for (const candidate of snapshot.docs) {
    const lease = randomUUID();
    try {
      const item = await db.runTransaction(async tx => {
        const current = await tx.get(candidate.ref);
        const item = staleUpload(current.data(), candidate.ref.path, cutoff);
        if (!item) return null;
        tx.update(candidate.ref, { status: 'cleanup', cleanupLease: lease, cleanupStartedAt: FieldValue.serverTimestamp() });
        return item;
      });
      if (!item) { review++; continue; }
      const file = bucket.file(item.objectName);
      let metadata;
      try { [metadata] = await file.getMetadata(); } catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
      if (metadata) {
        const objectCreated = Date.parse(metadata.timeCreated || '');
        if (metadata.metadata?.ownerUid !== item.uid || metadata.metadata?.sourceId !== item.id || !metadata.generation || !Number.isFinite(objectCreated) || objectCreated > cutoff) throw new Error('OBJECT_REQUIRES_REVIEW');
        await file.delete({ ignoreNotFound: true, ifGenerationMatch: metadata.generation });
      }
      await db.runTransaction(async tx => {
        const current = await tx.get(candidate.ref);
        if (current.get('status') === 'cleanup' && current.get('cleanupLease') === lease) {
          tx.delete(candidate.ref);
          tx.create(db.collection('securityAuditEvents').doc(), { action: 'upload.cleanup', sourceRef: candidate.ref.path, createdAt: FieldValue.serverTimestamp() });
        }
      });
      deleted++;
    } catch {
      review++;
      // Quarantine failed work instead of repeatedly starving later records.
      await db.runTransaction(async tx => {
        const current = await tx.get(candidate.ref);
        if (current.get('cleanupLease') === lease && current.get('status') === 'cleanup') {
          tx.update(candidate.ref, { status: 'cleanup_review', cleanupLease: null });
          tx.create(db.collection('securityAuditEvents').doc(), { action: 'upload.cleanup_review', sourceRef: candidate.ref.path, createdAt: FieldValue.serverTimestamp() });
        }
      });
    }
  }
  return { examined: snapshot.size, deleted, review };
}
