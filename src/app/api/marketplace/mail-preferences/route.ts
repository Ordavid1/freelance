import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { adminAuth } from '@/lib/auth/firebase-admin';
import { firestore } from '@/lib/db/firestore';
import { readJsonBody } from '@/lib/security/request-body';
import { defaultPreferences, eligibleProfile, parsePreferences, profileTags } from '@/lib/notifications/preferences';
import { notificationConfig } from '@/lib/notifications/config';
export const runtime = 'nodejs';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'יש להתחבר.' }, 401);
  try {
    const db = firestore();
    const [profile, saved] = await Promise.all([db.collection('profiles').doc(user.uid).get(), db.collection('projectMailPreferences').doc(user.uid).get()]);
    if (!eligibleProfile(profile.data())) return json({ eligible: false });
    return json({ eligible: true, available: !!notificationConfig(), profileTags: profileTags(profile.data()!), preferences: parsePreferences(saved.data()) || defaultPreferences(profile.data()!) });
  } catch { return json({ error: 'לא ניתן לטעון את העדפות המייל.' }, 503); }
}
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return json({ error: 'הבקשה נדחתה.' }, 403);
  const user = await getCurrentUser();
  if (!user) return json({ error: 'יש להתחבר.' }, 401);
  const body = await readJsonBody(request, 8000);
  if (!body.ok) return body.response;
  const prefs = parsePreferences(body.value);
  if (!prefs) return json({ error: 'העדפות לא תקינות.' }, 400);
  if (prefs.enabled && !notificationConfig()) return json({ error: 'שליחת עדכונים במייל אינה זמינה כרגע.' }, 503);
  try {
    const identity = await adminAuth().getUser(user.uid);
    if (prefs.enabled && (!identity.emailVerified || !identity.email || identity.disabled)) return json({ error: 'נדרשת כתובת מייל מאומתת בחשבון.' }, 403);
    const db = firestore(), ref = db.collection('projectMailPreferences').doc(user.uid);
    const ok = await db.runTransaction(async tx => {
      const [profile, saved] = await Promise.all([tx.get(db.collection('profiles').doc(user.uid)), tx.get(ref)]);
      if (!eligibleProfile(profile.data())) return false;
      if (JSON.stringify(parsePreferences(saved.data())) === JSON.stringify(prefs)) return true;
      // Every settings change starts a new window. Never mail historical projects or resurrect pending old consent.
      tx.set(ref, { ...prefs, revision: randomBytes(16).toString('hex'), cursor: Timestamp.now(), cursorId: '', pending: null, reviewRequired: false, lastDaily: null, unsubscribeToken: saved.get('unsubscribeToken') || randomBytes(32).toString('hex'), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    return ok ? json({ ok: true, preferences: prefs }) : json({ error: 'יש להשלים קודם פרופיל פרילנסר.' }, 403);
  } catch { return json({ error: 'לא ניתן לשמור את העדפות המייל.' }, 503); }
}
