'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useViewer } from './viewer-context';
import { SupportHeaderActions } from './support-chat';

// Firebase Auth (SDK, gapi and the auth iframe) is only needed when someone signs in, so it
// loads on sign-in intent (pointer, focus or touch on the button), on the visitor's first sign of
// life anywhere on the page, or after an idle fallback. Crawlers and lab runs never interact, so
// none of this weighs on the first load.
const AUTH_IDLE_FALLBACK_MS = 5000;
const AUTH_WARMUP_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

async function loadFirebaseAuth() {
  const [sdk, { getClientAuth }] = await Promise.all([import('@firebase/auth'), import('@/lib/auth/firebase-client')]);
  const client = await getClientAuth();
  await sdk.setPersistence(client.auth, client.persistence);
  return { ...client, sdk };
}
type FirebaseAuthClient = Awaited<ReturnType<typeof loadFirebaseAuth>>;

export function AuthControl() {
  return <SupportHeaderActions><AuthControlContent /></SupportHeaderActions>;
}

function AuthControlContent() {
  const viewer = useViewer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authClient, setAuthClient] = useState<FirebaseAuthClient | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const loadFailed = useRef(false);
  const prepareSignIn = useCallback(() => {
    if (loading.current) return loading.current;
    loading.current = loadFirebaseAuth()
      .then((client) => { loadFailed.current = false; setAuthClient(client); })
      // A failed background load stays silent; it is reported (and retried) when the person clicks.
      .catch(() => { loading.current = null; loadFailed.current = true; });
    return loading.current;
  }, []);
  const anonymous = viewer.status === 'anonymous';
  useEffect(() => {
    if (!anonymous) return;
    // The first pointer, key, touch or wheel event anywhere starts the download, so by the time the
    // button is tapped the client is normally ready and the first tap signs in.
    const stopWarmup = () => AUTH_WARMUP_EVENTS.forEach((name) => window.removeEventListener(name, onFirstInteraction, true));
    function onFirstInteraction() { stopWarmup(); void prepareSignIn(); }
    AUTH_WARMUP_EVENTS.forEach((name) => window.addEventListener(name, onFirstInteraction, { capture: true, passive: true }));
    const timer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => void prepareSignIn(), { timeout: 2000 });
      else void prepareSignIn();
    }, AUTH_IDLE_FALLBACK_MS);
    return () => { stopWarmup(); window.clearTimeout(timer); };
  }, [anonymous, prepareSignIn]);

  async function signOut() {
    await fetch('/api/auth/session', { method: 'DELETE' });
    window.location.assign('/');
  }

  function signInWithGoogle() {
    setError('');
    if (!authClient) {
      setError(loadFailed.current ? 'לא ניתן לטעון את אפשרויות ההתחברות.' : 'אפשרות ההתחברות עדיין נטענת. נסו שוב בעוד רגע.');
      void prepareSignIn();
      return;
    }
    // The popup must open synchronously inside the click handler or browsers block it.
    const { auth, sdk } = authClient;
    if (!authClient.googleSignInEnabled) { setError('התחברות עם Google אינה זמינה כרגע.'); return; }
    let popup: ReturnType<typeof sdk.signInWithPopup>;
    try { popup = sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ההתחברות עם Google נכשלה.'); return; }
    setBusy(true);
    void (async () => {
      try {
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
        await sdk.signOut(auth);
        window.location.reload();
      } catch (cause) {
        await sdk.signOut(auth).catch(() => {});
        setError(cause instanceof Error ? cause.message : 'ההתחברות עם Google נכשלה.');
        setBusy(false);
      }
    })();
  }

  // While the viewer is unknown the sign-in button is rendered invisibly so the header keeps its size.
  if (viewer.status === 'loading') return <div className="auth-entry auth-pending" aria-hidden="true">
    <button className="auth-control auth-signin" type="button" tabIndex={-1} disabled><GoogleMark /><span>התחברות</span></button>
  </div>;
  if (!viewer.user) return <div className="auth-entry" onPointerEnter={prepareSignIn} onFocus={prepareSignIn} onTouchStart={prepareSignIn} onPointerDown={prepareSignIn}>
    <button className="auth-control auth-signin" type="button" onClick={signInWithGoogle} disabled={busy} aria-label="התחברות עם Google">
      <GoogleMark />
      <span>{busy ? 'מתחברים…' : 'התחברות'}</span>
    </button>
    {error && <span className="auth-signin-error" role="alert">{error}</span>}
  </div>;
  return <div className="auth-control"><span>{viewer.user.name || viewer.user.email || 'החשבון שלי'}</span><button onClick={signOut}>יציאה</button></div>;
}

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
    <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
    <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
    <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.9 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z" />
  </svg>;
}
