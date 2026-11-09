'use client';

import { useEffect, useState } from 'react';
import { GoogleAuthProvider, setPersistence, signInWithPopup, signOut as clearFirebaseAuth, type Auth } from '@firebase/auth';
import { getClientAuth } from '@/lib/auth/firebase-client';

type User = { uid: string; email: string | null; name: string | null; picture: string | null };

export function AuthControl() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authClient, setAuthClient] = useState<Awaited<ReturnType<typeof getClientAuth>> | null>(null);
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { user: null })
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
    getClientAuth()
      .then(async (client) => {
        await setPersistence(client.auth, client.persistence);
        setAuthClient(client);
      })
      .catch(() => setError('לא ניתן לטעון את אפשרויות ההתחברות.'));
  }, []);

  async function signOut() {
    await fetch('/api/auth/session', { method: 'DELETE' });
    setUser(null);
    window.location.assign('/');
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError('');
    let auth: Auth | undefined;
    try {
      const client = authClient;
      if (!client) throw new Error('אפשרות ההתחברות עדיין נטענת. נסו שוב בעוד רגע.');
      auth = client.auth;
      if (!client.googleSignInEnabled) throw new Error('התחברות עם Google אינה זמינה כרגע.');
      const popup = signInWithPopup(auth, new GoogleAuthProvider());
      setBusy(true);
      const credential = await popup;
      const csrfResponse = await fetch('/api/auth/csrf', { cache: 'no-store' });
      if (!csrfResponse.ok) throw new Error('לא ניתן להתחיל התחברות מאובטחת.');
      const { csrfToken } = await csrfResponse.json();
      const sessionResponse = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: await credential.user.getIdToken(true), csrfToken }),
      });
      if (!sessionResponse.ok) {
        const data = await sessionResponse.json().catch(() => ({}));
        throw new Error(data.error || 'ההתחברות נכשלה.');
      }
      await clearFirebaseAuth(auth);
      window.location.reload();
    } catch (cause) {
      if (auth) await clearFirebaseAuth(auth).catch(() => {});
      setError(cause instanceof Error ? cause.message : 'ההתחברות עם Google נכשלה.');
      setBusy(false);
    }
  }

  if (!ready) return <span className="auth-control" aria-live="polite">בודקים התחברות…</span>;
  if (!user) return <div className="auth-entry">
    <button className="auth-control auth-signin" type="button" onClick={signInWithGoogle} disabled={busy || !authClient} aria-label="התחברות עם Google">
      <GoogleMark />
      <span>{busy ? 'מתחברים…' : 'התחברות'}</span>
    </button>
    {error && <span className="auth-signin-error" role="alert">{error}</span>}
  </div>;
  return <div className="auth-control"><span>{user.name || user.email || 'החשבון שלי'}</span><button onClick={signOut}>יציאה</button></div>;
}

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
    <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
    <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
    <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.9 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z" />
  </svg>;
}
