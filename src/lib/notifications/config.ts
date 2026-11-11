import 'server-only';
import { mailbox } from '@/lib/support/config';
export function notificationConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.PROJECT_NOTIFICATIONS_FROM_EMAIL || process.env.SUPPORT_FROM_EMAIL)?.trim();
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://freelance-place.com';
  if (process.env.PROJECT_NOTIFICATIONS_ENABLED !== 'true' || !apiKey || !from || !mailbox(from)) return null;
  const origin = new URL(site).origin;
  if (!origin.startsWith('https://') && process.env.NODE_ENV === 'production') return null;
  return { apiKey, from, origin };
}
