import { NextResponse } from 'next/server';
import { integrationId, nangoApiKey, nangoJson, type SocialProvider } from '@/lib/integrations/nango';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';

export const POST = route('nango.session', { body: { type: 'json', maxBytes: 4_096 } }, async ({ user, body: input }) => {
  const body = input as { provider?: unknown } | null;
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
});
