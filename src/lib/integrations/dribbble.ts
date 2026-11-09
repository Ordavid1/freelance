import 'server-only';
import { randomBytes } from 'node:crypto';

export const DRIBBBLE_STATE_COOKIE = 'dribbble_oauth_state';
export const DRIBBBLE_STATE_TTL_SECONDS = 10 * 60;
const CALLBACK_PATH = '/api/integrations/dribbble/callback';

export type DribbbleImport = {
  provider: 'dribbble';
  sourceText: string;
  profile: {
    name: string;
    headline: string;
    bio: string;
    skills: string[];
    portfolio: string;
    experience: string;
    education: string;
  };
  url: string;
};

type DribbbleConfig = { clientId: string; clientSecret: string; redirectUri: string };
type OAuthState = { state: string; uid: string; expiresAt: number };

export function dribbbleConfig(): DribbbleConfig | null {
  const clientId = process.env.DRIBBBLE_CLIENT_ID?.trim();
  const clientSecret = process.env.DRIBBBLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.DRIBBBLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || url.pathname !== CALLBACK_PATH || url.search || url.hash || url.username || url.password) return null;
  } catch {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

export function createDribbbleOAuthState(uid: string) {
  const state = randomBytes(32).toString('base64url');
  const payload: OAuthState = { state, uid, expiresAt: Date.now() + DRIBBBLE_STATE_TTL_SECONDS * 1000 };
  return { state, cookieValue: Buffer.from(JSON.stringify(payload)).toString('base64url') };
}

export function validateDribbbleOAuthState(cookieValue: string | undefined, state: string | null, uid: string): boolean {
  if (!cookieValue || !state || state.length > 200) return false;
  try {
    const payload = JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8')) as Partial<OAuthState>;
    return payload.state === state && payload.uid === uid && typeof payload.expiresAt === 'number' && payload.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export function cleanDribbbleText(value: unknown, max = 1000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/&lt;script\b[^&]*&gt;[\s\S]*?&lt;\/script\s*&gt;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;[^&]*&gt;/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function dribbbleUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['dribbble.com', 'www.dribbble.com'].includes(url.hostname)) return '';
    return `${url.origin}${url.pathname}`.slice(0, 600);
  } catch {
    return '';
  }
}

export async function exchangeDribbbleCode(code: string): Promise<string> {
  const config = dribbbleConfig();
  if (!config || !code || code.length > 2048) throw new Error('Dribbble OAuth is not configured');
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
  const response = await fetch('https://dribbble.com/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Dribbble token exchange failed');
  const result = await response.json().catch(() => null) as { access_token?: unknown } | null;
  if (typeof result?.access_token !== 'string' || !result.access_token || result.access_token.length > 4096) throw new Error('Dribbble returned no access token');
  return result.access_token;
}

async function dribbbleGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.dribbble.com/v2${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Dribbble profile request failed');
  return response.json() as Promise<T>;
}

export async function fetchDribbbleImport(accessToken: string): Promise<DribbbleImport> {
  const [user, rawShots] = await Promise.all([
    dribbbleGet<Record<string, unknown>>('/user', accessToken),
    dribbbleGet<unknown>('/user/shots?per_page=20', accessToken),
  ]);
  if (!Array.isArray(rawShots)) throw new Error('Dribbble shots response is invalid');

  const login = cleanDribbbleText(user.login, 80);
  const fallbackUrl = /^[A-Za-z0-9_-]+$/.test(login) ? `https://dribbble.com/${login}` : '';
  const url = dribbbleUrl(user.html_url) || fallbackUrl;
  const name = cleanDribbbleText(user.name, 120) || login;
  const bio = cleanDribbbleText(user.bio, 1500);
  const location = cleanDribbbleText(user.location, 120);
  const website = typeof user.links === 'object' && user.links !== null
    ? cleanDribbbleText((user.links as Record<string, unknown>).web, 300)
    : '';

  const shots = rawShots.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const shot = item as Record<string, unknown>;
    // The API includes scheduled shots without `published_at`; only import published work.
    if (typeof shot.published_at !== 'string' || shot.scheduled_for) return [];
    const shotUrl = dribbbleUrl(shot.html_url);
    const title = cleanDribbbleText(shot.title, 140);
    if (!shotUrl || !title) return [];
    const description = cleanDribbbleText(shot.description, 350);
    const tags = Array.isArray(shot.tags) ? shot.tags.map((tag) => cleanDribbbleText(tag, 60)).filter(Boolean).slice(0, 12) : [];
    return [{ title, description, url: shotUrl, tags }];
  });
  const skills = [...new Set(shots.flatMap((shot) => shot.tags))].slice(0, 20);
  const portfolio = shots.map((shot) => `${shot.title}${shot.description ? ` — ${shot.description}` : ''} (${shot.url})`).join('\n').slice(0, 4000);
  const sourceText = [
    `Dribbble profile: ${name}`,
    `Username: ${login}`,
    `Profile URL: ${url}`,
    bio ? `Bio: ${bio}` : '',
    location ? `Location: ${location}` : '',
    website ? `Website: ${website}` : '',
    `Recent public shots:\n${portfolio || 'No published shots returned.'}`,
    skills.length ? `Shot tags: ${skills.join(', ')}` : '',
  ].filter(Boolean).join('\n').slice(0, 14_000);

  return {
    provider: 'dribbble',
    sourceText,
    profile: { name, headline: '', bio, skills, portfolio, experience: '', education: '' },
    url,
  };
}
