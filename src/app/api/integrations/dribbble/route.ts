import { NextResponse } from 'next/server';
import { firestore } from '@/lib/db/firestore';
import type { DribbbleImport } from '@/lib/integrations/dribbble';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';

export const GET = route('dribbble.read', {}, async ({ user }) => {
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
});

export const DELETE = route('dribbble.disconnect', {}, async ({ user }) => {
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
});
