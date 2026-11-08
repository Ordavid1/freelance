'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, type Auth } from '@firebase/auth';
import { getClientAuth } from '@/lib/auth/firebase-client';

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleSignInEnabled, setGoogleSignInEnabled] = useState(false);

  useEffect(() => { getClientAuth().then(({ googleSignInEnabled: enabled }) => setGoogleSignInEnabled(enabled)).catch(() => {}); }, []);

  async function establishSession(auth: Auth, authUser: Awaited<ReturnType<typeof signInWithEmailAndPassword>>['user']) {
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
    window.location.assign('/');
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const { auth, persistence } = await getClientAuth();
      await setPersistence(auth, persistence);
      if (mode === 'signup') {
        const created = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(created.user);
        await signOut(auth);
        setNotice('שלחנו קישור אימות לכתובת שלך. לאחר האימות אפשר להתחבר.');
      } else {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(auth);
          throw new Error('צריך לאמת את כתובת האימייל. שלחנו קישור אימות חדש.');
        }
        await establishSession(auth, credential.user);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'הפעולה נכשלה.');
    } finally { setBusy(false); }
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

  async function resetPassword() {
    setError(''); setNotice('');
    if (!email.trim()) { setError('הקלידו כתובת אימייל כדי לקבל קישור לאיפוס.'); return; }
    try {
      const { auth } = await getClientAuth();
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('אם קיימת כתובת מתאימה, נשלח אליה קישור לאיפוס סיסמה.');
    } catch {
      setNotice('אם קיימת כתובת מתאימה, נשלח אליה קישור לאיפוס סיסמה.');
    }
  }

  return <section className="signin-panel">
    <div className="signin-tabs"><button className={mode === 'signin' ? 'selected' : ''} onClick={() => setMode('signin')}>התחברות</button><button className={mode === 'signup' ? 'selected' : ''} onClick={() => setMode('signup')}>פתיחת חשבון</button></div>
    {googleSignInEnabled && <><button className="google-signin" type="button" disabled={busy} onClick={googleSignIn}><span aria-hidden="true">G</span> המשך עם Google</button><div className="signin-divider"><span>או עם אימייל</span></div></>}
    <form onSubmit={submit}>
      <label htmlFor="signin-email">כתובת אימייל</label><input id="signin-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <label htmlFor="signin-password">סיסמה</label><input id="signin-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
      {mode === 'signin' && <button className="reset-password" type="button" onClick={resetPassword}>שכחתי סיסמה</button>}
      <button className="button button-dark signin-submit" type="submit" disabled={busy}>{busy ? 'רק רגע…' : mode === 'signup' ? 'פתיחת חשבון' : 'התחברות'}</button>
    </form>
    {notice && <p className="signin-notice" role="status">{notice}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <p className="legal-inline-notice">השירות מיועד לבני ובנות 18 ומעלה. בפתיחת חשבון אתם מסכימים ל<Link href="/terms">תנאי השימוש</Link>. מידע על עיבוד נתונים וזכויותיכם מופיע ב<Link href="/privacy">מדיניות הפרטיות</Link>. האימות מנוהל דרך Google Identity Platform; אימות אימייל נדרש לפני שימוש בחשבון.</p>
  </section>;
}
