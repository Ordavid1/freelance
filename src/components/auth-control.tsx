'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type User = { uid: string; email: string | null; name: string | null; picture: string | null };

export function AuthControl() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { user: null })
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  async function signOut() {
    await fetch('/api/auth/session', { method: 'DELETE' });
    setUser(null);
    window.location.assign('/');
  }

  if (!ready) return <span className="auth-control" aria-live="polite">בודקים התחברות…</span>;
  if (!user) return <Link className="auth-control auth-signin" href="/signin">התחברות</Link>;
  return <div className="auth-control"><span>{user.name || user.email || 'החשבון שלי'}</span><button onClick={signOut}>יציאה</button></div>;
}
