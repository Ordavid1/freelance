import { readJsonBody } from '@/lib/security/request-body';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';

import { getMembershipAccess } from '@/lib/membership/access';
import { shouldStartFreelancerTrial, TRIAL_MS } from '@/lib/membership/state';

export const runtime = 'nodejs';

const textFields = ['name', 'headline', 'bio', 'portfolio', 'experience', 'education', 'website', 'phone', 'email', 'logo'] as const;

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
  const parsedBody = await readJsonBody(request, 2_100_000);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value as { profile?: unknown } | null;
  const profile = body?.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return NextResponse.json({ error: 'פרטי הפרופיל לא תקינים.' }, { status: 400 });
  const input = profile as Record<string, unknown>;
  if (input.profileType !== undefined && input.profileType !== 'freelancer' && input.profileType !== 'publisher') return NextResponse.json({ error: 'סוג הפרופיל לא תקין.' }, { status: 400 });
  const clean: Record<string, unknown> = { profileType: input.profileType || 'freelancer' };
  for (const key of textFields) {
    const value = input[key];
    if (value !== undefined && typeof value !== 'string') return NextResponse.json({ error: 'פרטי הפרופיל לא תקינים.' }, { status: 400 });
    if (typeof value === 'string') clean[key] = value.slice(0, key === 'bio' ? 1500 : key === 'portfolio' || key === 'experience' || key === 'education' ? 4000 : key === 'logo' ? 2_000_000 : 200);
  }
  const skills = input.skills ?? [];
  if (!Array.isArray(skills) || skills.length > 50 || skills.some((skill) => typeof skill !== 'string' || skill.length > 60)) {
    return NextResponse.json({ error: 'רשימת הכישורים לא תקינה.' }, { status: 400 });
  }
  if (input.skills !== undefined) clean.skills = [...new Set(skills.map((skill: string) => skill.trim()).filter(Boolean))];
  try {
    await getMembershipAccess(user.uid);
    const db = firestore();
    await db.runTransaction(async transaction => {
      const profileRef = db.collection('profiles').doc(user.uid);
      const membershipRef = db.collection('memberships').doc(user.uid);
      const [saved, membership] = await Promise.all([transaction.get(profileRef), transaction.get(membershipRef)]);
      const merged = { ...saved.data(), ...clean };
      transaction.set(profileRef, { ...clean, ownerUid: user.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (shouldStartFreelancerTrial(merged, membership.data() || {}, saved.data() || {})) {
        const now = Timestamp.now();
        transaction.update(membershipRef, { state: 'trial', freelancerTrialStarted: true, trialStartedAt: now, trialEndsAt: Timestamp.fromMillis(now.toMillis() + TRIAL_MS) });
      } else if (saved.data()?.profileType !== 'publisher' && membership.get('state') === 'trial') {
        transaction.update(membershipRef, { freelancerTrialStarted: true });
      }
    });
    return NextResponse.json({ ok: true, access: await getMembershipAccess(user.uid) });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לשמור את הפרופיל.' }, { status: 503 });
  }
}
