import 'server-only';

export type SlackConfig = { botToken: string; signingSecret: string; channelId: string; agentIds: string[] };

const OFF = new Set(['off', 'false', '0', 'disabled']);
const CHANNEL = /^[CG][A-Z0-9]{6,}$/;
const USER = /^[UW][A-Z0-9]{6,}$/;

function switchedOff(value: string | undefined) {
  return OFF.has((value ?? '').trim().toLowerCase());
}

// Null unless every Slack setting is valid and the kill switch is not set, so the feature stays off by default.
export function supportSlackConfig(env: Record<string, string | undefined> = process.env): SlackConfig | null {
  if (switchedOff(env.SUPPORT_SLACK)) return null;
  const botToken = env.SLACK_BOT_TOKEN?.trim();
  const signingSecret = env.SLACK_SIGNING_SECRET?.trim();
  const channelId = env.SUPPORT_SLACK_CHANNEL_ID?.trim();
  const agentIds = (env.SUPPORT_SLACK_AGENT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!botToken || !botToken.startsWith('xoxb-') || !signingSecret) return null;
  if (!channelId || !CHANNEL.test(channelId)) return null;
  if (!agentIds.length || !agentIds.every((id) => USER.test(id))) return null;
  return { botToken, signingSecret, channelId, agentIds: [...new Set(agentIds)] };
}

// Unset means on. When Slack is configured the caller skips the per-message inbox email if this is false.
export function emailNotifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !switchedOff(env.SUPPORT_EMAIL_NOTIFY);
}

export function isAgent(config: SlackConfig, userId: unknown): boolean {
  return typeof userId === 'string' && config.agentIds.includes(userId);
}
