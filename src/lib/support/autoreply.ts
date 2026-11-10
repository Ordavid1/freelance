import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { firestore } from '@/lib/db/firestore';
import { mailbox, type SupportConfig } from '@/lib/support/config';
import { SupportError } from '@/lib/support/http';
import { digest, fetchReceivedEmail, receiveSupportReply, replyRoute, type ReceivedEmail } from '@/lib/support/service';

/**
 * Instant acknowledgment for every human email that reaches the support inbox.
 *
 * Safety model (an auto-responder is a mail-loop and backscatter risk):
 * - the webhook signature is verified before this module runs;
 * - the same provider email id (and RFC Message-ID) is acknowledged at most once;
 * - machines are never answered: our own addresses, no-reply/daemon senders, bulk/list/auto-generated
 *   mail (RFC 3834 and common vendor headers), bounces/reports, and mail failing sender authentication;
 * - each sender has a rolling 24h cap and the whole site has an hourly cap;
 * - the reply is itself marked `Auto-Submitted: auto-replied`, so other responders skip it.
 */
export const AUTOREPLY_PER_SENDER_PER_DAY = 3;
export const AUTOREPLY_PER_HOUR = 200;
const DAY_MS = 86_400_000;
const CLAIM_STALE_MS = 5 * 60_000;

export type AutoReplyLanguage = 'he' | 'en';
export type AutoReplyDecision = { reply: true; to: string } | { reply: false; reason: string };

const MACHINE_LOCALPART = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?(?:[-_.+].*)?|abuse|auto(?:mated|[-_.]?reply|[-_.]?responder)?|notifications?|alerts?|daemon|system|root)$/i;
const AUTO_SUBJECT = /^\s*(?:auto(?:matic)?[\s-]*(?:reply|response)|autoreply|automatische antwort|undeliver(?:able|ed)|delivery (?:status|failure|has failed)|mail delivery|returned mail|failure notice|out of (?:the )?office|תשובה אוטומטית|תגובה אוטומטית|מחוץ למשרד|לא ניתן למסור)/i;

function header(headers: Record<string, string> | null, name: string) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : String(headers[key]);
}

/** Pure eligibility check; contains no I/O so every rule can be unit-tested. */
export function autoReplyDecision(config: SupportConfig, email: Pick<ReceivedEmail, 'from' | 'to' | 'cc' | 'received_for' | 'subject' | 'headers'>): AutoReplyDecision {
  const inbox = config.inbox.toLowerCase();
  const recipients = [...(email.received_for || []), ...(email.to || []), ...(email.cc || [])].map((value) => mailbox(value));
  if (!recipients.includes(inbox)) return { reply: false, reason: 'not-for-support-inbox' };
  const sender = mailbox(email.from || '');
  if (!sender) return { reply: false, reason: 'invalid-sender' };
  const own = new Set([inbox, mailbox(config.from), ...config.allowedSenders]);
  const [local, domain] = sender.split('@');
  if (own.has(sender) || domain === inbox.split('@')[1] || domain === config.replyDomain) return { reply: false, reason: 'own-address' };
  if (MACHINE_LOCALPART.test(local)) return { reply: false, reason: 'machine-sender' };
  const headers = email.headers;
  const autoSubmitted = header(headers, 'auto-submitted');
  if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no') return { reply: false, reason: 'auto-submitted' };
  if (/auto[_-]?reply|bulk|list|junk/i.test(header(headers, 'precedence') || '')) return { reply: false, reason: 'precedence' };
  for (const name of ['x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'list-id', 'list-unsubscribe', 'list-post', 'x-failed-recipients', 'x-mailer-daemon']) {
    const value = header(headers, name);
    if (value !== undefined && !(name === 'x-auto-response-suppress' && /^\s*none\s*$/i.test(value))) return { reply: false, reason: name };
  }
  if (/multipart\/report|delivery-status/i.test(header(headers, 'content-type') || '')) return { reply: false, reason: 'report' };
  if (/^\s*<?\s*>?\s*$/.test(header(headers, 'return-path') ?? 'x')) return { reply: false, reason: 'null-return-path' };
  if (/(?:spf|dkim|dmarc)=(?:fail|softfail|permerror)/i.test(header(headers, 'authentication-results') || '')) return { reply: false, reason: 'failed-authentication' };
  if (AUTO_SUBJECT.test(email.subject || '')) return { reply: false, reason: 'auto-subject' };
  return { reply: true, to: sender };
}

/** Script-based detection: Hebrew when at least a fifth of the letters are Hebrew, otherwise English. */
export function detectLanguage(...samples: Array<string | null | undefined>): AutoReplyLanguage {
  const text = samples.filter(Boolean).join(' ').slice(0, 4000);
  const hebrew = (text.match(/[֐-׿]/g) || []).length;
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters > 0 && hebrew / letters >= 0.2 ? 'he' : 'en';
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function firstName(from: string) {
  const name = from.match(/^\s*"?([^"<>@\r\n]{1,60}?)"?\s*</)?.[1]?.trim().split(/\s+/)[0];
  return name && /^[\p{L}][\p{L}'’-]{0,29}$/u.test(name) ? name : null;
}
const COPY = {
  he: {
    dir: 'rtl' as const,
    greeting: (name: string | null) => (name ? `היי ${name}!` : 'היי!'),
    lines: ['קיבלנו את ההודעה שלך, ואנחנו כבר על זה! 🎉', 'מישהו מהצוות שלנו יחזור אליך עם תשובה אישית בתוך דקות ספורות.', 'בינתיים, אפשר להמשיך לגלוש ב-Freelance Place ולגלות פרויקטים ופרילנסרים חדשים.'],
    signoff: 'מחכים לדבר איתך,\nצוות Freelance Place',
    note: 'זו הודעה אוטומטית. אפשר פשוט להשיב למייל הזה ונמשיך את השיחה.',
  },
  en: {
    dir: 'ltr' as const,
    greeting: (name: string | null) => (name ? `Hi ${name}!` : 'Hi there!'),
    lines: ['Thanks for reaching out — your message just landed with us and we are on it! 🎉', 'A real person from our team will get back to you with a personal answer within a few minutes.', 'Meanwhile, feel free to keep exploring Freelance Place for new projects and freelancers.'],
    signoff: 'Talk soon,\nThe Freelance Place team',
    note: 'This is an automatic acknowledgment. Just reply to this email and we will continue the conversation.',
  },
};

export function buildAutoReply(language: AutoReplyLanguage, from: string, subject: string) {
  const copy = COPY[language];
  const greeting = copy.greeting(firstName(from));
  const clean = subject.replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, 200);
  const text = [greeting, '', ...copy.lines.flatMap((line) => [line, '']), copy.signoff, '', '--', copy.note].join('\n');
  const paragraphs = copy.lines.map((line) => `<p style="margin:0 0 14px">${escapeHtml(line)}</p>`).join('');
  const html = `<!doctype html><html dir="${copy.dir}" lang="${language}"><body style="margin:0;padding:24px;background:#f6f7fb"><div dir="${copy.dir}" style="max-width:560px;margin:0 auto;padding:28px;background:#fff;border-radius:14px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#1d2433;text-align:${language === 'he' ? 'right' : 'left'}"><h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(greeting)}</h1>${paragraphs}<p style="margin:18px 0 0;white-space:pre-line">${escapeHtml(copy.signoff)}</p><hr style="border:0;border-top:1px solid #e5e8f0;margin:22px 0 12px"><p style="margin:0;font-size:13px;color:#6b7385">${escapeHtml(copy.note)}</p></div></body></html>`;
  return { subject: /^(?:re|השב|תשובה):/i.test(clean) ? clean : `Re: ${clean || (language === 'he' ? 'ההודעה שלך' : 'your message')}`, text, html };
}

type Claim = { ok: true } | { ok: false; reason: string };
/** Atomically dedupes by email id and Message-ID and spends the sender/site budgets. */
async function claim(emailId: string, messageId: string, sender: string): Promise<Claim> {
  const db = firestore();
  const emailRef = db.collection('supportAutoReplies').doc(emailId);
  const messageRef = db.collection('supportAutoReplies').doc(`m-${digest(messageId || emailId)}`);
  const senderRef = db.collection('supportAutoReplyLimits').doc(digest(sender));
  const budgetRef = db.collection('supportRateLimits').doc('autoreply-hour');
  return db.runTransaction(async (tx) => {
    const [byEmail, byMessage, bySender, budget] = await Promise.all([tx.get(emailRef), tx.get(messageRef), tx.get(senderRef), tx.get(budgetRef)]);
    const now = Date.now();
    for (const existing of [byEmail, byMessage]) {
      const data = existing.data();
      if (!existing.exists) continue;
      if (data?.state === 'sent') return { ok: false, reason: 'duplicate' } as Claim;
      // Another delivery may be sending right now, or may have died mid-send: answer retryably, never "done".
      if (now - (data?.at ?? 0) < CLAIM_STALE_MS) return { ok: false, reason: 'in-progress' } as Claim;
    }
    const sends = ((bySender.data()?.sends as number[] | undefined) || []).filter((at) => now - at < DAY_MS);
    if (sends.length >= AUTOREPLY_PER_SENDER_PER_DAY) return { ok: false, reason: 'sender-rate-limit' } as Claim;
    const hour = Math.floor(now / 3_600_000);
    const used = budget.data()?.window === hour ? (budget.data()?.count as number) : 0;
    if (used >= AUTOREPLY_PER_HOUR) return { ok: false, reason: 'site-rate-limit' } as Claim;
    const entry = { state: 'sending', at: now, hour, createdAt: Timestamp.fromMillis(now) };
    tx.set(emailRef, entry);
    tx.set(messageRef, entry);
    tx.set(senderRef, { sends: [...sends, now], updatedAt: Timestamp.fromMillis(now) });
    tx.set(budgetRef, { window: hour, count: used + 1 });
    return { ok: true } as Claim;
  });
}
async function settle(emailId: string, messageId: string, sender: string, sent: boolean) {
  const db = firestore();
  const refs = [db.collection('supportAutoReplies').doc(emailId), db.collection('supportAutoReplies').doc(`m-${digest(messageId || emailId)}`)];
  const senderRef = db.collection('supportAutoReplyLimits').doc(digest(sender));
  const budgetRef = db.collection('supportRateLimits').doc('autoreply-hour');
  await db.runTransaction(async (tx) => {
    const [current, budget, claimed] = await Promise.all([tx.get(senderRef), tx.get(budgetRef), tx.get(refs[0])]);
    if (sent) refs.forEach((ref) => tx.update(ref, { state: 'sent', sentAt: Timestamp.now() }));
    else {
      // A failed send must be retryable by the provider's webhook redelivery and must not spend the sender's allowance.
      refs.forEach((ref) => tx.set(ref, { state: 'failed', at: 0, createdAt: Timestamp.now() }));
      const sends = ((current.data()?.sends as number[] | undefined) || []).slice(0, -1);
      tx.set(senderRef, { sends, updatedAt: Timestamp.now() });
      // Return the site-wide slot too, but only if its hourly window is still the current one.
      if (budget.data()?.window === claimed.data()?.hour && (budget.data()?.count ?? 0) > 0) tx.set(budgetRef, { window: budget.data()!.window, count: budget.data()!.count - 1 });
    }
  }).catch(() => {});
}

export function autoReplyEnabled() { return !/^(?:off|false|0|disabled)$/i.test(process.env.SUPPORT_AUTOREPLY?.trim() || ''); }

export async function sendAutoReply(config: SupportConfig, emailId: string, email: ReceivedEmail) {
  if (!autoReplyEnabled()) return { ignored: true, reason: 'disabled' };
  const decision = autoReplyDecision(config, email);
  if (!decision.reply) return { ignored: true, reason: decision.reason };
  const messageId = (email.message_id || '').trim();
  const claimed = await claim(emailId, messageId, decision.to);
  if (!claimed.ok) {
    if (claimed.reason === 'in-progress') throw new SupportError('AUTOREPLY_IN_PROGRESS', 503, 'Auto-reply is still being sent.');
    return claimed.reason === 'duplicate' ? { duplicate: true } : { ignored: true, reason: claimed.reason };
  }
  const language = detectLanguage(email.subject, email.text, email.html && !email.text ? email.html.replace(/<[^>]*>/g, ' ') : null);
  const content = buildAutoReply(language, email.from, email.subject || '');
  const references = [header(email.headers, 'references')?.trim(), messageId].filter(Boolean).join(' ').slice(-900);
  try {
    const result = await new Resend(config.apiKey).emails.send({
      from: config.from, to: [decision.to], replyTo: config.inbox, ...content,
      headers: { ...(messageId ? { 'In-Reply-To': messageId, References: references } : {}), 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All', Precedence: 'auto_reply' },
    }, { idempotencyKey: `autoreply/${emailId}`, signal: AbortSignal.timeout(15_000) });
    if (result.error || !result.data?.id) throw new Error('RESEND_SEND_FAILED');
  } catch {
    await settle(emailId, messageId, decision.to, false);
    throw new SupportError('AUTOREPLY_FAILED', 503, 'Auto-reply could not be sent.');
  }
  await settle(emailId, messageId, decision.to, true);
  return { autoReplied: true, language };
}

/** Single entry point for a verified `email.received` event. */
export async function handleInboundEmail(config: SupportConfig, emailId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(emailId)) return { ignored: true };
  const db = firestore();
  // Cheap provider-redelivery guard before spending an API call on the body.
  const [chat, auto] = await Promise.all([db.collection('supportInboundReceipts').doc(emailId).get(), db.collection('supportAutoReplies').doc(emailId).get()]);
  if (chat.exists || (auto.exists && auto.data()?.state === 'sent')) return { duplicate: true };
  const email = await fetchReceivedEmail(config, emailId);
  // Owner replies to a private chat alias belong to the chat bridge, never to the auto-responder.
  if (replyRoute(email.received_for?.length ? email.received_for : email.to, config.replyDomain).length) return receiveSupportReply(config, emailId, email);
  return sendAutoReply(config, emailId, email);
}
