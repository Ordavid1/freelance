'use client';

import { getApp, getApps, initializeApp } from '@firebase/app';
import { getAuth, inMemoryPersistence } from '@firebase/auth';

export async function getClientAuth() {
  const response = await fetch('/api/config/firebase', { cache: 'no-store' });
  if (!response.ok) throw new Error('Authentication is not configured yet.');
  const publicConfig = await response.json();
  const app = getApps().length ? getApp() : initializeApp(publicConfig);
  const auth = getAuth(app);
  return { auth, persistence: inMemoryPersistence, googleSignInEnabled: true };
}
