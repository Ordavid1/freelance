import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { firestore } from '@/lib/db/firestore';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';

export const GET = route('savedProject.list', {}, async ({ user }) => {
  try {
    const snapshot = await firestore().collection('users').doc(user.uid).collection('savedProjects').limit(200).get();
    return NextResponse.json({ slugs: snapshot.docs.map((doc) => doc.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון פרויקטים שמורים כרגע.' }, { status: 503 });
  }
});

export const POST = route('savedProject.toggle', { body: { type: 'json', maxBytes: 4_096 } }, async ({ user, body: input }) => {
  const body = input as { projectSlug?: unknown; saved?: unknown } | null;
  if (typeof body?.projectSlug !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.projectSlug) || typeof body.saved !== 'boolean') return NextResponse.json({ error: 'פרטי השמירה לא תקינים.' }, { status: 400 });
  const db = firestore();
  const projectRef = db.collection('projects').doc(body.projectSlug);
  const savedRef = db.collection('users').doc(user.uid).collection('savedProjects').doc(body.projectSlug);
  try {
    await db.runTransaction(async (transaction) => {
      const project = await transaction.get(projectRef);
      if (body.saved && (!project.exists || project.get('status') !== 'open' || project.get('sample') === true)) throw new Error('PROJECT_UNAVAILABLE');
      if (body.saved) transaction.set(savedRef, { projectSlug: body.projectSlug, ownerUid: user.uid, createdAt: FieldValue.serverTimestamp() });
      else transaction.delete(savedRef);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_UNAVAILABLE') return NextResponse.json({ error: 'הפרויקט כבר אינו זמין.' }, { status: 404 });
    return NextResponse.json({ error: 'לא הצלחנו לעדכן פרויקטים שמורים.' }, { status: 503 });
  }
});
