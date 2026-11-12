import 'server-only';
import { firestore } from '@/lib/db/firestore';
import { supportConfig } from '@/lib/support/config';
import { deliverAgentReply, setConversationStatus } from '@/lib/support/delivery';
import { limitedBody } from '@/lib/support/http';
import { draftResolvedCard, editDraftModal, type Triage } from '@/lib/support/slack/blocks';
import { openView, postEphemeral, updateMessage } from '@/lib/support/slack/client';
import { isAgent, supportSlackConfig, type SlackConfig } from '@/lib/support/slack/config';
import { verifySlackSignature } from '@/lib/support/slack/verify';

export const runtime = 'nodejs';

type Draft = { conversationId: string; draft: string | null; triage: Triage; state: string; slack?: { channel: string; ts: string } };
type Payload = Record<string, unknown> & { type?: string; user?: { id?: string }; channel?: { id?: string }; trigger_id?: string; actions?: unknown[]; view?: Record<string, unknown>; message?: { ts?: string } };

const empty = () => new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function quietly(task: () => Promise<unknown>) {
  try { await task(); } catch { console.error('support_slack_interaction_failed'); }
}

function drafts() { return firestore().collection('supportSlackDrafts'); }

async function loadDraft(draftId: string): Promise<Draft | null> {
  const data = (await drafts().doc(draftId).get()).data();
  return data ? data as Draft : null;
}

// Moves an open draft to a terminal state exactly once. Returns null when it was already handled.
async function claimDraft(draftId: string, state: 'sent' | 'discarded'): Promise<Draft | null> {
  const ref = drafts().doc(draftId);
  return firestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data() as Draft | undefined;
    if (!data || data.state !== 'open') return null;
    tx.update(ref, { state });
    return data;
  });
}

async function updateCard(config: SlackConfig, draft: Draft, outcome: 'sent' | 'discarded', userId: string, text: string | null) {
  if (!draft.slack) return;
  const card = draftResolvedCard({ draft: text, triage: draft.triage, outcome, userId });
  await quietly(() => updateMessage(config.botToken, { channel: draft.slack!.channel, ts: draft.slack!.ts, text: card.text, blocks: card.blocks }));
}

// Sends a draft as the agent. The draft is claimed first so a double click cannot send twice.
async function sendDraft(config: SlackConfig, draftId: string, userId: string, edited: string | null): Promise<'sent' | 'handled' | 'failed'> {
  const draft = await claimDraft(draftId, 'sent');
  if (!draft) return 'handled';
  const text = edited ?? draft.draft;
  try {
    const supportCfg = supportConfig();
    if (!supportCfg || !text) throw new Error('DRAFT_NOT_SENDABLE');
    await deliverAgentReply(supportCfg, draft.conversationId, text, { key: `draft/${draftId}`, agentId: userId });
  } catch {
    console.error('support_slack_draft_failed');
    await drafts().doc(draftId).update({ state: 'open' }).catch(() => {});
    return 'failed';
  }
  await updateCard(config, draft, 'sent', userId, text);
  return 'sent';
}

async function discardDraft(config: SlackConfig, draftId: string, userId: string) {
  const draft = await claimDraft(draftId, 'discarded');
  if (!draft) return false;
  await updateCard(config, draft, 'discarded', userId, null);
  return true;
}

async function ephemeral(config: SlackConfig, channel: string | undefined, user: string, text: string) {
  if (channel) await quietly(() => postEphemeral(config.botToken, { channel, user, text }));
}

async function handleBlockActions(config: SlackConfig, payload: Payload) {
  const userId = payload.user?.id;
  const channel = payload.channel?.id;
  if (typeof userId !== 'string') return empty();
  if (!isAgent(config, userId)) {
    await ephemeral(config, channel, userId, 'Only support agents can use these controls.');
    return empty();
  }
  const action = record(Array.isArray(payload.actions) ? payload.actions[0] : null);
  const actionId = action?.action_id;
  const value = action?.value;
  if (typeof actionId !== 'string') return empty();

  if (actionId === 'draft_edit') {
    if (!validId(value)) return empty();
    const draft = await loadDraft(value);
    if (!draft || draft.state !== 'open' || draft.draft === null) {
      await ephemeral(config, channel, userId, 'This draft was already handled.');
      return empty();
    }
    // The trigger id expires quickly, so the modal opens before the response.
    await quietly(() => openView(config.botToken, { trigger_id: String(payload.trigger_id ?? ''), view: editDraftModal({ draftId: value, draft: draft.draft! }) }));
    return empty();
  }
  if (actionId === 'draft_send' || actionId === 'draft_discard') {
    if (!validId(value)) return empty();
    const draftId = value;
    // Inline, not after the response: see the events route for why.
    if (actionId === 'draft_discard') {
      if (!(await discardDraft(config, draftId, userId))) await ephemeral(config, channel, userId, 'This draft was already handled.');
      return empty();
    }
    const result = await sendDraft(config, draftId, userId, null);
    if (result === 'handled') await ephemeral(config, channel, userId, 'This draft was already handled.');
    if (result === 'failed') await ephemeral(config, channel, userId, 'Not sent. Try again.');
    return empty();
  }
  if (actionId === 'conv_close' || actionId === 'conv_reopen') {
    if (!validId(value)) return empty();
    const status = actionId === 'conv_close' ? 'closed' : 'open';
    await setConversationStatus(value, status).catch(async () => {
      console.error('support_slack_status_failed');
      await ephemeral(config, channel, userId, 'Could not update the conversation. Try again.');
    });
    return empty();
  }
  return empty();
}

async function handleViewSubmission(config: SlackConfig, payload: Payload) {
  const view = payload.view;
  if (view?.callback_id !== 'draft_edit_submit') return empty();
  const userId = payload.user?.id;
  const draftId = view.private_metadata;
  const values = record(record(record(view.state)?.values)?.reply);
  const text = record(values?.text)?.value;
  const errors = (message: string) => Response.json({ response_action: 'errors', errors: { reply: message } });
  if (typeof userId !== 'string' || !isAgent(config, userId)) return errors('Only support agents can send replies.');
  if (!validId(draftId) || typeof text !== 'string' || !text.trim()) return errors('Could not send. Try again.');
  const result = await sendDraft(config, draftId, userId, text.trim());
  if (result === 'failed') return errors('Could not send. Try again.');
  return empty();
}

export async function POST(request: Request) {
  try {
    const config = supportSlackConfig();
    if (!config) return Response.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
    const raw = await limitedBody(request, 1_000_000);
    const verified = verifySlackSignature(raw, { timestamp: request.headers.get('x-slack-request-timestamp'), signature: request.headers.get('x-slack-signature') }, config.signingSecret);
    if (!verified) return Response.json({ error: 'SIGNATURE' }, { status: 401 });
    let payload: Payload | null;
    try { payload = record(JSON.parse(new URLSearchParams(raw).get('payload') || '')) as Payload | null; } catch { payload = null; }
    if (!payload) return Response.json({ error: 'INVALID' }, { status: 400 });
    if (payload.type === 'block_actions') return handleBlockActions(config, payload);
    if (payload.type === 'view_submission') return handleViewSubmission(config, payload);
    return empty();
  } catch {
    console.error('support_slack_interactions_failed');
    return Response.json({ error: 'UNAVAILABLE' }, { status: 503 });
  }
}
