import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { listOpenProjects, toPublicProject } from '@/lib/db/projects';

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
    const items = await listOpenProjects();
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
  if (!body || typeof body.title !== 'string' || body.title.trim().length < 5 || body.title.length > 120 || typeof body.description !== 'string' || body.description.trim().length < 20 || body.description.length > 5000) {
    return NextResponse.json({ error: 'נדרשת כותרת ותיאור מלא של הפרויקט.' }, { status: 400 });
  }
  if (typeof body.category !== 'string' || typeof body.budget !== 'string' || body.budget.length > 100 || typeof body.deadline !== 'string' || body.deadline.length > 100 || !Array.isArray(body.skills) || body.skills.length > 20 || body.skills.some((skill) => typeof skill !== 'string' || skill.length > 60)) {
    return NextResponse.json({ error: 'פרטי הפרויקט לא תקינים.' }, { status: 400 });
  }
  const slug = randomUUID();
  const record = {
    title: body.title.trim(), category: body.category.trim().slice(0, 80), description: body.description.trim(),
    budget: body.budget.trim(), deadline: body.deadline.trim(), skills: [...new Set(body.skills.map((skill: string) => skill.trim()).filter(Boolean))],
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
