import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';

export const runtime = 'nodejs';

const textFields = ['name', 'headline', 'bio', 'portfolio', 'experience', 'education'] as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בפרופיל.' }, { status: 401 });
  try {
    const snapshot = await firestore().collection('profiles').doc(user.uid).get();
    return NextResponse.json({ profile: snapshot.exists ? snapshot.data() : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון את הפרופיל כרגע.' }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לשמור פרופיל.' }, { status: 401 });
  if (Number(request.headers.get('content-length') || 0) > 30_000) return NextResponse.json({ error: 'הבקשה גדולה מדי.' }, { status: 413 });
  const body = await request.json().catch(() => null) as { profile?: unknown } | null;
  const profile = body?.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return NextResponse.json({ error: 'פרטי הפרופיל לא תקינים.' }, { status: 400 });
  const input = profile as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const key of textFields) {
    const value = input[key];
    if (value !== undefined && typeof value !== 'string') return NextResponse.json({ error: 'פרטי הפרופיל לא תקינים.' }, { status: 400 });
    if (typeof value === 'string') clean[key] = value.slice(0, key === 'bio' ? 1500 : key === 'portfolio' || key === 'experience' || key === 'education' ? 4000 : 200);
  }
  const skills = input.skills;
  if (!Array.isArray(skills) || skills.length > 50 || skills.some((skill) => typeof skill !== 'string' || skill.length > 60)) {
    return NextResponse.json({ error: 'רשימת הכישורים לא תקינה.' }, { status: 400 });
  }
  clean.skills = [...new Set(skills.map((skill: string) => skill.trim()).filter(Boolean))];
  try {
    await firestore().collection('profiles').doc(user.uid).set({ ...clean, ownerUid: user.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לשמור את הפרופיל.' }, { status: 503 });
  }
}
