import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { after } from 'next/server';
import { firestore } from '@/lib/db/firestore';
import { digest } from '@/lib/support/service';
import { AiUnavailable, triageConversation } from '@/lib/support/ai-triage';
import { SlackApiError, postMessage, updateMessage } from '@/lib/support/slack/client';
import { customerMessage, draftCard, draftResolvedCard, parentCard, type ConversationCard, type Triage } from '@/lib/support/slack/blocks';
import { supportSlackConfig, type SlackConfig } from '@/lib/support/slack/config';

export type SlackJobType = 'message' | 'draft' | 'card';
type JobState = 'pending' | 'running' | 'done' | 'failed';
type JobResult = 'done' | 'retry' | 'skipped' | 'failed';

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
const PARENT_CLAIM_MS = 30_000;
const MAX_BACKOFF_MS = 3_600_000;

export function slackJobId(conversationId: string, messageId: string, type: SlackJobType) {
  return digest(`${conversationId}/${messageId}/${type}`);
}

/**
 * Writes outbox jobs inside the caller's transaction. Jobs are keyed deterministically, so a retried
 * transaction rewrites the same documents instead of creating duplicates.
 */
export function enqueueSlackJobs(tx: FirebaseFirestore.Transaction, conversationId: string, messageId: string, types: SlackJobType[]) {
  const db = firestore();
  const now = Date.now();
  return types.map((type) => {
    const id = slackJobId(conversationId, messageId, type);
    tx.set(db.collection('supportSlackOutbox').doc(id), { type, conversationId, messageId, state: 'pending' satisfies JobState, attempts: 0, nextAt: now, leaseUntil: 0, createdAt: Timestamp.fromMillis(now) }, { merge: false });
    return id;
  });
}

/** Fire-and-forget processing after the response. Outside a request scope it is a silent no-op; the sweep picks the jobs up. */
export function kickSlackJobs(jobIds: string[]) {
  if (!jobIds.length) return;
  try {
    after(() => Promise.all(jobIds.map((id) => processSlackJob(id))).then(() => undefined, () => undefined));
  } catch {
    /* not inside a request */
  }
}

export async function processSlackJob(jobId: string): Promise<JobResult> {
  const config = supportSlackConfig();
  if (!config) return 'skipped';
  const db = firestore();
  const ref = db.collection('supportSlackOutbox').doc(jobId);
  try {
    const job = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const data = snapshot.data()!;
      const now = Date.now();
      const claimable = (data.state === 'pending' && data.nextAt <= now) || (data.state === 'running' && data.leaseUntil < now);
      if (!claimable) return null;
      const attempts = (data.attempts || 0) + 1;
      const leaseUntil = now + LEASE_MS;
      tx.update(ref, { state: 'running' satisfies JobState, attempts, leaseUntil, nextAt: leaseUntil });
      return { ...data, attempts } as { type: SlackJobType; conversationId: string; messageId: string; attempts: number };
    });
    if (!job) return 'skipped';
    try {
      await runJob(config, jobId, job);
    } catch (error) {
      // Fixed event name only: no payloads, names, emails or provider bodies.
      console.error('support_slack_job_failed');
      const code = error instanceof SlackApiError ? error.code : 'error';
      if (job.attempts >= MAX_ATTEMPTS) {
        await ref.update({ state: 'failed' satisfies JobState, nextAt: FieldValue.delete(), leaseUntil: FieldValue.delete(), lastError: code });
        return 'failed';
      }
      const backoff = Math.min(2 ** job.attempts * 30_000, MAX_BACKOFF_MS);
      const retryAfter = error instanceof SlackApiError && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : 0;
      await ref.update({ state: 'pending' satisfies JobState, nextAt: Date.now() + Math.max(backoff, retryAfter), leaseUntil: FieldValue.delete(), lastError: code });
      return 'retry';
    }
    await ref.update({ state: 'done' satisfies JobState, nextAt: FieldValue.delete(), leaseUntil: FieldValue.delete() });
    return 'done';
  } catch {
    console.error('support_slack_job_sweep_failed');
    return 'retry';
  }
}

/** Sweep for due jobs. Single-field query only (no composite index); finished jobs drop out because nextAt is removed. */
export async function processDueSlackJobs(limit = 20) {
  const snapshot = await firestore().collection('supportSlackOutbox').where('nextAt', '<=', Date.now()).orderBy('nextAt').limit(limit).get();
  const counts = { done: 0, retry: 0, failed: 0 };
  for (const doc of snapshot.docs) {
    const result = await processSlackJob(doc.id);
    if (result === 'done') counts.done++;
    else if (result === 'retry') counts.retry++;
    else if (result === 'failed') counts.failed++;
  }
  return counts;
}

async function runJob(config: SlackConfig, jobId: string, job: { type: SlackJobType; conversationId: string; messageId: string }) {
  if (job.type === 'message') return postVisitorMessage(config, job.conversationId, job.messageId);
  if (job.type === 'draft') return postDraft(config, job.conversationId, jobId);
  return refreshCard(config, job.conversationId);
}

/**
 * Returns the Slack parent for a conversation, creating it once. A short lease in the conversation document
 * stops two workers from posting two parents. Returns null while another worker holds the lease (retry later).
 */
export async function ensureParent(config: SlackConfig, conversationId: string): Promise<{ channel: string; ts: string } | null> {
  const db = firestore();
  const ref = db.collection('supportConversations').doc(conversationId);
  const claim = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new Error('support_conversation_missing');
    const data = snapshot.data()!;
    if (data.slack) return { kind: 'existing' as const, slack: data.slack as { channel: string; ts: string } };
    const now = Date.now();
    if (typeof data.slackClaim === 'number' && data.slackClaim > now) return { kind: 'held' as const };
    tx.update(ref, { slackClaim: now + PARENT_CLAIM_MS });
    return { kind: 'claimed' as const, data };
  });
  if (claim.kind === 'existing') return claim.slack;
  if (claim.kind === 'held') return null;
  try {
    const card = await cardFor(conversationId, claim.data);
    const posted = await postMessage(config.botToken, { channel: config.channelId, ...parentCard(card) });
    const slack = { channel: config.channelId, ts: posted.ts };
    await db.runTransaction(async (tx) => {
      tx.set(ref, { slack, slackClaim: FieldValue.delete() }, { merge: true });
      tx.set(db.collection('supportSlackThreads').doc(digest(`${slack.channel}:${slack.ts}`)), { conversationId }, { merge: false });
    });
    return slack;
  } catch (error) {
    await ref.update({ slackClaim: FieldValue.delete() }).catch(() => {});
    throw error;
  }
}

async function cardFor(conversationId: string, data: FirebaseFirestore.DocumentData): Promise<ConversationCard> {
  const channel = data.channel === 'email' ? 'email' : 'chat';
  let page: string | undefined;
  if (channel === 'chat') {
    const first = await firestore().collection('supportConversations').doc(conversationId).collection('messages').orderBy('createdAt', 'asc').limit(1).get();
    page = typeof first.docs[0]?.data()?.page === 'string' ? first.docs[0].data().page : undefined;
  }
  return {
    conversationId,
    channel,
    name: String(data.name || ''),
    email: String(data.email || ''),
    ...(page ? { page } : {}),
    ...(channel === 'email' && data.emailThread?.subject ? { subject: String(data.emailThread.subject) } : {}),
    status: data.status === 'waiting_on_customer' || data.status === 'closed' ? data.status : 'open',
    ...(data.triage ? { triage: data.triage as Triage } : {}),
  };
}

async function postVisitorMessage(config: SlackConfig, conversationId: string, messageId: string) {
  const db = firestore();
  const conversation = db.collection('supportConversations').doc(conversationId);
  const message = await conversation.collection('messages').doc(messageId).get();
  if (!message.exists) return;
  const data = message.data()!;
  if (data.sender !== 'visitor') return;
  const parent = await ensureParent(config, conversationId);
  if (!parent) throw new Error('support_parent_claimed');
  await postMessage(config.botToken, {
    channel: config.channelId,
    thread_ts: parent.ts,
    ...customerMessage({ name: String(data.contactName || 'Visitor'), text: String(data.text || ''), mentionIds: config.agentIds, attachmentCount: typeof data.attachmentCount === 'number' ? data.attachmentCount : 0 }),
  });
  // A reopened conversation must show "open" again. The thread reply is already posted, so a failed refresh is only logged.
  try {
    const current = await conversation.get();
    if (current.exists) await updateMessage(config.botToken, { channel: parent.channel, ts: parent.ts, ...parentCard(await cardFor(conversationId, current.data()!)) });
  } catch {
    console.error('support_slack_card_refresh_failed');
  }
}

async function postDraft(config: SlackConfig, conversationId: string, jobId: string) {
  const db = firestore();
  const conversation = db.collection('supportConversations').doc(conversationId);
  const snapshot = await conversation.get();
  if (!snapshot.exists) return;
  const draftRef = db.collection('supportSlackDrafts').doc(jobId);
  // Already posted by an earlier attempt: nothing left to do.
  if ((await draftRef.get()).data()?.slack) return;
  const data = snapshot.data()!;
  const recent = await conversation.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
  const messages = recent.docs.map((doc) => doc.data()).reverse().map((item) => ({ sender: item.sender === 'support' ? 'support' as const : 'visitor' as const, text: String(item.text || '') }));
  const card = await cardFor(conversationId, data);
  let result: { triage: Triage; draft: string | null };
  try {
    result = await triageConversation({ channel: card.channel, name: card.name, page: card.page, subject: card.subject, messages });
  } catch (error) {
    // AI disabled or unconfigured: the message still reaches Slack, just without a draft.
    if (error instanceof AiUnavailable) return;
    throw error;
  }
  const parent = await ensureParent(config, conversationId);
  if (!parent) throw new Error('support_parent_claimed');
  await supersedeDrafts(config, conversationId, jobId);
  await draftRef.set({ conversationId, draft: result.draft, triage: result.triage, state: 'open', createdAt: Timestamp.now() }, { merge: true });
  const posted = await postMessage(config.botToken, { channel: config.channelId, thread_ts: parent.ts, ...draftCard({ draftId: jobId, draft: result.draft, triage: result.triage }) });
  await draftRef.update({ slack: { channel: config.channelId, ts: posted.ts } });
  await conversation.update({ triage: result.triage });
  await updateMessage(config.botToken, { channel: parent.channel, ts: parent.ts, ...parentCard({ ...card, triage: result.triage }) });
}

/**
 * Earlier drafts of the conversation are stale once a newer one exists. They are marked superseded before the new card
 * is posted, so only the newest draft can be sent. Each state change is claimed in a transaction, so a click that races
 * this sweep sees the draft as already handled.
 */
async function supersedeDrafts(config: SlackConfig, conversationId: string, keepId: string) {
  const db = firestore();
  const open = await db.collection('supportSlackDrafts').where('conversationId', '==', conversationId).where('state', '==', 'open').get();
  for (const doc of open.docs) {
    if (doc.id === keepId) continue;
    const ref = db.collection('supportSlackDrafts').doc(doc.id);
    const claimed = await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.data()?.state !== 'open') return null;
      tx.update(ref, { state: 'superseded' });
      return current.data()!;
    });
    if (!claimed?.slack) continue;
    try {
      const card = draftResolvedCard({ draft: claimed.draft ?? null, triage: claimed.triage as Triage, outcome: 'superseded' });
      await updateMessage(config.botToken, { channel: claimed.slack.channel, ts: claimed.slack.ts, text: card.text, blocks: card.blocks });
    } catch {
      // The state change is already committed, so a retry would not repeat this card update.
      console.error('support_slack_card_refresh_failed');
    }
  }
}

async function refreshCard(config: SlackConfig, conversationId: string) {
  const snapshot = await firestore().collection('supportConversations').doc(conversationId).get();
  if (!snapshot.exists) return;
  const data = snapshot.data()!;
  if (!data.slack) {
    await ensureParent(config, conversationId);
    return;
  }
  const card = await cardFor(conversationId, data);
  await updateMessage(config.botToken, { channel: data.slack.channel, ts: data.slack.ts, ...parentCard(card) });
}
