import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import type { DribbbleImport } from '@/lib/integrations/dribbble';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בייבוא Dribbble.' }, { status: 401 });
  try {
    const snapshot = await firestore().collection('users').doc(user.uid).collection('profileSources').doc('dribbble').get();
    if (!snapshot.exists || snapshot.get('ownerUid') !== user.uid) return NextResponse.json({ import: null }, { headers: { 'Cache-Control': 'no-store' } });
    const imported = snapshot.get('import') as DribbbleImport | undefined;
    if (!imported || imported.provider !== 'dribbble' || typeof imported.sourceText !== 'string' || imported.sourceText.length > 14_000 || typeof imported.url !== 'string' || !imported.profile || typeof imported.profile !== 'object') {
      return NextResponse.json({ import: null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ import: imported }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לטעון את ייבוא Dribbble.' }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי להסיר ייבוא Dribbble.' }, { status: 401 });
  const ref = firestore().collection('users').doc(user.uid).collection('profileSources').doc('dribbble');
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ ok: true });
    if (snapshot.get('ownerUid') !== user.uid) return NextResponse.json({ error: 'הייבוא אינו שייך לחשבון הזה.' }, { status: 403 });
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו להסיר את ייבוא Dribbble.' }, { status: 503 });
  }
}
