// Pure Block Kit builders. Every user-supplied value is escaped for mrkdwn and clipped to Slack's limits.
import { escapeSlack } from '@/lib/support/slack/text';

export type Triage = {
  category: 'sales' | 'support' | 'billing' | 'urgent' | 'other';
  urgency: 'low' | 'normal' | 'high';
  language: string;
  summary: string;
  needsHuman: boolean;
  reasons: string[];
};

export type ConversationCard = {
  conversationId: string;
  channel: 'chat' | 'email';
  name: string;
  email: string;
  page?: string;
  subject?: string;
  status: 'open' | 'waiting_on_customer' | 'closed';
  triage?: Triage;
};

const SECTION_LIMIT = 2900;
const HEADER_LIMIT = 150;

// Clips already-escaped text without splitting an entity such as &amp;.
function clip(escaped: string, max = SECTION_LIMIT): string {
  if (escaped.length <= max) return escaped;
  let cut = escaped.slice(0, max - 1);
  const amp = cut.lastIndexOf('&');
  if (amp !== -1 && amp > cut.length - 6 && !cut.slice(amp).includes(';')) cut = cut.slice(0, amp);
  return cut + '…';
}

function section(mrkdwn: string) {
  return { type: 'section', text: { type: 'mrkdwn', text: clip(mrkdwn) } };
}

function context(mrkdwn: string) {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: clip(mrkdwn) }] };
}

function quote(text: string) {
  return escapeSlack(text).split('\n').map((line) => `> ${line}`).join('\n');
}

function button(text: string, actionId: string, value: string, style?: 'primary') {
  return { type: 'button', text: { type: 'plain_text', text, emoji: true }, action_id: actionId, value, ...(style ? { style } : {}) };
}

export function parentCard(card: ConversationCard): { text: string; blocks: unknown[] } {
  const label = card.channel === 'email' ? '✉️ Email' : '💬 Chat';
  const title = `${label} ${card.name}`.slice(0, HEADER_LIMIT);
  const fields = [
    { type: 'mrkdwn', text: clip(`*Email*\n${escapeSlack(card.email)}`) },
    card.channel === 'email' && card.subject
      ? { type: 'mrkdwn', text: clip(`*Subject*\n${escapeSlack(card.subject)}`) }
      : card.page
        ? { type: 'mrkdwn', text: clip(`*Page*\n${escapeSlack(card.page)}`) }
        : null,
    { type: 'mrkdwn', text: `*Status*\n${card.status}` },
    { type: 'mrkdwn', text: `*Conversation*\n${escapeSlack(card.conversationId.slice(0, 8))}` },
  ].filter(Boolean);
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
    { type: 'section', fields },
  ];
  if (card.triage) {
    const t = card.triage;
    blocks.push(section(`*Triage:* ${escapeSlack(t.category)} · ${escapeSlack(t.urgency)} urgency · ${escapeSlack(t.language)}\n${escapeSlack(t.summary)}`));
  }
  blocks.push(card.status === 'closed'
    ? { type: 'actions', elements: [button('Reopen', 'conv_reopen', card.conversationId)] }
    : { type: 'actions', elements: [button('Close', 'conv_close', card.conversationId)] });
  return { text: `${label} ${escapeSlack(card.name)}`, blocks };
}

export function customerMessage(input: { name: string; text: string; mentionIds: string[]; attachmentCount?: number }): { text: string; blocks: unknown[] } {
  const mentions = input.mentionIds.map((id) => `<@${id}>`).join(' ');
  const lead = `${mentions ? mentions + ' ' : ''}*${escapeSlack(input.name)}* wrote:`;
  const blocks: unknown[] = [section(lead), section(quote(input.text))];
  if (input.attachmentCount && input.attachmentCount > 0) {
    const n = input.attachmentCount;
    blocks.push(context(`📎 ${n} attachment${n === 1 ? '' : 's'}, open in Resend`));
  }
  return { text: clip(`${lead}\n${quote(input.text)}`), blocks };
}

export function draftCard(input: { draftId: string; draft: string | null; triage: Triage }): { text: string; blocks: unknown[] } {
  const t = input.triage;
  const blocks: unknown[] = [
    section(`🤖 *AI triage:* ${escapeSlack(t.category)} · ${escapeSlack(t.urgency)} urgency · ${escapeSlack(t.language)}\n${escapeSlack(t.summary)}`),
  ];
  if (t.needsHuman) {
    const reasons = t.reasons.length ? t.reasons.map((r) => escapeSlack(r)).join('; ') : 'no reason given';
    blocks.push(section(`:warning: *Needs a human* — ${reasons}`));
  }
  if (input.draft) {
    blocks.push(section(`*Suggested reply*\n${quote(input.draft)}`));
    blocks.push({
      type: 'actions',
      elements: [
        button('Send', 'draft_send', input.draftId, 'primary'),
        button('Edit', 'draft_edit', input.draftId),
        button('Discard', 'draft_discard', input.draftId),
      ],
    });
  } else {
    blocks.push(context('No draft suggested.'));
  }
  return { text: '🤖 AI draft', blocks };
}

export function draftResolvedCard(input: { draft: string | null; triage: Triage; outcome: 'sent' | 'discarded' | 'superseded'; userId?: string; text?: string }): { text: string; blocks: unknown[] } {
  const who = input.userId ? `<@${escapeSlack(input.userId)}>` : '';
  const verb = input.outcome === 'superseded' ? '↪️ Superseded by a newer draft' : input.outcome === 'sent' ? `✅ Sent by ${who}` : `🗑️ Discarded by ${who}`;
  const body = input.text ?? input.draft;
  const blocks: unknown[] = [
    section(`${verb}\n${escapeSlack(input.triage.category)} · ${escapeSlack(input.triage.urgency)} urgency`),
  ];
  if (body) blocks.push(section(quote(body)));
  const text = input.outcome === 'sent' ? '✅ Reply sent' : input.outcome === 'superseded' ? '↪️ Superseded by a newer draft' : '🗑️ Draft discarded';
  return { text, blocks };
}

// Plain-text input: Slack does not parse mrkdwn here, so the draft is passed through unescaped.
export function editDraftModal(input: { draftId: string; draft: string }): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: 'draft_edit_submit',
    private_metadata: input.draftId,
    title: { type: 'plain_text', text: 'Edit reply' },
    submit: { type: 'plain_text', text: 'Send' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'reply',
        label: { type: 'plain_text', text: 'Reply' },
        element: {
          type: 'plain_text_input',
          action_id: 'text',
          multiline: true,
          max_length: 4000,
          initial_value: input.draft.slice(0, 3000),
        },
      },
    ],
  };
}
