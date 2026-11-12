import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import type { SupportConfig } from '@/lib/support/config';
import { autoReplyDecision } from '@/lib/support/autoreply';
import { digest, extractSupportReply, type ReceivedEmail } from '@/lib/support/service';
import { SUPPORT_MAX_TEXT } from '@/lib/support/shared';
import { enqueueSlackJobs } from '@/lib/support/slack/outbox';
import { supportSlackConfig } from '@/lib/support/slack/config';

const cleanLine = (value: unknown, max: number) => String(value || '').replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, max);

function displayName(from: string | null | undefined, sender: string) {
  const named = (from || '').match(/^\s*"?([^"<>\r\n]{1,80}?)"?\s*</)?.[1]?.trim();
  return cleanLine(named || sender.split('@')[0], 80) || 'Customer';
}

function lowerHeaders(headers: Record<string, string> | null | undefined) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

/**
 * Records a human email to the support inbox as an email-channel conversation, once per provider email id.
 * Replies are threaded by In-Reply-To/References through supportEmailThreads. Returns null when the email is not a
 * human customer message (auto-replies, machines, our own addresses).
 */
export async function recordInboundEmail(config: SupportConfig, emailId: string, email: ReceivedEmail): Promise<{ conversationId: string; jobIds: string[]; existing: boolean } | null> {
  const decision = autoReplyDecision(config, email);
  if (!decision.reply) return null;
  const sender = decision.to;
  const db = firestore();
  const headers = lowerHeaders(email.headers as Record<string, string> | null);
  const messageId = String(email.message_id || '').trim();
  const inReplyTo = (headers['in-reply-to'] || '').trim();
  const references = (headers.references || '').split(/\s+/).filter(Boolean).reverse();
  const candidates = [...new Set([inReplyTo, ...references, messageId].filter(Boolean))];

  let conversationId: string | null = null;
  for (const candidate of candidates) {
    const route = await db.collection('supportEmailThreads').doc(digest(candidate)).get();
    const found = route.data()?.conversationId;
    if (typeof found !== "string" || !/^[a-f0-9]{64}$/.test(found)) continue;
    const conversation = await db.collection('supportConversations').doc(found).get();
    if (conversation.data()?.email === sender) {
      conversationId = found;
      break;
    }
  }
  const id = conversationId ?? digest(`email:${sender}:${messageId || emailId}`);

  const ref = db.collection('supportConversations').doc(id);
  const messageRef = ref.collection('messages').doc(`email-${emailId}`);
  const subject = cleanLine(email.subject, 200);
  const text = (extractSupportReply(email.text, email.html) || subject || '(empty email)').slice(0, SUPPORT_MAX_TEXT);
  const name = displayName(email.from, sender);
  const attachmentCount = Array.isArray((email as { attachments?: unknown[] }).attachments) ? (email as { attachments: unknown[] }).attachments.length : 0;
  const slackEnabled = Boolean(supportSlackConfig());
  const now = Timestamp.now();

  return db.runTransaction(async (tx) => {
    const [message, conversation] = await Promise.all([tx.get(messageRef), tx.get(ref)]);
    // Provider redelivery: everything was already recorded and queued the first time.
    // The stored flag answers redeliveries the same way as the first attempt, so a retried ack decision cannot change.
    if (message.exists) return { conversationId: id, jobIds: [] as string[], existing: message.data()?.existing === true };
    const previous = (conversation.data()?.emailThread || {}) as { subject?: string; references?: string[]; lastMessageId?: string };
    const threadReferences = [...new Set([...(Array.isArray(previous.references) ? previous.references : []), ...(messageId ? [messageId] : [])])].slice(-20);
    const existing = conversationId !== null;
    tx.create(messageRef, { sender: 'visitor', text, delivery: 'sent', createdAt: now, source: 'email', emailId, messageId, contactName: name, contactEmail: sender, attachmentCount, existing });
    tx.set(ref, {
      channel: 'email', name, email: sender, uid: null, status: 'open', updatedAt: now,
      ...(conversation.exists ? {} : { createdAt: now }),
      emailThread: { subject: previous.subject || subject || '(no subject)', references: threadReferences, lastMessageId: messageId || previous.lastMessageId || '' },
    }, { merge: true });
    if (messageId) tx.set(db.collection('supportEmailThreads').doc(digest(messageId)), { conversationId: id }, { merge: false });
    const jobIds = slackEnabled ? enqueueSlackJobs(tx, id, `email-${emailId}`, ['message', 'draft']) : [];
    return { conversationId: id, jobIds, existing };
  });
}

