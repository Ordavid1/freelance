import { accountWriteDenied, assertContactAllowed, ContactUnavailable } from '@/lib/security/marketplace-policy';
import { enforceActionLimit } from '@/lib/security/rate-limit';
import { readJsonBody } from '@/lib/security/request-body';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { applyProjectCreated, invalidateAfterCounter, readHeadhunterForCounter, type CounterOutcome } from '@/lib/db/headhunters';
import { liveMinisiteHandle, minisiteAfterCounter } from '@/lib/headhunters/pings';
import { listFeedProjects, toPublicProject } from '@/lib/db/projects';
import { onProjectClosed, onProjectPublished, type ProjectEventRecord } from '@/lib/projects/events';
import { validateImportProvenance, validateProjectInput } from '@/lib/projects/validation';
import { importErrorResponse, ImportError } from '@/lib/imports/errors';
import { isXPlaceImportEnabled } from '@/lib/imports/flag';
import type { ProjectImportSource } from '@/lib/imports/types';
import { matchPublisher } from '@/lib/imports/xplace/publisher-match';
import { xplaceProjectKey } from '@/lib/imports/xplace/urls';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('mine') === '1') {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לצפות בפרויקטים שלך.' }, { status: 401 });
      const snapshot = await firestore().collection('projects').where('ownerUid', '==', user.uid).limit(100).get();
      // An archived project is withdrawn from the product (no feed card, no page), so it also leaves its owner's list.
      const items = snapshot.docs.filter((doc) => doc.data().status !== 'archived').map((doc) => toPublicProject(doc.id, doc.data())).sort((a, b) => a.title.localeCompare(b.title));
      return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const items = await listFeedProjects();
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לטעון פרויקטים כרגע.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לפרסם פרויקט.' }, { status: 401 });
  const limited = await enforceActionLimit(user.uid, 'project.create');
  if (limited) return limited;
  const accountDenied = await accountWriteDenied(user.uid); if (accountDenied) return accountDenied;
  const parsedBody = await readJsonBody(request, 24_000);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value as Record<string, unknown> | null;
  const input = validateProjectInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const { title, category, description, budget, deadline, skills } = input.value;
  const slug = randomUUID();
  if (body?.import !== undefined) return publishImportedProject(user, slug, body.import, input.value);
  // Built field by field: client input can never set sample/seed/status markers.
  const record = {
    title, category, description, budget, deadline, skills,
    ownerUid: user.uid, clientName: user.name || user.email?.split('@')[0] || 'לקוח/ה', status: 'open', proposals: 0,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
  try {
    // One transaction: the project and, when the owner is a headhunter, the published-project counter.
    const db = firestore();
    let counter: CounterOutcome | null = null;
    let minisite: string | null = null;
    await db.runTransaction(async (transaction) => {
      counter = null;
      const headhunter = await readHeadhunterForCounter(transaction, user.uid);
      minisite = liveMinisiteHandle(headhunter);
      transaction.create(db.collection('projects').doc(slug), record);
      counter = applyProjectCreated(transaction, headhunter, record);
    });
    invalidateAfterCounter(counter);
    onProjectPublished(slug, record, { minisiteHandle: minisiteAfterCounter(minisite, counter) });
    return NextResponse.json({ project: toPublicProject(slug, record), ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לפרסם את הפרויקט.' }, { status: 503 });
  }
}

type ImportUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type ImportOutcome = { rejected: { status: number; body: Record<string, unknown> } } | { record: Record<string, unknown> };

// Imported projects are created, together with a missing publisher profile name, in ONE transaction:
// either the project (and the profile name) exist afterwards or nothing was written.
async function publishImportedProject(user: ImportUser, slug: string, rawImport: unknown, input: { title: string; category: string; description: string; budget: string; deadline: string; skills: string[] }) {
  if (!isXPlaceImportEnabled()) return importErrorResponse(new ImportError('IMPORT_DISABLED'));
  const checked = validateImportProvenance(rawImport);
  if (!checked.ok) {
    if (checked.code === 'ATTESTATION_REQUIRED') return importErrorResponse(new ImportError('ATTESTATION_REQUIRED'));
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const { provenance, target } = checked.value;
  const key = xplaceProjectKey(target.projectId);
  try {
    const db = firestore();
    const projectRef = db.collection('projects').doc(slug);
    const profileRef = db.collection('profiles').doc(user.uid);
    let counter: CounterOutcome | null = null;
    let minisite: string | null = null;
    const outcome = await db.runTransaction(async (transaction): Promise<ImportOutcome> => {
      counter = null;
      minisite = null;
      const existing = await transaction.get(db.collection('projects').where('ownerUid', '==', user.uid).where('importSource.key', '==', key).limit(1));
      if (!existing.empty) return { rejected: { status: 409, body: { code: 'ALREADY_IMPORTED', error: 'הפרויקט הזה כבר יובא לחשבון שלך.', slug: existing.docs[0].id } } };
      const profile = await transaction.get(profileRef);
      // Read with the other reads: Firestore transactions read before they write.
      const headhunter = await readHeadhunterForCounter(transaction, user.uid);
      minisite = liveMinisiteHandle(headhunter);
      const storedName = profile.exists ? profile.get('name') : '';
      const profileName = typeof storedName === 'string' ? storedName.trim() : '';
      const sourceName = provenance.publisherNameOnSource || '';
      const match = matchPublisher(sourceName, profileName);
      const createName = provenance.createPublisherName || '';
      if (match === 'no-profile' && !createName) return { rejected: { status: 400, body: { code: 'PUBLISHER_NAME_REQUIRED', error: 'נדרש שם מפרסם כדי להשלים את הייבוא.' } } };
      if (match === 'mismatch' && provenance.publisherMismatchConfirmed !== true) {
        return { rejected: { status: 409, body: { code: 'PUBLISHER_MISMATCH_UNCONFIRMED', error: 'שם המפרסם ב־XPlace שונה מפרופיל המפרסם שלך. אשרו שאתם מורשים לפרסם את הפרויקט בשמו.', profileName } } };
      }
      const importSource: ProjectImportSource = {
        provider: 'xplace', key, url: provenance.url, externalId: target.projectId, publisherNameOnSource: sourceName,
        publisherMatch: match === 'no-profile' ? 'created' : match === 'match' ? 'match' : match === 'unknown' ? 'unknown' : 'mismatch-confirmed',
        captured: provenance.captured, ownerSignal: provenance.ownerSignal,
        importedAt: FieldValue.serverTimestamp(),
      };
      const record = {
        ...input,
        ownerUid: user.uid, clientName: user.name || user.email?.split('@')[0] || 'לקוח/ה', status: 'open', proposals: 0,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        importSource,
      };
      // Only the publisher name is ever created, and only while the profile has none; no other field is written.
      if (match === 'no-profile') transaction.set(profileRef, { name: createName, ownerUid: user.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.create(projectRef, record);
      counter = applyProjectCreated(transaction, headhunter, record);
      return { record };
    });
    if ('rejected' in outcome) return NextResponse.json(outcome.rejected.body, { status: outcome.rejected.status });
    invalidateAfterCounter(counter);
    onProjectPublished(slug, outcome.record, { minisiteHandle: minisiteAfterCounter(minisite, counter) });
    return NextResponse.json({ project: toPublicProject(slug, outcome.record), ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לפרסם את הפרויקט.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לסגור פרויקט.' }, { status: 401 });
  const parsedBody = await readJsonBody(request, 4_096);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value as { slug?: unknown; status?: unknown } | null;
  if (typeof body?.slug !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.slug) || body.status !== 'closed') return NextResponse.json({ error: 'פרטי סגירת הפרויקט לא תקינים.' }, { status: 400 });
  try {
    const ref = firestore().collection('projects').doc(body.slug);
    // The project as it was when this request closed it (not set when it was already closed).
    let closing: ProjectEventRecord | undefined;
    let minisite: string | null = null;
    const result = await firestore().runTransaction(async transaction => {
      closing = undefined;
      minisite = null;
      const project = await transaction.get(ref);
      if (!project.exists || project.get('ownerUid') !== user.uid) return 'NOT_FOUND';
      if (project.get('status') === 'closed') return 'CLOSED';
      if (project.get('status') !== 'open') return 'UNAVAILABLE';
      // One more document read, only for a project that is actually closing: the owner's minisite lists it.
      minisite = liveMinisiteHandle(await readHeadhunterForCounter(transaction, user.uid));
      transaction.update(ref, { status: 'closed', updatedAt: FieldValue.serverTimestamp() });
      closing = project.data();
      return 'CLOSED';
    });
    if (result === 'NOT_FOUND') return NextResponse.json({ error: 'הפרויקט לא נמצא.' }, { status: 404 });
    if (result === 'UNAVAILABLE') return NextResponse.json({ error: 'אי אפשר לסגור את הפרויקט במצבו הנוכחי.' }, { status: 409 });
    if (closing) onProjectClosed(body.slug, closing, { minisiteHandle: minisite });
    return NextResponse.json({ ok: true, status: 'closed' });
  } catch {
    return NextResponse.json({ error: 'לא הצלחנו לסגור את הפרויקט.' }, { status: 503 });
  }
}
