import { readJsonBody } from '@/lib/security/request-body';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { integrationId, nangoApiKey, nangoJson, type SocialProvider } from '@/lib/integrations/nango';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לחבר חשבון.' }, { status: 401 });

  const parsedBody = await readJsonBody(request, 4_096);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value as { provider?: unknown } | null;
  const provider = body?.provider;
  if (provider !== 'github' && provider !== 'linkedin') {
    return NextResponse.json({ error: 'ספק החיבור לא תקין.' }, { status: 400 });
  }

  const configuredIntegrationId = integrationId(provider as SocialProvider);
  if (!nangoApiKey() || !configuredIntegrationId) {
    return NextResponse.json({ error: `חיבור ${provider === 'github' ? 'GitHub' : 'LinkedIn'} עדיין לא הוגדר ב־Nango.` }, { status: 503 });
  }

  try {
    const response = await nangoJson<{ data?: { token?: string }; token?: string }>('/connect/sessions', {
      method: 'POST',
      body: JSON.stringify({
        tags: { end_user_id: user.uid, end_user_email: user.email ?? '' },
        allowed_integrations: [configuredIntegrationId],
      }),
    });
    const token = response.data?.token ?? response.token;
    if (!token) throw new Error('Nango did not return a session token');
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו להתחיל חיבור מאובטח ל־Nango. בדקו שהאינטגרציה פעילה ונסו שוב.' }, { status: 502 });
  }
}
