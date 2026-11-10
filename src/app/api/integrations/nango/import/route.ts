import { readJsonBody } from '@/lib/security/request-body';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { integrationId, nangoJson, ownedNangoConnections, safeText, type SocialProvider } from '@/lib/integrations/nango';

export const runtime = 'nodejs';

function value(data: Record<string, unknown>, key: string, fallback = ''): string {
  return safeText(data[key], 4000) || fallback;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לייבא פרופיל.' }, { status: 401 });
  const parsedBody = await readJsonBody(request, 4_096);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value as { provider?: unknown; connectionId?: unknown } | null;
  const provider = body?.provider;
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId.trim() : '';
  if ((provider !== 'github' && provider !== 'linkedin') || !connectionId || connectionId.length > 200) {
    return NextResponse.json({ error: 'פרטי החיבור לא תקינים.' }, { status: 400 });
  }

  const key = integrationId(provider as SocialProvider);
  if (!key) return NextResponse.json({ error: 'האינטגרציה עדיין לא הוגדרה.' }, { status: 503 });

  try {
    const params = new URLSearchParams({ 'tags[end_user_id]': user.uid, limit: '100' });
    const list = await nangoJson<unknown>(`/connections?${params.toString()}`);
    const owned = ownedNangoConnections(list, user.uid, key).some((connection) => connection.connectionId === connectionId);
    if (!owned) return NextResponse.json({ error: 'לא נמצא חיבור מאושר לחשבון הזה. חברו את החשבון שוב.' }, { status: 403 });

    if (provider === 'github') {
      const userResponse = await nangoJson<Record<string, unknown>>('/proxy/user', {
        headers: { 'Provider-Config-Key': key, 'Connection-Id': connectionId, 'Base-Url-Override': 'https://api.github.com', 'Accept': 'application/vnd.github+json' },
      });
      const login = value(userResponse, 'login');
      const url = value(userResponse, 'html_url', login ? `https://github.com/${login}` : '');
      const sourceText = [
        `GitHub profile: ${value(userResponse, 'name', login)}`,
        `Username: ${login}`,
        `Profile URL: ${url}`,
        `Bio: ${value(userResponse, 'bio')}`,
        `Company: ${value(userResponse, 'company')}`,
        `Location: ${value(userResponse, 'location')}`,
        `Blog: ${value(userResponse, 'blog')}`,
      ].filter(Boolean).join('\n').slice(0, 14_000);
      return NextResponse.json({ provider, sourceText, profile: { name: value(userResponse, 'name', login), headline: '', bio: safeText(userResponse.bio, 1500), portfolio: '', experience: '', education: '', skills: [] }, url });
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
