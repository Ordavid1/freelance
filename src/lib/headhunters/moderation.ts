// Moderation decisions on a headhunter record: the vocabulary and the allowed transitions (pure).
import type { HeadhunterStatus } from './types.ts';

export const MODERATION_ACTIONS = ['approve', 'reject', 'suspend', 'reinstate', 'request-changes'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const REASON_MAX = 500;
const REASON_MIN = 3;
const REASON_REQUIRED: readonly ModerationAction[] = ['reject', 'suspend', 'request-changes'];

/** Statuses an action may start from. `reinstate` returns to `approved` only for a record approved before. */
export const ALLOWED_FROM: Record<ModerationAction, readonly HeadhunterStatus[]> = {
  approve: ['pending'],
  reject: ['draft', 'pending', 'approved'],
  suspend: ['pending', 'approved'],
  reinstate: ['suspended', 'rejected'],
  'request-changes': ['pending'],
};

export type DecisionInput = { uid: string; action: ModerationAction; reason?: string };
export type DecisionParse = { ok: true; value: DecisionInput } | { ok: false; code: 'INVALID_DECISION' | 'REASON_REQUIRED' };

const UID = /^[A-Za-z0-9_-]{1,128}$/;

export function parseDecision(input: { uid?: unknown; action?: unknown; reason?: unknown }): DecisionParse {
  const { uid, action, reason } = input;
  if (typeof uid !== 'string' || !UID.test(uid) || !(MODERATION_ACTIONS as readonly unknown[]).includes(action)) return { ok: false, code: 'INVALID_DECISION' };
  if (reason !== undefined && typeof reason !== 'string') return { ok: false, code: 'INVALID_DECISION' };
  const text = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : '';
  if (text.length > REASON_MAX) return { ok: false, code: 'INVALID_DECISION' };
  if (REASON_REQUIRED.includes(action as ModerationAction) && text.length < REASON_MIN) return { ok: false, code: 'REASON_REQUIRED' };
  return { ok: true, value: { uid, action: action as ModerationAction, ...(text ? { reason: text } : {}) } };
}

/** The status after `action`, or null when the action is not allowed from `from`. */
export function nextStatus(action: ModerationAction, from: unknown, approvedBefore: boolean): HeadhunterStatus | null {
  if (!(ALLOWED_FROM[action] as readonly unknown[]).includes(from)) return null;
  switch (action) {
    case 'approve': return 'approved';
    case 'reject': return 'rejected';
    case 'suspend': return 'suspended';
    case 'request-changes': return 'draft';
    case 'reinstate': return from === 'suspended' && approvedBefore ? 'approved' : 'pending';
  }
}
