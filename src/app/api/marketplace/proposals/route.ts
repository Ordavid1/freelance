import { enforceActionLimit } from '@/lib/security/rate-limit';
import { readJsonBody } from '@/lib/security/request-body';
import { requireMarketplaceAccess } from '@/lib/membership/access';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { getProject } from '@/lib/data';

export const runtime = 'nodejs';

function timestampMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בהצעות.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const projectSlug = params.get('projectSlug');
  if (projectSlug !== null && !/^[a-zA-Z0-9_-]{1,80}$/.test(projectSlug)) return NextResponse.json({ error: 'הפרויקט לא נמצא.' }, { status: 404 });
  try {
    if (projectSlug) {
      const project = await firestore().collection('projects').doc(projectSlug).get();
      if (!project.exists || project.get('ownerUid') !== user.uid) return NextResponse.json({ error: 'הפרויקט לא נמצא.' }, { status: 404 });
      const snapshot = await firestore().collection('proposals').where('projectSlug', '==', projectSlug).limit(100).get();
      const proposals = snapshot.docs.map((doc) => ({ id: doc.id, conversationId: doc.id, ...doc.data() }));
      return NextResponse.json({ proposals }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const [sentSnapshot, demoSnapshot] = await Promise.all([
      firestore().collection('proposals').where('freelancerUid', '==', user.uid).limit(100).get(),
      firestore().collection('demo-proposals').where('freelancerUid', '==', user.uid).limit(100).get(),
    ]);
    const proposals = [...sentSnapshot.docs, ...demoSnapshot.docs]
      .map((doc) => {
        const record = doc.data();
        const isDemo = record.isDemo === true;
        return {
          id: doc.id,
          conversationId: isDemo ? '' : doc.id,
          projectSlug: typeof record.projectSlug === 'string' ? record.projectSlug : '',
          projectTitle: typeof record.projectTitle === 'string' ? record.projectTitle : '',
          message: typeof record.message === 'string' ? record.message : typeof record.text === 'string' ? record.text : '',
          freelancerName: typeof record.freelancerName === 'string' ? record.freelancerName : '',
          amount: typeof record.amount === 'number' ? record.amount : 0,
          currency: typeof record.currency === 'string' ? record.currency : 'ILS',
          pricingType: typeof record.pricingType === 'string' ? record.pricingType : 'fixed',
          delivery: typeof record.delivery === 'string' ? record.delivery : '',
          status: isDemo ? 'test' : typeof record.status === 'string' ? record.status : 'submitted',
          isDemo,
          createdAt: timestampMillis(record.createdAt),
        };
      })
      .filter((proposal) => proposal.message.trim().length > 0)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 100);
    return NextResponse.json({ proposals }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון הצעות כרגע.' }, { status: 503 });
  }
}

async function savePracticeProposal(db: ReturnType<typeof firestore>, uid: string, input: { projectSlug: string; projectTitle: string; message: string; amount: number; pricingType: unknown; delivery: string }) {
  try {
    const demoProposalId = createHash('sha256').update(`${input.projectSlug}:${uid}`).digest('hex');
    await db.collection('demo-proposals').doc(demoProposalId).set({
      projectSlug: input.projectSlug,
      projectTitle: input.projectTitle,
      freelancerUid: uid,
      message: input.message,
      amount: input.amount,
      currency: 'ILS',
      pricingType: input.pricingType,
      delivery: input.delivery,
      status: 'test',
      isDemo: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true, demo: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לשמור את הצעת הבדיקה.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לשלוח הצעה.' }, { status: 401 });
  const denied = await requireMarketplaceAccess(user.uid); if (denied) return denied;
  const limited = await enforceActionLimit(user.uid, 'proposal.create');
  if (limited) return limited;
  const parsedBody = await readJsonBody(request, 16_000);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value as Record<string, unknown> | null;
  const projectSlug = body?.projectSlug;
  const message = body?.message;
  const delivery = body?.delivery;
  const amount = Number(body?.amount);
  const pricingType = body?.pricingType;
  if (typeof projectSlug !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(projectSlug) || typeof message !== 'string' || message.trim().length < 20 || message.length > 4000 || typeof delivery !== 'string' || delivery.trim().length < 2 || delivery.length > 120 || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000 || (pricingType !== 'fixed' && pricingType !== 'hourly')) {
    return NextResponse.json({ error: 'בדקו את המחיר, זמן האספקה ותוכן ההצעה.' }, { status: 400 });
  }

  const db = firestore();
  // A sample project (static or persisted in Firestore) has no client: its bids stay private to the freelancer.
  const staticProject = getProject(projectSlug);
  let sampleTitle: string | null = staticProject?.sample ? staticProject.title : null;
  if (sampleTitle === null && !staticProject) {
    try {
      const existingProject = await db.collection('projects').doc(projectSlug).get();
      if (existingProject.exists && existingProject.get('sample') === true) {
        const storedTitle = existingProject.get('title');
        sampleTitle = typeof storedTitle === 'string' ? storedTitle : '';
      }
    } catch {
      return NextResponse.json({ error: 'לא הצלחנו לשלוח את ההצעה.' }, { status: 503 });
    }
  }
  if (sampleTitle !== null) return savePracticeProposal(db, user.uid, { projectSlug, projectTitle: sampleTitle, message: message.trim(), amount, pricingType, delivery: delivery.trim() });

  const projectRef = db.collection('projects').doc(projectSlug);
  const proposalId = createHash('sha256').update(`${projectSlug}:${user.uid}`).digest('hex');
  const proposalRef = db.collection('proposals').doc(proposalId);
  const conversationRef = db.collection('conversations').doc(proposalId);
  const initialMessageRef = conversationRef.collection('messages').doc('proposal');
  try {
    await db.runTransaction(async (transaction) => {
      const [project, existing] = await Promise.all([transaction.get(projectRef), transaction.get(proposalRef)]);
      if (!project.exists || project.get('status') !== 'open') throw new Error('PROJECT_CLOSED');
      if (project.get('sample') === true) throw new Error('SAMPLE_PROJECT');
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
    if (reason === 'SAMPLE_PROJECT') return NextResponse.json({ error: 'אי אפשר לשלוח הצעה ללקוח/ה בפרויקט השראה.' }, { status: 409 });
    if (reason === 'PROJECT_CLOSED') return NextResponse.json({ error: 'הפרויקט כבר אינו פתוח להצעות.' }, { status: 409 });
    return NextResponse.json({ error: 'לא הצלחנו לשלוח את ההצעה.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לבטל הצעה.' }, { status: 401 });
  const parsedBody = await readJsonBody(request, 4_096);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value;
  if (typeof body?.proposalId !== 'string' || !/^[a-f0-9]{64}$/.test(body.proposalId)) return NextResponse.json({ error: 'הצעה לא תקינה.' }, { status: 400 });
  const proposalId = body.proposalId;
  const db = firestore();
  try {
    await db.runTransaction(async transaction => {
      const ref = db.collection('proposals').doc(proposalId);
      const proposal = await transaction.get(ref);
      if (!proposal.exists || proposal.get('freelancerUid') !== user.uid) throw new Error('NOT_FOUND');
      if (proposal.get('status') === 'withdrawn') return;
      if (proposal.get('status') !== 'submitted') throw new Error('INVALID_STATUS');
      const projectRef = db.collection('projects').doc(proposal.get('projectSlug'));
      const project = await transaction.get(projectRef);
      transaction.update(ref, { status: 'withdrawn', updatedAt: FieldValue.serverTimestamp() });
      if (project.exists) transaction.update(projectRef, { proposals: Math.max(0, Number(project.get('proposals') || 0) - 1), updatedAt: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : '';
    return NextResponse.json({ error: reason === 'NOT_FOUND' ? 'ההצעה לא נמצאה.' : reason === 'INVALID_STATUS' ? 'לא ניתן לבטל את ההצעה במצב הנוכחי.' : 'ביטול ההצעה נכשל.' }, { status: reason === 'NOT_FOUND' ? 404 : reason === 'INVALID_STATUS' ? 409 : 503 });
  }
}
