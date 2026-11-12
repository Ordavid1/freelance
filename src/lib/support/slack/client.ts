import 'server-only';

export class SlackApiError extends Error {
  code: string;
  retryAfterSeconds?: number;
  constructor(code: string, retryAfterSeconds?: number) {
    super(`slack_${code}`);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const METHOD = /^[a-z]+(\.[a-zA-Z]+)+$/;

export async function slackApi<T = Record<string, unknown>>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  if (!METHOD.test(method)) throw new SlackApiError('invalid_method');
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429) throw new SlackApiError('ratelimited', Number(response.headers.get('retry-after')) || 30);
  if (!response.ok) throw new SlackApiError(`http_${response.status}`);
  const json = (await response.json()) as Record<string, unknown>;
  if (json.ok === false) {
    const code = typeof json.error === 'string' ? json.error : 'unknown';
    throw new SlackApiError(code, code === 'ratelimited' ? Number(response.headers.get('retry-after')) || 30 : undefined);
  }
  return json as T;
}

export function postMessage(token: string, input: { channel: string; text: string; blocks?: unknown[]; thread_ts?: string; unfurl_links?: false }) {
  return slackApi<{ ts: string }>(token, 'chat.postMessage', { unfurl_links: false, ...input });
}

export function updateMessage(token: string, input: { channel: string; ts: string; text: string; blocks?: unknown[] }) {
  return slackApi<{ ts: string }>(token, 'chat.update', { ...input });
}

// Reacting twice is harmless, so 'already_reacted' counts as success.
export async function addReaction(token: string, input: { channel: string; timestamp: string; name: string }) {
  try {
    return await slackApi(token, 'reactions.add', { ...input });
  } catch (error) {
    if (error instanceof SlackApiError && error.code === 'already_reacted') return { ok: true, already_reacted: true };
    throw error;
  }
}

export function postEphemeral(token: string, input: { channel: string; user: string; text: string; thread_ts?: string }) {
  return slackApi(token, 'chat.postEphemeral', { ...input });
}

export function openView(token: string, input: { trigger_id: string; view: Record<string, unknown> }) {
  return slackApi(token, 'views.open', { ...input });
}
