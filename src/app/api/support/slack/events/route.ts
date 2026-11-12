import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { supportConfig } from '@/lib/support/config';
import { deliverAgentReply } from '@/lib/support/delivery';
import { limitedBody, SupportError } from '@/lib/support/http';
import { digest } from '@/lib/support/service';
import { addReaction, postEphemeral } from '@/lib/support/slack/client';
import { isAgent, supportSlackConfig, type SlackConfig } from '@/lib/support/slack/config';
import { verifySlackSignature } from '@/lib/support/slack/verify';
import { isInternalNote, slackTextToPlain } from '@/lib/support/slack/text';

export const runtime = 'nodejs';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Slack retries an unacknowledged event; the receipt makes a retried delivery a no-op.
async function firstDelivery(eventId: string) {
  const db = firestore();
  const ref = db.collection('supportSlackEvents').doc(eventId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    tx.create(ref, { createdAt: Timestamp.now() });
    return true;
  });
}

async function quietly(task: () => Promise<unknown>) {
  try { await task(); } catch { /* Slack reactions and ephemerals are best effort. */ }
}

async function handleMessage(config: SlackConfig, event: Record<string, unknown>) {
  if (event.type !== 'message' || event.subtype || event.bot_id || event.channel !== config.channelId) return;
  if (typeof event.thread_ts !== 'string' || event.thread_ts === event.ts) return;
  if (typeof event.user !== 'string' || typeof event.ts !== 'string' || typeof event.text !== 'string') return;
  const channel = config.channelId;
  const thread = { channel, thread_ts: event.thread_ts };
  const mapping = await firestore().collection('supportSlackThreads').doc(digest(`${channel}:${event.thread_ts}`)).get();
  const conversationId = mapping.data()?.conversationId;
  if (typeof conversationId !== 'string' || !/^[a-f0-9]{64}$/.test(conversationId)) return;
  const ephemeral = (text: string) => quietly(() => postEphemeral(config.botToken, { ...thread, user: event.user as string, text }));
  if (!isAgent(config, event.user)) {
    await ephemeral('Only support agents can reply to customers from this channel.');
    return;
  }
  if (isInternalNote(event.text)) {
    await quietly(() => addReaction(config.botToken, { channel, timestamp: event.ts as string, name: 'lock' }));
    return;
  }
  const react = (name: string) => quietly(() => addReaction(config.botToken, { channel, timestamp: event.ts as string, name }));
  try {
    const supportCfg = supportConfig();
    if (!supportCfg) throw new SupportError('NOT_CONFIGURED', 503, 'Support email is not configured.');
    await deliverAgentReply(supportCfg, conversationId, slackTextToPlain(event.text), { key: `msg/${event.client_msg_id || event.ts}`, agentId: event.user });
    await react('white_check_mark');
  } catch {
    console.error('support_slack_reply_failed');
    await react('warning');
    await ephemeral('Not delivered to the customer. Try again.');
  }
}

export async function POST(request: Request) {
  try {
    const config = supportSlackConfig();
    if (!config) return json({ error: 'NOT_CONFIGURED' }, 503);
    const raw = await limitedBody(request, 1_000_000);
    const verified = verifySlackSignature(raw, { timestamp: request.headers.get('x-slack-request-timestamp'), signature: request.headers.get('x-slack-signature') }, config.signingSecret);
    if (!verified) return json({ error: 'SIGNATURE' }, 401);
    let body: Record<string, unknown> | null;
    try { body = record(JSON.parse(raw)); } catch { body = null; }
    if (!body) return json({ error: 'INVALID' }, 400);
    if (body.type === 'url_verification') return json({ challenge: typeof body.challenge === 'string' ? body.challenge : '' });
    if (body.type !== 'event_callback') return json({ ignored: true });
    const eventId = body.event_id;
    if (typeof eventId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(eventId)) return json({ ignored: true });
    if (!(await firstDelivery(eventId))) return json({ duplicate: true });
    const event = record(body.event);
    // Inline on purpose: Cloud Run throttles CPU once a response is sent (cpu_idle), and one transaction plus one
    // Resend call fits in Slack's 3 second window.
    if (event) await handleMessage(config, event).catch(() => console.error('support_slack_event_failed'));
    return json({ ok: true });
  } catch (error) {
    if (error instanceof SupportError) return json({ error: error.code }, error.status);
    console.error('support_slack_events_failed');
    return json({ error: 'UNAVAILABLE' }, 503);
  }
}
