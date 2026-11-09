import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { toPublicProject } from '@/lib/db/projects';
import { isListableProject } from '@/lib/seo/publication';
import { validateProjectInput } from '@/lib/projects/validation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('mine') === '1') {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בפרויקטים שלך.' }, { status: 401 });
      const snapshot = await firestore().collection('projects').where('ownerUid', '==', user.uid).limit(100).get();
      const items = snapshot.docs.map((doc) => toPublicProject(doc.id, doc.data())).sort((a, b) => a.title.localeCompare(b.title));
      return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const snapshot = await firestore().collection('projects').where('status', 'in', ['open', 'closed']).limit(100).get();
    const items = snapshot.docs.filter(doc => isListableProject(doc.data())).map(doc => toPublicProject(doc.id, doc.data())).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון פרויקטים כרגע.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לפרסם פרויקט.' }, { status: 401 });
  if (Number(request.headers.get('content-length') || 0) > 24_000) return NextResponse.json({ error: 'הבקשה גדולה מדי.' }, { status: 413 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const input = validateProjectInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const { title, category, description, budget, deadline, skills } = input.value;
  const slug = randomUUID();
  // Built field by field: client input can never set sample/seed/status markers.
  const record = {
    title, category, description, budget, deadline, skills,
    ownerUid: user.uid, clientName: user.name || user.email?.split('@')[0] || 'לקוח/ה', status: 'open', proposals: 0,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
  try {
    await firestore().collection('projects').doc(slug).create(record);
    return NextResponse.json({ project: toPublicProject(slug, record), ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לפרסם את הפרויקט.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לסגור פרויקט.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { slug?: unknown; status?: unknown } | null;
  if (typeof body?.slug !== 'string' || body.slug.length > 80 || body.status !== 'closed') return NextResponse.json({ error: 'פרטי סגירת הפרויקט לא תקינים.' }, { status: 400 });
  try {
    const ref = firestore().collection('projects').doc(body.slug);
    const result = await firestore().runTransaction(async transaction => {
      const project = await transaction.get(ref);
      if (!project.exists || project.get('ownerUid') !== user.uid) return 'NOT_FOUND';
      if (project.get('status') === 'closed') return 'CLOSED';
      if (project.get('status') !== 'open') return 'UNAVAILABLE';
      transaction.update(ref, { status: 'closed', updatedAt: FieldValue.serverTimestamp() });
      return 'CLOSED';
    });
    if (result === 'NOT_FOUND') return NextResponse.json({ error: 'הפרויקט לא נמצא.' }, { status: 404 });
    if (result === 'UNAVAILABLE') return NextResponse.json({ error: 'אי אפשר לסגור את הפרויקט במצבו הנוכחי.' }, { status: 409 });
    return NextResponse.json({ ok: true, status: 'closed' });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לסגור את הפרויקט.' }, { status: 503 });
  }
}
