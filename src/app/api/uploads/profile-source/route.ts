import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { userUploadsBucket } from '@/lib/db/storage';

export const runtime = 'nodejs';
export const maxDuration = 30;
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות במסמכים.' }, { status: 401 });
  try {
    // Each account can store five files. Sort this bounded set locally so loading
    // sources does not depend on a separate status/createdAt composite index.
    const snapshot = await firestore().collection('users').doc(user.uid).collection('profileSources').where('status', '==', 'ready').limit(20).get();
    const sources = snapshot.docs.map((doc) => ({
      id: doc.id, name: doc.get('name'), size: doc.get('size'),
      createdAt: doc.get('createdAt')?.toMillis?.() ?? 0,
    })).filter((source) => typeof source.name === 'string' && typeof source.size === 'number')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, name, size }) => ({ id, name, size }));
    return NextResponse.json({ sources }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון את המסמכים כרגע.' }, { status: 503 });
  }
}

function safeName(name: string) {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(-160) || 'source-file';
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לשמור מסמך.' }, { status: 401 });
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES + 100_000) return NextResponse.json({ error: 'הקובץ גדול מדי.' }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return NextResponse.json({ error: 'אפשר להעלות מסמך אחד עד 8MB.' }, { status: 400 });
  const extension = safeName(file.name).toLowerCase().split('.').pop();
  if (!['pdf', 'txt', 'md'].includes(extension || '')) return NextResponse.json({ error: 'אפשר להעלות PDF, TXT או Markdown בלבד.' }, { status: 415 });
  const bytes = Buffer.from(await file.arrayBuffer());
  let validText = true;
  if (extension !== 'pdf') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { validText = false; }
  }
  if ((extension === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) || (extension !== 'pdf' && (bytes.includes(0) || !validText))) {
    return NextResponse.json({ error: 'תוכן הקובץ אינו תואם לסוג שנבחר.' }, { status: 415 });
  }
  const id = randomUUID();
  const objectName = `users/${user.uid}/profile-sources/${id}`;
  const object = userUploadsBucket().file(objectName);
  const sourceRef = firestore().collection('users').doc(user.uid).collection('profileSources').doc(id);
  try {
    await firestore().runTransaction(async (transaction) => {
      const existing = await transaction.get(sourceRef.parent);
      const fileSources = existing.docs.filter((doc) => typeof doc.get('objectName') === 'string' && typeof doc.get('size') === 'number');
      const usedBytes = fileSources.reduce((total, doc) => total + (doc.get('size') as number), 0);
      if (fileSources.length >= 5) throw new Error('SOURCE_COUNT_LIMIT');
      if (usedBytes + bytes.byteLength > 40 * 1024 * 1024) throw new Error('SOURCE_STORAGE_LIMIT');
      transaction.create(sourceRef, {
        objectName, name: safeName(file.name), contentType: extension === 'pdf' ? 'application/pdf' : 'text/plain',
        size: bytes.byteLength, ownerUid: user.uid, status: 'uploading', createdAt: FieldValue.serverTimestamp(),
      });
    });
    await object.save(bytes, {
      resumable: false,
      validation: 'crc32c',
      contentType: extension === 'pdf' ? 'application/pdf' : 'text/plain',
      metadata: { metadata: { ownerUid: user.uid, sourceId: id } },
    });
    await sourceRef.update({ status: 'ready' });
    return NextResponse.json({ source: { id, name: safeName(file.name), size: bytes.byteLength } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await object.delete({ ignoreNotFound: true }).catch(() => undefined);
    await sourceRef.delete().catch(() => undefined);
    if (error instanceof Error && error.message === 'SOURCE_COUNT_LIMIT') return NextResponse.json({ error: 'אפשר לשמור עד 5 מסמכים בפרופיל.' }, { status: 409 });
    if (error instanceof Error && error.message === 'SOURCE_STORAGE_LIMIT') return NextResponse.json({ error: 'מכסת האחסון לפרופיל היא 40MB.' }, { status: 413 });
    return NextResponse.json({ error: 'לא הצלחנו לשמור את המסמך.' }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי למחוק מסמך.' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'מקור לא תקין.' }, { status: 400 });
  const ref = firestore().collection('users').doc(user.uid).collection('profileSources').doc(id);
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ ok: true });
    const objectName = snapshot.get('objectName');
    if (typeof objectName !== 'string' || !objectName.startsWith(`users/${user.uid}/profile-sources/${id}`)) return NextResponse.json({ error: 'המקור לא שייך לחשבון הזה.' }, { status: 403 });
    await userUploadsBucket().file(objectName).delete({ ignoreNotFound: true });
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו למחוק את המסמך.' }, { status: 503 });
  }
}
