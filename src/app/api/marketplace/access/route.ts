import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getMembershipAccess } from '@/lib/membership/access';
export const runtime = 'nodejs';
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר.' }, { status: 401 });
  try { return NextResponse.json(await getMembershipAccess(user.uid), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'לא ניתן לטעון את מצב החברות כרגע.' }, { status: 503 }); }
}
