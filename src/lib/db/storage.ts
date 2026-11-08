import 'server-only';
import { getStorage } from 'firebase-admin/storage';
import { adminApp } from '@/lib/auth/firebase-admin';

export function userUploadsBucket() {
  const name = process.env.UPLOADS_BUCKET;
  if (!name) throw new Error('UPLOADS_BUCKET is not configured.');
  return getStorage(adminApp()).bucket(name);
}
