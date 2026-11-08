import 'server-only';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export function adminApp() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required for authentication.');
  return getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId });
}

export function adminAuth() {
  return getAuth(adminApp());
}
