import { NextResponse } from 'next/server';
import { integrationId, nangoApiKey, nangoJson, ownedNangoConnections } from '@/lib/integrations/nango';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';

export const GET = route('nango.connections.list', {}, async ({ user }) => {
  if (!nangoApiKey()) return NextResponse.json({ connections: [] });

  try {
    const params = new URLSearchParams({ 'tags[end_user_id]': user.uid, limit: '100' });
    const result = await nangoJson<unknown>(`/connections?${params.toString()}`);
    const providers = (['github', 'linkedin'] as const).flatMap((provider) => {
      const key = integrationId(provider);
      if (!key) return [];
      const connection = ownedNangoConnections(result, user.uid, key)[0];
      return connection ? [{ provider, connectionId: connection.connectionId }] : [];
    });
    return NextResponse.json({ connections: providers }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לטעון חיבורים קיימים.' }, { status: 502 });
  }
});

export const DELETE = route('nango.connections.delete', {}, async ({ request, user }) => {
  const provider = new URL(request.url).searchParams.get('provider');
  const connectionId = new URL(request.url).searchParams.get('connectionId') || '';
  if ((provider !== 'github' && provider !== 'linkedin') || !/^[A-Za-z0-9_-]{1,200}$/.test(connectionId)) return NextResponse.json({ error: 'פרטי החיבור לא תקינים.' }, { status: 400 });
  const key = integrationId(provider);
  if (!key || !nangoApiKey()) return NextResponse.json({ error: 'האינטגרציה עדיין לא הוגדרה.' }, { status: 503 });
  try {
    const params = new URLSearchParams({ 'tags[end_user_id]': user.uid, limit: '100' });
    const result = await nangoJson<unknown>(`/connections?${params.toString()}`);
    const owned = ownedNangoConnections(result, user.uid, key).some((item) => item.connectionId === connectionId);
    if (!owned) return NextResponse.json({ error: 'החיבור לא שייך לחשבון הזה.' }, { status: 403 });
    const deleteParams = new URLSearchParams({ provider_config_key: key });
    await nangoJson(`/connections/${encodeURIComponent(connectionId)}?${deleteParams.toString()}`, { method: 'DELETE' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לנתק את החשבון כרגע.' }, { status: 502 });
  }
});
