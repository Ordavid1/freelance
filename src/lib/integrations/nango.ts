import 'server-only';

export type SocialProvider = 'github' | 'linkedin';

export const nangoBaseUrl = 'https://api.nango.dev';

export function ownedNangoConnections(payload: unknown, uid: string, integrationKey: string): { connectionId: string }[] {
  if (!payload || typeof payload !== 'object') return [];
  const result = payload as { connections?: unknown; data?: { connections?: unknown } };
  const rows = result.connections ?? result.data?.connections;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as { connection_id?: unknown; id?: unknown; provider_config_key?: unknown; providerConfigKey?: unknown; tags?: Record<string, unknown> };
    // Current Nango responses use numeric `id` for the internal database row.
    // OAuth/proxy requests use `connection_id`; string `id` supports older APIs.
    const id = item.connection_id ?? item.id;
    if (typeof id !== 'string' || !id || id.length > 200 || item.tags?.end_user_id !== uid
      || (item.provider_config_key ?? item.providerConfigKey) !== integrationKey) return [];
    return [{ connectionId: id }];
  });
}

export function integrationId(provider: SocialProvider) {
  const value = process.env[provider === 'github' ? 'NANGO_GITHUB_INTEGRATION_ID' : 'NANGO_LINKEDIN_INTEGRATION_ID'];
  return value?.trim() || null;
}

export function nangoApiKey() {
  return process.env.NANGO_API_KEY?.trim() || null;
}

export function nangoHeaders() {
  const apiKey = nangoApiKey();
  if (!apiKey) throw new Error('Nango is not configured');
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

export async function nangoJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${nangoBaseUrl}${path}`, {
    ...init,
    headers: { ...nangoHeaders(), ...init?.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Nango request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function safeText(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
