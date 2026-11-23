import 'server-only';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { adminAuth } from './firebase-admin';

// Sign-out denylist. A session cookie is a self-contained signed token, so clearing it in the browser does not stop a copy
// that was stolen earlier. Sign-out therefore records the cookie's SHA-256 (never the cookie) until its own expiry, and every
// session read rejects a denylisted cookie. `expiresAt` is a Firestore TTL field (infra/terraform/main.tf).
const COLLECTION = 'revokedSessions';
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 15_000;
const NEGATIVE_CACHE_MAX = 5_000;
const notRevoked = new Map<string, number>();

export function sessionDigest(cookie: string): string {
  return createHash('sha256').update(cookie).digest('hex');
}

/** True when the cookie was signed out. Fails closed: if the denylist cannot be read the session is not trusted. */
export async function isSessionRevoked(cookie: string): Promise<boolean> {
  const id = sessionDigest(cookie);
  const now = Date.now();
  const cached = notRevoked.get(id);
  if (cached !== undefined && cached > now) return false;
  try {
    const doc = await firestore().collection(COLLECTION).doc(id).get();
    if (doc.exists) return true;
  } catch {
    return true;
  }
  if (notRevoked.size >= NEGATIVE_CACHE_MAX) notRevoked.clear();
  notRevoked.set(id, now + NEGATIVE_CACHE_MS);
  return false;
}

/** Denylists the cookie until it would have expired anyway. Returns false when the record could not be written. */
export async function revokeSessionCookie(cookie: string): Promise<boolean> {
  let expiresAtMs = Date.now() + FIVE_DAYS_MS;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, false);
    if (typeof decoded.exp === 'number') expiresAtMs = decoded.exp * 1000;
  } catch {
    // Already expired or unverifiable: it cannot authenticate anyone, but keep a record for the maximum lifetime.
  }
  const id = sessionDigest(cookie);
  try {
    await firestore().collection(COLLECTION).doc(id).set({ createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(expiresAtMs) });
    notRevoked.delete(id);
    return true;
  } catch {
    return false;
  }
}
