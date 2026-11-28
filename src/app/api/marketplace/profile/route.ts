import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { firestore } from '@/lib/db/firestore';

import { getMembershipAccess } from '@/lib/membership/access';
import { profileIsComplete, shouldStartFreelancerTrial, TRIAL_MS } from '@/lib/membership/state';
import { route } from '@/lib/security/policy';
import { isValidProfileImage } from '@/lib/profile/image-validation';
import { parseHttpsUrl } from '@/lib/security/url';

export const runtime = 'nodejs';

const textFields = ['name', 'headline', 'bio', 'portfolio', 'experience', 'education', 'website', 'phone', 'email', 'logo', 'avatar'] as const;

async function isUnchangedImage(uid: string, key: 'logo' | 'avatar', value: string) {
  try {
    const saved = await firestore().collection('profiles').doc(uid).get();
    return saved.get(key) === value;
  } catch {
    return false;
  }
}

export const GET = route('profile.read', {}, async ({ user }) => {
  try {
    const snapshot = await firestore().collection('profiles').doc(user.uid).get();
    return NextResponse.json({ profile: snapshot.exists ? snapshot.data() : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון את הפרופיל כרגע.' }, { status: 503 });
  }
});

// The browser sends at most two WebP images of 300 KB (about 400 KB each as base64) plus a few KB of text.
export const PUT = route('profile.update', { body: { type: 'json', maxBytes: 1_000_000 } }, async ({ user, body: payload }) => {
  const body = payload as { profile?: unknown } | null;
  const profile = body?.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return NextResponse.json({ error: 'פרטי הפרופיל לא תקינים.' }, { status: 400 });
  const input = profile as Record<string, unknown>;
  if (input.profileType !== undefined && input.profileType !== 'freelancer' && input.profileType !== 'publisher') return NextResponse.json({ error: 'סוג הפרופיל לא תקין.' }, { status: 400 });
  // Accept legacy clients, but never store an exclusive account role.
  const clean: Record<string, unknown> = {};
  for (const key of textFields) {
    const value = input[key];
    if (value !== undefined && typeof value !== 'string') return NextResponse.json({ error: 'פרטי הפרופיל לא תקינים.' }, { status: 400 });
    if (typeof value !== 'string') continue;
    if (key === 'logo' || key === 'avatar') {
      // A stored image from before this check is resent unchanged on every save; it is allowed only if it matches what is saved.
      if (value !== '' && !isValidProfileImage(value) && !(await isUnchangedImage(user.uid, key, value))) return NextResponse.json({ error: 'התמונה אינה תקינה. אפשר להעלות PNG, JPG או WebP עד 1.5MB.' }, { status: 400 });
      clean[key] = value;
    } else if (key === 'website') {
      const website = value.trim();
      if (website !== '' && !parseHttpsUrl(website, 200, { allowHttp: true })) return NextResponse.json({ error: 'כתובת האתר חייבת להיות קישור תקין שמתחיל ב־https:// או http://.' }, { status: 400 });
      clean[key] = website;
    } else {
      clean[key] = value.slice(0, key === 'bio' ? 1500 : key === 'portfolio' || key === 'experience' || key === 'education' ? 4000 : 200);
    }
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
      transaction.set(profileRef, { ...clean, profileType: FieldValue.delete(), ownerUid: user.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (shouldStartFreelancerTrial(merged, membership.data() || {}, saved.data() || {})) {
        const now = Timestamp.now();
        transaction.update(membershipRef, { state: 'trial', freelancerTrialStarted: true, trialStartedAt: now, trialEndsAt: Timestamp.fromMillis(now.toMillis() + TRIAL_MS) });
      } else if (membership.get('state') === 'trial' && profileIsComplete(merged)) {
        transaction.update(membershipRef, { freelancerTrialStarted: true });
      }
    });
    return NextResponse.json({ ok: true, access: await getMembershipAccess(user.uid) });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לשמור את הפרופיל.' }, { status: 503 });
  }
});
