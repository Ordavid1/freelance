import 'server-only';

export type SocialProvider = 'github' | 'linkedin';

export const nangoBaseUrl = 'https://api.nango.dev';

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
