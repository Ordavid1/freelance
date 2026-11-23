import { NextResponse } from 'next/server';
import { applyAsHeadhunter, getHeadhunter, headhunterGate, invalidateHeadhunterCache, isAccountActive, updateHeadhunter } from '@/lib/db/headhunters';
import { announceMinisites } from '@/lib/headhunters/indexnow';
import { validateHandle } from '@/lib/headhunters/handle';
import { HEADHUNTER_MIN_PROJECTS } from '@/lib/headhunters/constants';
import { HEADHUNTER_API_ERRORS } from '@/lib/headhunters/messages';
import type { HeadhunterRecord } from '@/lib/headhunters/types';
import { validateHeadhunterInput } from '@/lib/headhunters/validation';
import { ownerView } from '@/lib/headhunters/view';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' };
const BODY_LIMIT = 8_192;

// The editable form of a stored record: a PATCH body is merged over it, so a client may send only the fields it changes.
const editableFields = (record: HeadhunterRecord) => ({
  displayName: record.displayName, kind: record.kind, contact: record.contact,
  ...(record.city ? { city: record.city } : {}), ...(record.tagline ? { tagline: record.tagline } : {}),
  ...(record.about ? { about: record.about } : {}), ...(record.share ? { share: record.share } : {}),
});

export const GET = route('headhunter.read', { gate: () => headhunterGate() }, async ({ user, gate }) => {
  try {
    const record = await getHeadhunter(user.uid);
    const headhunter = record ? ownerView(record, { accountActive: await isAccountActive(user.uid) }) : null;
    return NextResponse.json({ headhunter, applicationsOpen: gate.config.applicationsOpen, required: HEADHUNTER_MIN_PROJECTS }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: HEADHUNTER_API_ERRORS.UNAVAILABLE }, { status: 503 });
  }
});

export const POST = route('headhunter.apply', { gate: () => headhunterGate({ applications: true }), body: { type: 'json', maxBytes: BODY_LIMIT } }, async ({ user, body }) => {
  const { handle: rawHandle, ...fields } = body;
  const input = validateHeadhunterInput(fields, { requireAttestation: true, allowFastTrack: true });
  if (!input.ok) return NextResponse.json({ code: input.code, ...(input.field ? { field: input.field } : {}), error: input.error }, { status: 400 });
  const handle = validateHandle(rawHandle);
  if (!handle.ok) return NextResponse.json({ code: handle.code, field: 'handle', error: handle.error }, { status: 400 });
  try {
    const result = await applyAsHeadhunter(user.uid, input.value, handle.handle, handle.flags);
    if (!result.ok) {
      return result.code === 'EXISTS'
        ? NextResponse.json({ code: 'ALREADY_APPLIED', error: HEADHUNTER_API_ERRORS.ALREADY_APPLIED }, { status: 409 })
        : NextResponse.json({ code: 'HANDLE_TAKEN', field: 'handle', error: HEADHUNTER_API_ERRORS.HANDLE_TAKEN }, { status: 409 });
    }
    invalidateHeadhunterCache(result.handle);
    return NextResponse.json({ ok: true, status: result.status, handle: result.handle, published: result.published, required: HEADHUNTER_MIN_PROJECTS }, { status: 201, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: HEADHUNTER_API_ERRORS.UNAVAILABLE }, { status: 503 });
  }
});

export const PATCH = route('headhunter.update', { gate: () => headhunterGate(), body: { type: 'json', maxBytes: BODY_LIMIT } }, async ({ user, body }) => {
  try {
    const record = await getHeadhunter(user.uid);
    if (!record) return NextResponse.json({ code: 'NOT_FOUND', error: HEADHUNTER_API_ERRORS.NOT_FOUND }, { status: 404 });
    const input = validateHeadhunterInput({ ...editableFields(record), ...body });
    if (!input.ok) return NextResponse.json({ code: input.code, ...(input.field ? { field: input.field } : {}), error: input.error }, { status: 400 });
    const result = await updateHeadhunter(user.uid, input.value);
    if (!result.ok) {
      return result.code === 'NOT_FOUND'
        ? NextResponse.json({ code: 'NOT_FOUND', error: HEADHUNTER_API_ERRORS.NOT_FOUND }, { status: 404 })
        : NextResponse.json({ code: 'EDIT_BLOCKED', error: HEADHUNTER_API_ERRORS.EDIT_BLOCKED }, { status: 409 });
    }
    // Contact, tagline and the rest are public on an approved page, so any edit expires the cached page.
    invalidateHeadhunterCache(result.handle);
    // A live page changed (or just left review): tell search engines. Drafts and pending records have no public page.
    if (result.eligible && (result.status === 'approved' || result.statusChanged)) announceMinisites([result.handle]);
    return NextResponse.json({ ok: true, status: result.status }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: HEADHUNTER_API_ERRORS.UNAVAILABLE }, { status: 503 });
  }
});
