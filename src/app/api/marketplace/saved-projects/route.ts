import { requireMarketplaceAccess } from '@/lib/membership/access';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בפרויקטים השמורים.' }, { status: 401 });
  const denied = await requireMarketplaceAccess(user.uid); if (denied) return denied;
  try {
    const snapshot = await firestore().collection('users').doc(user.uid).collection('savedProjects').limit(200).get();
    return NextResponse.json({ slugs: snapshot.docs.map((doc) => doc.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון פרויקטים שמורים כרגע.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לשמור פרויקט.' }, { status: 401 });
  const denied = await requireMarketplaceAccess(user.uid); if (denied) return denied;
  const body = await request.json().catch(() => null) as { projectSlug?: unknown; saved?: unknown } | null;
  if (typeof body?.projectSlug !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.projectSlug) || typeof body.saved !== 'boolean') return NextResponse.json({ error: 'פרטי השמירה לא תקינים.' }, { status: 400 });
  const db = firestore();
  const projectRef = db.collection('projects').doc(body.projectSlug);
  const savedRef = db.collection('users').doc(user.uid).collection('savedProjects').doc(body.projectSlug);
  try {
    await db.runTransaction(async (transaction) => {
      const project = await transaction.get(projectRef);
      if (body.saved && (!project.exists || project.get('status') !== 'open')) throw new Error('PROJECT_UNAVAILABLE');
      if (body.saved) transaction.set(savedRef, { projectSlug: body.projectSlug, ownerUid: user.uid, createdAt: FieldValue.serverTimestamp() });
      else transaction.delete(savedRef);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_UNAVAILABLE') return NextResponse.json({ error: 'הפרויקט כבר אינו זמין.' }, { status: 404 });
    return NextResponse.json({ error: 'לא הצלחנו לעדכן פרויקטים שמורים.' }, { status: 503 });
  }
}
