import 'server-only';

const ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i;
export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && ADDRESS.test(value);
}
export function mailbox(value: string) {
  const match = value.trim().match(/^(?:[^<>\r\n]+<)?([^<>\s]+@[^<>\s]+)>?$/);
  return match && validEmail(match[1]) ? match[1].toLowerCase() : null;
}
export function supportContactEmail() {
  const email = process.env.SUPPORT_INBOX_EMAIL?.trim();
  return validEmail(email) ? email : 'customer@freelance-place.com';
}
export type SupportConfig = { apiKey: string; webhookSecret: string; from: string; inbox: string; replyDomain: string; allowedSenders: string[] };
export function supportConfig(): SupportConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const from = process.env.SUPPORT_FROM_EMAIL?.trim();
  const replyDomain = process.env.SUPPORT_REPLY_DOMAIN?.trim().toLowerCase();
  const inbox = supportContactEmail().toLowerCase();
  if (process.env.SUPPORT_INBOX_EMAIL?.trim() && !validEmail(process.env.SUPPORT_INBOX_EMAIL.trim())) return null;
  const extraSenders = (process.env.SUPPORT_ALLOWED_REPLY_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!apiKey || !webhookSecret || !from || !mailbox(from) || !replyDomain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(replyDomain) || extraSenders.some((email) => !validEmail(email))) return null;
  return { apiKey, webhookSecret, from, inbox, replyDomain, allowedSenders: [...new Set([inbox, ...extraSenders])] };
}
