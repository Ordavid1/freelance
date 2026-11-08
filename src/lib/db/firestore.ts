import 'server-only';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/auth/firebase-admin';

export function firestore() {
  return getFirestore(adminApp());
}
