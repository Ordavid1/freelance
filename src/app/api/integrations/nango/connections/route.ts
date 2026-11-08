import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { integrationId, nangoApiKey, nangoJson } from '@/lib/integrations/nango';

export const runtime = 'nodejs';

type Connection = { id?: unknown; provider_config_key?: unknown; providerConfigKey?: unknown; tags?: Record<string, string> };
type ConnectionList = { connections?: Connection[]; data?: { connections?: Connection[] } };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בחיבורים.' }, { status: 401 });
  if (!nangoApiKey()) return NextResponse.json({ connections: [] });

  try {
    const params = new URLSearchParams({ 'tags[end_user_id]': user.uid });
    const result = await nangoJson<ConnectionList>(`/connections?${params.toString()}`);
    const connections = result.connections ?? result.data?.connections ?? [];
    const providers = (['github', 'linkedin'] as const).flatMap((provider) => {
      const key = integrationId(provider);
      if (!key) return [];
      const connection = connections.find((item) => item.tags?.end_user_id === user.uid && (item.provider_config_key ?? item.providerConfigKey) === key && typeof item.id === 'string');
      return connection && typeof connection.id === 'string' ? [{ provider, connectionId: connection.id }] : [];
    });
    return NextResponse.json({ connections: providers }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לטעון חיבורים קיימים.' }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לנתק חיבור.' }, { status: 401 });
  const provider = new URL(request.url).searchParams.get('provider');
  const connectionId = new URL(request.url).searchParams.get('connectionId') || '';
  if ((provider !== 'github' && provider !== 'linkedin') || !/^[A-Za-z0-9_-]{1,200}$/.test(connectionId)) return NextResponse.json({ error: 'פרטי החיבור לא תקינים.' }, { status: 400 });
  const key = integrationId(provider);
  if (!key || !nangoApiKey()) return NextResponse.json({ error: 'האינטגרציה עדיין לא הוגדרה.' }, { status: 503 });
  try {
    const params = new URLSearchParams({ 'tags[end_user_id]': user.uid });
    const result = await nangoJson<ConnectionList>(`/connections?${params.toString()}`);
    const connections = result.connections ?? result.data?.connections ?? [];
    const owned = connections.some((item) => item.id === connectionId && item.tags?.end_user_id === user.uid && (item.provider_config_key ?? item.providerConfigKey) === key);
    if (!owned) return NextResponse.json({ error: 'החיבור לא שייך לחשבון הזה.' }, { status: 403 });
    const deleteParams = new URLSearchParams({ provider_config_key: key });
    await nangoJson(`/connections/${encodeURIComponent(connectionId)}?${deleteParams.toString()}`, { method: 'DELETE' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לנתק את החשבון כרגע.' }, { status: 502 });
  }
}
