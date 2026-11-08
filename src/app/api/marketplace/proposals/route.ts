import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בהצעות.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const projectSlug = params.get('projectSlug');
  try {
    let snapshot;
    if (projectSlug) {
      const project = await firestore().collection('projects').doc(projectSlug).get();
      if (!project.exists || project.get('ownerUid') !== user.uid) return NextResponse.json({ error: 'הפרויקט לא נמצא.' }, { status: 404 });
      snapshot = await firestore().collection('proposals').where('projectSlug', '==', projectSlug).limit(100).get();
    } else {
      snapshot = await firestore().collection('proposals').where('freelancerUid', '==', user.uid).limit(100).get();
    }
    const proposals = snapshot.docs.map((doc) => ({ id: doc.id, conversationId: doc.id, ...doc.data() }));
    return NextResponse.json({ proposals }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון הצעות כרגע.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לשלוח הצעה.' }, { status: 401 });
  if (Number(request.headers.get('content-length') || 0) > 16_000) return NextResponse.json({ error: 'הבקשה גדולה מדי.' }, { status: 413 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const projectSlug = body?.projectSlug;
  const message = body?.message;
  const delivery = body?.delivery;
  const amount = Number(body?.amount);
  const pricingType = body?.pricingType;
  if (typeof projectSlug !== 'string' || projectSlug.length > 80 || typeof message !== 'string' || message.trim().length < 20 || message.length > 4000 || typeof delivery !== 'string' || delivery.trim().length < 2 || delivery.length > 120 || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000 || !['fixed', 'hourly'].includes(String(pricingType))) {
    return NextResponse.json({ error: 'בדקו את המחיר, זמן האספקה ותוכן ההצעה.' }, { status: 400 });
  }

  const db = firestore();
  const projectRef = db.collection('projects').doc(projectSlug);
  const proposalId = createHash('sha256').update(`${projectSlug}:${user.uid}`).digest('hex');
  const proposalRef = db.collection('proposals').doc(proposalId);
  const conversationRef = db.collection('conversations').doc(proposalId);
  const initialMessageRef = conversationRef.collection('messages').doc('proposal');
  try {
    await db.runTransaction(async (transaction) => {
      const [project, existing] = await Promise.all([transaction.get(projectRef), transaction.get(proposalRef)]);
      if (!project.exists || project.get('status') !== 'open') throw new Error('PROJECT_CLOSED');
      if (project.get('ownerUid') === user.uid) throw new Error('OWN_PROJECT');
      if (existing.exists) throw new Error('DUPLICATE_PROPOSAL');
      const proposal = {
        projectSlug, projectTitle: project.get('title'), clientUid: project.get('ownerUid'), freelancerUid: user.uid,
        freelancerName: user.name || user.email?.split('@')[0] || 'פרילנסר/ית', amount, currency: 'ILS', pricingType,
        delivery: delivery.trim(), message: message.trim(), status: 'submitted', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      };
      transaction.create(proposalRef, proposal);
      transaction.create(conversationRef, {
        projectSlug, projectTitle: project.get('title'), clientUid: project.get('ownerUid'), freelancerUid: user.uid,
        clientName: project.get('clientName') || 'לקוח/ה', freelancerName: proposal.freelancerName,
        lastMessage: message.trim(), lastMessageAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(initialMessageRef, {
        senderUid: user.uid, senderName: proposal.freelancerName, text: message.trim(), kind: 'proposal', createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(projectRef, { proposals: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'DUPLICATE_PROPOSAL') return NextResponse.json({ error: 'כבר שלחתם הצעה לפרויקט הזה.' }, { status: 409 });
    if (reason === 'OWN_PROJECT') return NextResponse.json({ error: 'אי אפשר להציע הצעה לפרויקט שפרסמתם.' }, { status: 403 });
    if (reason === 'PROJECT_CLOSED') return NextResponse.json({ error: 'הפרויקט כבר אינו פתוח להצעות.' }, { status: 409 });
    return NextResponse.json({ error: 'לא הצלחנו לשלוח את ההצעה.' }, { status: 503 });
  }
}
