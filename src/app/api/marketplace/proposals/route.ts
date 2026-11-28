import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { firestore } from '@/lib/db/firestore';
import { getProject } from '@/lib/data';
import { route } from '@/lib/security/policy';
import { employmentTypeOf, requiresQuote } from '@/lib/projects/employment';
import { assertContactAllowed, ContactUnavailable } from '@/lib/security/marketplace-policy';

export const runtime = 'nodejs';

function timestampMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

export const GET = route('proposal.list', {}, async ({ request, user }) => {
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
          employmentType: record.employmentType === 'employee' ? 'employee' : 'freelance',
          delivery: typeof record.delivery === 'string' ? record.delivery : '',
          status: isDemo ? 'test' : typeof record.status === 'string' ? record.status : 'submitted',
          isDemo,
          privateFromPublic: record.privateFromPublic === true,
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
});

async function savePracticeProposal(db: ReturnType<typeof firestore>, uid: string, input: { projectSlug: string; projectTitle: string; message: string; amount: number; pricingType: unknown; delivery: string; privateFromPublic: boolean }) {
  try {
    const demoProposalId = createHash('sha256').update(`${input.projectSlug}:${uid}`).digest('hex');
    await db.collection('demo-proposals').doc(demoProposalId).set({
      projectSlug: input.projectSlug,
      projectTitle: input.projectTitle,
      freelancerUid: uid,
      message: input.message,
      privateFromPublic: input.privateFromPublic,
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

export const POST = route('proposal.create', { body: { type: 'json', maxBytes: 16_000 } }, async ({ user, body: input }) => {
  const body = input as Record<string, unknown> | null;
  const projectSlug = body?.projectSlug;
  const message = body?.message;
  const delivery = body?.delivery;
  const amount = Number(body?.amount);
  const pricingType = body?.pricingType;
  const privateFromPublic = body?.privateFromPublic;
  // Quote fields are required for freelance projects only. The project's own employment type decides, never the client:
  // it is read below (sample and static projects are freelance), so a quote-less request cannot reach a freelance project.
  const quoteValid = typeof delivery === 'string' && delivery.trim().length >= 2 && delivery.length <= 120 && Number.isFinite(amount) && amount > 0 && amount <= 100_000_000 && (pricingType === 'fixed' || pricingType === 'hourly');
  if (typeof projectSlug !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(projectSlug) || typeof message !== 'string' || message.trim().length < 20 || message.length > 4000 || (pricingType !== undefined && pricingType !== 'fixed' && pricingType !== 'hourly') || (privateFromPublic !== undefined && typeof privateFromPublic !== 'boolean')) {
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
  if (sampleTitle !== null && !quoteValid) return NextResponse.json({ error: 'בדקו את המחיר, זמן האספקה ותוכן ההצעה.' }, { status: 400 });
  if (sampleTitle !== null) return savePracticeProposal(db, user.uid, { projectSlug, projectTitle: sampleTitle, message: message.trim(), amount, pricingType, delivery: (delivery as string).trim(), privateFromPublic: privateFromPublic === true });

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
      const employmentType = employmentTypeOf({ employmentType: project.get('employmentType') });
      if (requiresQuote(employmentType) && !quoteValid) throw new Error('INVALID_QUOTE');
      await assertContactAllowed(transaction, user.uid, project.get('ownerUid'));
      // An employee application is a message only: no amount, delivery time or pricing model is stored.
      const quote = requiresQuote(employmentType) ? { amount, pricingType, delivery: (delivery as string).trim() } : { amount: 0, pricingType: 'none', delivery: '' };
      const proposal = {
        projectSlug, projectTitle: project.get('title'), clientUid: project.get('ownerUid'), freelancerUid: user.uid,
        freelancerName: user.name || user.email?.split('@')[0] || 'פרילנסר/ית', ...quote, currency: 'ILS', employmentType,
        message: message.trim(), privateFromPublic: privateFromPublic === true, status: 'submitted', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
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
    if (error instanceof ContactUnavailable) return NextResponse.json({ code: 'CONTACT_UNAVAILABLE', error: 'לא ניתן ליצור קשר זה כרגע.' }, { status: 403 });
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'INVALID_QUOTE') return NextResponse.json({ error: 'בדקו את המחיר, זמן האספקה ותוכן ההצעה.' }, { status: 400 });
    if (reason === 'DUPLICATE_PROPOSAL') return NextResponse.json({ error: 'כבר שלחתם הצעה לפרויקט הזה.' }, { status: 409 });
    if (reason === 'OWN_PROJECT') return NextResponse.json({ error: 'אי אפשר להציע הצעה לפרויקט שפרסמתם.' }, { status: 403 });
    if (reason === 'SAMPLE_PROJECT') return NextResponse.json({ error: 'אי אפשר לשלוח הצעה ללקוח/ה בפרויקט השראה.' }, { status: 409 });
    if (reason === 'PROJECT_CLOSED') return NextResponse.json({ error: 'הפרויקט כבר אינו פתוח להצעות.' }, { status: 409 });
    return NextResponse.json({ error: 'לא הצלחנו לשלוח את ההצעה.' }, { status: 503 });
  }
});

export const PATCH = route('proposal.withdraw', { body: { type: 'json', maxBytes: 4_096 } }, async ({ user, body }) => {
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
});
