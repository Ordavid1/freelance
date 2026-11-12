import 'server-only';
import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { firestore } from '@/lib/db/firestore';
import { mailbox, type SupportConfig } from '@/lib/support/config';
import { SupportError } from '@/lib/support/http';
import { SUPPORT_MAX_TEXT } from '@/lib/support/shared';
import { digest } from '@/lib/support/service';
import { enqueueSlackJobs, kickSlackJobs } from '@/lib/support/slack/outbox';
import { supportSlackConfig } from '@/lib/support/slack/config';

export type AgentReplyResult = { delivered: true; duplicate?: boolean };
type ConversationStatus = 'open' | 'waiting_on_customer' | 'closed';

const REFERENCES_MAX = 900;

/** Keeps the newest message ids that fit in the References header (oldest first in the output). */
function newestReferences(ids: string[]) {
  const kept: string[] = [];
  let size = 0;
  for (const id of [...ids].reverse()) {
    const next = size + id.length + (kept.length ? 1 : 0);
    if (next > REFERENCES_MAX) break;
    kept.unshift(id);
    size = next;
  }
  return kept.join(' ');
}

/**
 * Delivers one agent reply to the customer through the conversation's channel. Idempotent per `opts.key`:
 * the Firestore message id and the Resend idempotency key are both derived from it.
 */
export async function deliverAgentReply(config: SupportConfig, conversationId: string, text: string, opts: { key: string; agentId: string }): Promise<AgentReplyResult> {
  const body = text.replace(/\x00/g, '').trim();
  if (!body) throw new SupportError('EMPTY', 400, 'Reply is empty.');
  if (body.length > SUPPORT_MAX_TEXT) throw new SupportError('TOO_LONG', 400, 'Reply is too long.');
  const db = firestore();
  const docId = `slack-${digest(opts.key).slice(0, 40)}`;
  const ref = db.collection('supportConversations').doc(conversationId);
  const messageRef = ref.collection('messages').doc(docId);
  const slack = supportSlackConfig();
  const outcome = await db.runTransaction(async (tx) => {
    const [conversation, existing] = await Promise.all([tx.get(ref), tx.get(messageRef)]);
    if (!conversation.exists) throw new SupportError('NOT_FOUND', 404, 'Conversation not found.');
    const data = conversation.data()!;
    if (existing.data()?.delivery === 'sent') return { duplicate: true, data, jobIds: [] as string[] };
    const isEmail = data.channel === 'email';
    const now = Timestamp.now();
    tx.set(messageRef, { sender: 'support', text: body, delivery: isEmail ? 'pending' : 'sent', createdAt: now, source: 'slack', agent: opts.agentId });
    if (isEmail) return { duplicate: false, data, jobIds: [] as string[] };
    tx.set(ref, { updatedAt: now, status: 'waiting_on_customer' }, { merge: true });
    // Refresh the Slack card so it shows "waiting on customer". Keyed by the message, so a retry cannot queue twice.
    return { duplicate: false, data, jobIds: slack ? enqueueSlackJobs(tx, conversationId, docId, ['card']) : [] };
  });
  if (outcome.duplicate) return { delivered: true, duplicate: true };
  if (outcome.data.channel !== 'email') {
    kickSlackJobs(outcome.jobIds);
    return { delivered: true };
  }
  kickSlackJobs(await sendEmailReply(config, conversationId, docId, body, outcome.data, Boolean(slack)));
  return { delivered: true };
}

async function sendEmailReply(config: SupportConfig, conversationId: string, docId: string, body: string, data: FirebaseFirestore.DocumentData, slack: boolean): Promise<string[]> {
  const db = firestore();
  const ref = db.collection('supportConversations').doc(conversationId);
  const messageRef = ref.collection('messages').doc(docId);
  const thread = (data.emailThread || {}) as { subject?: string; references?: string[]; lastMessageId?: string };
  if (typeof data.email !== 'string' || !data.email) throw new SupportError('NOT_FOUND', 404, 'Conversation has no email address.');
  const domain = (mailbox(config.from) || '').split('@')[1] || config.replyDomain;
  const ourMessageId = `<${docId}@${domain}>`;
  const base = String(thread.subject || '').replace(/^\s*re:\s*/i, '').trim() || 'Your message';
  const chain = [...(Array.isArray(thread.references) ? thread.references : [])];
  if (thread.lastMessageId && !chain.includes(thread.lastMessageId)) chain.push(thread.lastMessageId);
  const references = newestReferences(chain);
  const headers: Record<string, string> = { 'Message-ID': ourMessageId };
  if (thread.lastMessageId) headers['In-Reply-To'] = thread.lastMessageId;
  if (references) headers.References = references;
  let providerId: string;
  try {
    const result = await new Resend(config.apiKey).emails.send(
      { from: config.from, to: [data.email], replyTo: config.inbox, subject: `Re: ${base}`, text: body, headers },
      { idempotencyKey: `slack-reply/${conversationId}/${docId}`, signal: AbortSignal.timeout(15_000) },
    );
    if (result.error || !result.data?.id) throw new Error('RESEND_SEND_FAILED');
    providerId = result.data.id;
  } catch {
    // Never downgrade a message that a concurrent attempt already marked sent.
    await db.runTransaction(async (tx) => {
      const current = await tx.get(messageRef);
      if (current.data()?.delivery !== 'sent') tx.update(messageRef, { delivery: 'failed' });
    }).catch(() => {});
    throw new SupportError('SEND_FAILED', 503, 'Reply could not be sent to the customer.');
  }
  return db.runTransaction(async (tx) => {
    const conversation = await tx.get(ref);
    const current = (conversation.data()?.emailThread || {}) as { references?: string[] };
    const stored = [...(Array.isArray(current.references) ? current.references : []), ourMessageId].slice(-20);
    tx.set(messageRef, { delivery: 'sent', emailId: providerId, messageId: ourMessageId }, { merge: true });
    tx.set(ref, { updatedAt: Timestamp.now(), status: 'waiting_on_customer', emailThread: { ...(conversation.data()?.emailThread || {}), references: stored, lastMessageId: ourMessageId } }, { merge: true });
    tx.set(db.collection('supportEmailThreads').doc(digest(ourMessageId)), { conversationId }, { merge: false });
    return slack ? enqueueSlackJobs(tx, conversationId, docId, ['card']) : [];
  });
}

/** Changes the conversation status and refreshes its Slack parent card. */
export async function setConversationStatus(conversationId: string, status: ConversationStatus): Promise<void> {
  const db = firestore();
  const ref = db.collection('supportConversations').doc(conversationId);
  const slack = supportSlackConfig();
  const jobIds = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new SupportError('NOT_FOUND', 404, 'Conversation not found.');
    tx.set(ref, { status, updatedAt: Timestamp.now() }, { merge: true });
    return slack ? enqueueSlackJobs(tx, conversationId, `status-${randomBytes(12).toString('hex')}`, ['card']) : [];
  });
  kickSlackJobs(jobIds);
}
