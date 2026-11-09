'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { GoogleAuthProvider, setPersistence, signInWithPopup, signOut, type Auth } from '@firebase/auth';
import { getClientAuth } from '@/lib/auth/firebase-client';

export function SignInForm() {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleSignInEnabled, setGoogleSignInEnabled] = useState(false);

  useEffect(() => { getClientAuth().then(({ googleSignInEnabled: enabled }) => setGoogleSignInEnabled(enabled)).catch(() => {}); }, []);

  async function establishSession(auth: Auth, authUser: Awaited<ReturnType<typeof signInWithPopup>>['user']) {
    const csrfResponse = await fetch('/api/auth/csrf', { cache: 'no-store' });
    if (!csrfResponse.ok) throw new Error('לא ניתן להתחיל התחברות מאובטחת.');
    const { csrfToken } = await csrfResponse.json();
    const idToken = await authUser.getIdToken(true);
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, csrfToken }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'ההתחברות נכשלה.');
    }
    await signOut(auth);
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.assign(next === '/profile/import' ? next : '/');
  }

  async function googleSignIn() {
    setBusy(true); setError(''); setNotice('');
    try {
      const { auth, persistence } = await getClientAuth();
      await setPersistence(auth, persistence);
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      await establishSession(auth, credential.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ההתחברות עם Google נכשלה.');
    } finally { setBusy(false); }
  }

  return <section className="signin-panel">
    <button className="google-signin" type="button" disabled={busy || !googleSignInEnabled} onClick={googleSignIn}><span aria-hidden="true">G</span> המשך עם Google</button>
    {!googleSignInEnabled && <p className="error-text" role="status">התחברות Google עדיין לא זמינה. יש לבדוק את הגדרות Google Identity Platform.</p>}
    {notice && <p className="signin-notice" role="status">{notice}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <p className="legal-inline-notice">השירות מיועד לבני ובנות 18 ומעלה. בפתיחת חשבון אתם מסכימים ל<Link href="/terms">תנאי השימוש</Link>. מידע על עיבוד נתונים וזכויותיכם מופיע ב<Link href="/privacy">מדיניות הפרטיות</Link>. הכניסה והשימוש בחשבון מתבצעים באמצעות חשבון Google בלבד.</p>
  </section>;
}
