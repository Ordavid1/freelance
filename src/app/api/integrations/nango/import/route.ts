import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { integrationId, nangoJson, safeText, type SocialProvider } from '@/lib/integrations/nango';

export const runtime = 'nodejs';

type NangoConnection = { id: string; provider_config_key?: string; tags?: Record<string, string> };
type ConnectionList = { connections?: NangoConnection[]; data?: { connections?: NangoConnection[] } };

function value(data: Record<string, unknown>, key: string, fallback = ''): string {
  return safeText(data[key], 4000) || fallback;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לייבא פרופיל.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { provider?: unknown; connectionId?: unknown } | null;
  const provider = body?.provider;
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId.trim() : '';
  if ((provider !== 'github' && provider !== 'linkedin') || !connectionId || connectionId.length > 200) {
    return NextResponse.json({ error: 'פרטי החיבור לא תקינים.' }, { status: 400 });
  }

  const key = integrationId(provider as SocialProvider);
  if (!key) return NextResponse.json({ error: 'האינטגרציה עדיין לא הוגדרה.' }, { status: 503 });

  try {
    const params = new URLSearchParams({ 'tags[end_user_id]': user.uid });
    const list = await nangoJson<ConnectionList>(`/connections?${params.toString()}`);
    const connections = list.connections ?? list.data?.connections ?? [];
    const owned = connections.some((connection) => connection.id === connectionId && connection.tags?.end_user_id === user.uid && (!connection.provider_config_key || connection.provider_config_key === key));
    if (!owned) return NextResponse.json({ error: 'לא נמצא חיבור מאושר לחשבון הזה. חברו את החשבון שוב.' }, { status: 403 });

    if (provider === 'github') {
      const userResponse = await nangoJson<Record<string, unknown>>('/proxy/user', {
        headers: { 'Provider-Config-Key': key, 'Connection-Id': connectionId, 'Base-Url-Override': 'https://api.github.com', 'Accept': 'application/vnd.github+json' },
      });
      const login = value(userResponse, 'login');
      const repoResponse = login ? await nangoJson<unknown[]>(`/proxy/users/${encodeURIComponent(login)}/repos?type=owner&sort=updated&per_page=30`, {
        headers: { 'Provider-Config-Key': key, 'Connection-Id': connectionId, 'Base-Url-Override': 'https://api.github.com', 'Accept': 'application/vnd.github+json' },
      }) : [];
      const repositories = Array.isArray(repoResponse) ? repoResponse.filter((repo): repo is Record<string, unknown> => !!repo && typeof repo === 'object').filter((repo) => repo.private !== true).slice(0, 20) : [];
      const url = value(userResponse, 'html_url', login ? `https://github.com/${login}` : '');
      const portfolio = repositories.map((repo) => {
        const repoUrl = safeText(repo.html_url, 500);
        return `${safeText(repo.name, 120)}${safeText(repo.description) ? ` — ${safeText(repo.description, 500)}` : ''}${repoUrl ? ` (${repoUrl})` : ''}`;
      }).join('\n');
      const sourceText = [
        `GitHub profile: ${value(userResponse, 'name', login)}`,
        `Username: ${login}`,
        `Profile URL: ${url}`,
        `Bio: ${value(userResponse, 'bio')}`,
        `Company: ${value(userResponse, 'company')}`,
        `Location: ${value(userResponse, 'location')}`,
        `Blog: ${value(userResponse, 'blog')}`,
        `Public repository count: ${String(userResponse.public_repos ?? '')}`,
        `Recent public repositories:\n${portfolio}`,
      ].filter(Boolean).join('\n').slice(0, 14_000);
      return NextResponse.json({ provider, sourceText, profile: { name: value(userResponse, 'name', login), headline: '', bio: safeText(userResponse.bio, 1500), portfolio, experience: '', education: '', skills: [] }, url });
    }

    const linkedIn = await nangoJson<Record<string, unknown>>('/proxy/v2/userinfo', {
      headers: { 'Provider-Config-Key': key, 'Connection-Id': connectionId, 'Base-Url-Override': 'https://api.linkedin.com' },
    });
    const name = [safeText(linkedIn.given_name, 100), safeText(linkedIn.family_name, 100)].filter(Boolean).join(' ') || safeText(linkedIn.name, 200);
    const profileUrl = safeText(linkedIn.profile, 500);
    const sourceText = [
      `LinkedIn profile: ${name}`,
      `Profile URL: ${profileUrl}`,
      `Headline: ${safeText(linkedIn.headline, 500)}`,
      `Email: ${safeText(linkedIn.email, 200)}`,
    ].filter(Boolean).join('\n').slice(0, 4000);
    return NextResponse.json({ provider, sourceText, profile: { name, headline: safeText(linkedIn.headline, 140), bio: '', portfolio: profileUrl, experience: '', education: '', skills: [] }, url: profileUrl });
  } catch {
    return NextResponse.json({ error: `לא הצלחנו לקרוא את פרטי ${provider === 'github' ? 'GitHub' : 'LinkedIn'}. בדקו את ההרשאות וה־scopes שהוגדרו ב־Nango.` }, { status: 502 });
  }
}
