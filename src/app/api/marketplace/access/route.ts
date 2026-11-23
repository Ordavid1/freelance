import { NextResponse } from 'next/server';
import { getMembershipAccess } from '@/lib/membership/access';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
export const GET = route('membership.access', {}, async ({ user }) => {
  try { return NextResponse.json(await getMembershipAccess(user.uid), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'לא ניתן לטעון את מצב החברות כרגע.' }, { status: 503 }); }
});
