import { enforceActionLimit } from '@/lib/security/rate-limit';
import { readJsonBody } from '@/lib/security/request-body';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';

export const runtime = 'nodejs';

function belongsTo(data: FirebaseFirestore.DocumentData, uid: string) {
  return data.clientUid === uid || data.freelancerUid === uid;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בשיחות.' }, { status: 401 });
  const db = firestore();
  const id = new URL(request.url).searchParams.get('id');
  try {
    if (id) {
      if (!/^[a-f0-9]{64}$/i.test(id)) return NextResponse.json({ error: 'השיחה לא נמצאה.' }, { status: 404 });
      const ref = db.collection('conversations').doc(id);
      const conversation = await ref.get();
      if (!conversation.exists || !belongsTo(conversation.data()!, user.uid)) return NextResponse.json({ error: 'השיחה לא נמצאה.' }, { status: 404 });
      const messages = await ref.collection('messages').orderBy('createdAt', 'asc').limit(200).get();
      return NextResponse.json({
        conversation: { id: conversation.id, ...conversation.data() },
        messages: messages.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const [asClient, asFreelancer] = await Promise.all([
      db.collection('conversations').where('clientUid', '==', user.uid).limit(100).get(),
      db.collection('conversations').where('freelancerUid', '==', user.uid).limit(100).get(),
    ]);
    const byId = new Map<string, Record<string, unknown>>([...asClient.docs, ...asFreelancer.docs].map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const conversations = [...byId.values()].sort((a, b) => {
      const aDate = (a.lastMessageAt as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
      const bDate = (b.lastMessageAt as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
      return bDate - aDate;
    });
    return NextResponse.json({ conversations }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון שיחות כרגע.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לשלוח הודעה.' }, { status: 401 });
  const limited = await enforceActionLimit(user.uid, 'message.send');
  if (limited) return limited;
  const parsedBody = await readJsonBody(request, 8_000);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value as { conversationId?: unknown; text?: unknown } | null;
  const conversationId = body?.conversationId;
  const text = body?.text;
  if (typeof conversationId !== 'string' || !/^[a-f0-9]{64}$/i.test(conversationId) || typeof text !== 'string' || text.trim().length < 1 || text.length > 4000) {
    return NextResponse.json({ error: 'פרטי ההודעה לא תקינים.' }, { status: 400 });
  }
  const db = firestore();
  const conversationRef = db.collection('conversations').doc(conversationId);
  const messageRef = conversationRef.collection('messages').doc(randomUUID());
  const senderName = user.name || user.email?.split('@')[0] || 'משתמש/ת';
  try {
    await db.runTransaction(async (transaction) => {
      const conversation = await transaction.get(conversationRef);
      const data = conversation.data();
      if (!data || !belongsTo(data, user.uid)) throw new Error('NOT_FOUND');
      transaction.create(messageRef, { senderUid: user.uid, senderName, text: text.trim(), kind: 'message', createdAt: FieldValue.serverTimestamp() });
      transaction.update(conversationRef, { lastMessage: text.trim(), lastMessageAt: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') return NextResponse.json({ error: 'השיחה לא נמצאה.' }, { status: 404 });
    return NextResponse.json({ error: 'לא הצלחנו לשלוח את ההודעה.' }, { status: 503 });
  }
}
