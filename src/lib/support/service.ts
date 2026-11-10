import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { Resend, type GetReceivingEmailResponseSuccess } from 'resend';
import EmailReplyParser from 'email-reply-parser';
import { convert } from 'html-to-text';
import { firestore } from '@/lib/db/firestore';
import { mailbox, validEmail, type SupportConfig } from '@/lib/support/config';
import { SupportError } from '@/lib/support/http';
import { SUPPORT_MAX_TEXT, type SupportMessage } from '@/lib/support/shared';
export { SUPPORT_COOKIE } from '@/lib/support/shared';

export const newSupportToken = () => randomBytes(32).toString('base64url');
export const validSupportToken = (token: unknown): token is string => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
type Visitor = { uid: string; email: string | null; name: string | null } | null;
type Conversation = { uid: string | null; name: string; email: string; replyToken: string; messageCount: number; windowStart: number; windowCount: number };
export type VisitorMessage = { id: string; text: string; name: string; email: string; page: string };

export function visitorMessage(body: unknown): VisitorMessage {
  if (!body || typeof body !== 'object') throw new SupportError('INVALID', 400, 'נא למלא הודעה וכתובת מייל תקינה.');
  const data = body as Record<string, unknown>;
  if (data.website) throw new SupportError('INVALID', 400, 'הבקשה נדחתה.');
  if (typeof data.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.id) || typeof data.text !== 'string' || !data.text.trim() || data.text.length > SUPPORT_MAX_TEXT || !validEmail(data.email)) {
    throw new SupportError('INVALID', 400, 'נא למלא הודעה (עד 4,000 תווים) וכתובת מייל תקינה.');
  }
  if (typeof data.name !== 'string' || data.name.length > 80 || /[\x00-\x1f\x7f]/.test(data.name)) throw new SupportError('INVALID', 400, 'השם אינו תקין.');
  const page = typeof data.page === 'string' && /^\/(?!\/)[^\s?#]*$/.test(data.page) ? data.page.slice(0, 500) : '/';
  return { id: data.id, text: data.text.trim(), name: data.name.trim() || 'אורח/ת', email: data.email.toLowerCase(), page };
}
function conversationRef(token: string) { return firestore().collection('supportConversations').doc(digest(token)); }
function owns(conversation: Conversation, viewer: Visitor) { return !conversation.uid || conversation.uid === viewer?.uid; }
function publicMessage(id: string, data: FirebaseFirestore.DocumentData): SupportMessage {
  return {
    id, sender: data.sender === 'support' ? 'support' : 'visitor', text: data.text, createdAt: data.createdAt.toMillis(), delivery: data.delivery || 'sent',
    ...(data.sender === 'visitor' && data.delivery !== 'sent' ? { retry: { name: data.contactName, email: data.contactEmail, page: data.page } } : {}),
  };
}
export async function readSupportConversation(token: string, viewer: Visitor) {
  const ref = conversationRef(token);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as Conversation;
  if (!owns(data, viewer)) throw new SupportError('SESSION_CHANGED', 401, 'יש לפתוח שיחה חדשה לאחר שינוי החשבון.');
  const messages = await ref.collection('messages').orderBy('createdAt', 'desc').limit(100).get();
  return { contact: { name: data.name, email: data.email }, messages: messages.docs.map((doc) => publicMessage(doc.id, doc.data())).reverse() };
}

export async function sendSupportMessage(config: SupportConfig, token: string, viewer: Visitor, input: VisitorMessage) {
  const db = firestore();
  const ref = conversationRef(token);
  const messageRef = ref.collection('messages').doc(input.id);
  // A persistent shared budget also limits clients that rotate their cookies.
  const budgetRef = db.collection('supportRateLimits').doc('outbound-hour');
  const reservation = await db.runTransaction(async (tx) => {
    const [conversation, existing, budget] = await Promise.all([tx.get(ref), tx.get(messageRef), tx.get(budgetRef)]);
    const data = conversation.data() as Conversation | undefined;
    if (data && !owns(data, viewer)) throw new SupportError('SESSION_CHANGED', 401, 'יש לפתוח את הצ׳אט מחדש לאחר שינוי החשבון.');
    if (existing.exists) {
      const message = existing.data()!;
      if (message.text !== input.text || message.contactEmail !== input.email || message.contactName !== input.name || message.page !== input.page) throw new SupportError('CONFLICT', 409, 'ההודעה השתנתה. נא לשלוח אותה כהודעה חדשה.');
      if (message.delivery !== 'sent' && Date.now() - message.createdAt.toMillis() > 23 * 3_600_000) throw new SupportError('EXPIRED_RETRY', 409, 'חלף זמן רב מהניסיון הקודם. נא לשלוח הודעה חדשה.');
      return { conversation: data!, message };
    }
    const now = Date.now();
    const budgetWindow = Math.floor(now / 3_600_000);
    const budgetCount = budget.data()?.window === budgetWindow ? (budget.data()?.count || 0) : 0;
    const windowStart = data && now - data.windowStart < 600_000 ? data.windowStart : now;
    const windowCount = data && windowStart === data.windowStart ? data.windowCount : 0;
    if (windowCount >= 10 || (data?.messageCount || 0) >= 200 || budgetCount >= 100) throw new SupportError('RATE_LIMIT', 429, 'התקבלו הרבה הודעות. אפשר לנסות שוב מאוחר יותר או לפנות במייל.');
    const next: Conversation = { uid: data?.uid || viewer?.uid || null, name: data?.name || input.name, email: data?.email || input.email, replyToken: data?.replyToken || randomBytes(16).toString('hex'), messageCount: (data?.messageCount || 0) + 1, windowStart, windowCount: windowCount + 1 };
    const message = { sender: 'visitor', text: input.text, createdAt: Timestamp.fromMillis(now), delivery: 'pending', contactName: input.name, contactEmail: input.email, page: input.page };
    tx.set(ref, { ...next, updatedAt: Timestamp.fromMillis(now), ...(!data ? { createdAt: Timestamp.fromMillis(now) } : {}) }, { merge: true });
    tx.create(messageRef, message);
    if (!data) tx.create(db.collection('supportReplyRoutes').doc(digest(next.replyToken)), { conversationId: ref.id });
    tx.set(budgetRef, { window: budgetWindow, count: budgetCount + 1 });
    return { conversation: next, message };
  });
  if (reservation.message.delivery === 'sent') return publicMessage(input.id, reservation.message);
  const replyTo = `chat+${reservation.conversation.replyToken}@${config.replyDomain}`;
  // Identical retries reuse the provider payload and idempotency key across instances.
  const payload = {
    from: config.from, to: [config.inbox], replyTo,
    subject: `[Chat ${ref.id.slice(0, 8)}] ${input.name} · Freelance Place`,
    text: `הודעה חדשה בצ׳אט התמיכה\n\nשם: ${input.name}\nמייל לחזרה: ${input.email}\nעמוד: ${input.page}\n\n--- הודעת המשתמש/ת ---\n${input.text}\n--- סוף ההודעה ---\n\nכדי לענות בצ׳אט, השיבו למייל הזה מעל הציטוט. התשובה תופיע בשיחה באתר.\nההודעה נשלחה מתוך האתר; פרטי הקשר ותוכן ההודעה נמסרו על ידי המשתמש/ת.`,
    headers: { 'X-Entity-Ref-ID': ref.id },
  };
  try {
    const result = await new Resend(config.apiKey).emails.send(payload, { idempotencyKey: `support/${ref.id}/${input.id}`, signal: AbortSignal.timeout(15_000) });
    if (result.error || !result.data?.id) throw new Error('RESEND_SEND_FAILED');
    await messageRef.update({ delivery: 'sent', emailId: result.data.id });
  } catch {
    // Never downgrade a successful concurrent retry to failed.
    await db.runTransaction(async (tx) => {
      const current = await tx.get(messageRef);
      if (current.data()?.delivery !== 'sent') tx.update(messageRef, { delivery: 'failed' });
    }).catch(() => {});
    throw new SupportError('SEND_FAILED', 503, 'ההודעה לא נשלחה לצוות. אפשר לנסות שוב או לפנות במייל.');
  }
  return publicMessage(input.id, { ...reservation.message, delivery: 'sent' });
}

export function extractSupportReply(text: string | null, html: string | null) {
  const plain = (text || (html ? convert(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] }) : '')).slice(0, 100_000);
  // Also recognize Hebrew Gmail/Outlook quote headers.
  const beforeQuote = plain.split(/\n\s*(?:בתאריך\s[^\n]{0,500}(?:כתב|כתבה)|מאת:\s|From:\s|_{5,}|-{2,}\s*Original Message)/i)[0];
  return new EmailReplyParser().parseReply(beforeQuote).replace(/\x00/g, '').trim().slice(0, SUPPORT_MAX_TEXT);
}
export function replyRoute(recipients: string[], domain: string) {
  const tokens = recipients.map((recipient) => mailbox(recipient)).filter((email) => email?.endsWith(`@${domain}`)).map((email) => email!.split('@')[0].match(/^chat\+([a-f0-9]{32})$/)?.[1]).filter((token): token is string => Boolean(token));
  return [...new Set(tokens)];
}
export type ReceivedEmail = GetReceivingEmailResponseSuccess;
// Webhooks contain metadata only; fetch the body directly from Resend.
export async function fetchReceivedEmail(config: SupportConfig, emailId: string): Promise<ReceivedEmail> {
  const { data: email, error } = await new Resend(config.apiKey).emails.receiving.get(emailId, { html_format: 'cid' }, { signal: AbortSignal.timeout(15_000) });
  if (error || !email) throw new SupportError('RECEIVE_FAILED', 503, 'לא ניתן לקרוא את התשובה כרגע.');
  return email;
}
export async function receiveSupportReply(config: SupportConfig, emailId: string, preloaded?: ReceivedEmail) {
  if (!/^[a-f0-9-]{36}$/i.test(emailId)) return { ignored: true };
  const db = firestore();
  const receiptRef = db.collection('supportInboundReceipts').doc(emailId);
  if ((await receiptRef.get()).exists) return { duplicate: true };
  const email = preloaded ?? await fetchReceivedEmail(config, emailId);
  const sender = mailbox(email.from);
  if (!sender || !config.allowedSenders.includes(sender)) return { ignored: true };
  const headers = Object.fromEntries(Object.entries(email.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  if ((headers['auto-submitted'] && headers['auto-submitted'].toLowerCase() !== 'no') || /auto_reply|bulk|list/i.test(headers.precedence || '') || headers['x-autoreply'] || headers['x-autorespond']) return { ignored: true };
  const routes = replyRoute(email.received_for?.length ? email.received_for : email.to, config.replyDomain);
  // Never fan an email out into multiple private conversations.
  if (routes.length !== 1) return { ignored: true };
  const route = await db.collection('supportReplyRoutes').doc(digest(routes[0])).get();
  const conversationId = route.data()?.conversationId;
  if (typeof conversationId !== 'string' || !/^[a-f0-9]{64}$/.test(conversationId)) return { ignored: true };
  const reply = extractSupportReply(email.text, email.html);
  if (!reply) return { ignored: true };
  const ref = db.collection('supportConversations').doc(conversationId);
  await db.runTransaction(async (tx) => {
    const [receipt, conversation] = await Promise.all([tx.get(receiptRef), tx.get(ref)]);
    if (receipt.exists || !conversation.exists) return;
    const now = Timestamp.now();
    tx.create(ref.collection('messages').doc(`reply-${emailId}`), { sender: 'support', text: reply, delivery: 'sent', createdAt: now });
    tx.update(ref, { updatedAt: now });
    tx.create(receiptRef, { conversationId, createdAt: now });
  });
  return { received: true };
}
