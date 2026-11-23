import { NextResponse } from 'next/server';
import { checkHandleAvailability, headhunterGate, invalidateHeadhunterCache, renameHandle } from '@/lib/db/headhunters';
import { announceMinisites } from '@/lib/headhunters/indexnow';
import { validateHandle } from '@/lib/headhunters/handle';
import { handleCooldownError, HEADHUNTER_API_ERRORS } from '@/lib/headhunters/messages';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' };

// Availability for the live check in the editor. The answer never says who owns a taken handle (or whether it is
// taken, retired or only look-alike), and the check spends the same per-account budget as a rename.
export const GET = route('headhunter.handle.check', { gate: () => headhunterGate() }, async ({ request, user }) => {
  const checked = validateHandle(new URL(request.url).searchParams.get('handle'));
  if (!checked.ok) return NextResponse.json({ available: false, code: checked.code, error: checked.error }, { headers: NO_STORE });
  try {
    const claim = await checkHandleAvailability(user.uid, checked.handle);
    return claim.ok
      ? NextResponse.json({ available: true, handle: checked.handle }, { headers: NO_STORE })
      : NextResponse.json({ available: false, code: 'HANDLE_TAKEN', error: HEADHUNTER_API_ERRORS.HANDLE_TAKEN }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: HEADHUNTER_API_ERRORS.UNAVAILABLE }, { status: 503 });
  }
});

export const POST = route('headhunter.handle.rename', { gate: () => headhunterGate(), body: { type: 'json', maxBytes: 1_024 } }, async ({ user, body }) => {
  const checked = validateHandle(body.handle);
  if (!checked.ok) return NextResponse.json({ code: checked.code, field: 'handle', error: checked.error }, { status: 400 });
  try {
    const result = await renameHandle(user.uid, checked.handle, checked.flags);
    if (!result.ok) {
      switch (result.code) {
        case 'NOT_FOUND': return NextResponse.json({ code: 'NOT_FOUND', error: HEADHUNTER_API_ERRORS.NOT_FOUND }, { status: 404 });
        case 'BLOCKED': return NextResponse.json({ code: 'EDIT_BLOCKED', error: HEADHUNTER_API_ERRORS.EDIT_BLOCKED }, { status: 409 });
        case 'SAME': return NextResponse.json({ code: 'HANDLE_SAME', error: HEADHUNTER_API_ERRORS.HANDLE_SAME }, { status: 409 });
        case 'COOLDOWN': return NextResponse.json({ code: 'RENAME_COOLDOWN', error: handleCooldownError(result.retryAfterDays), retryAfterDays: Math.ceil(result.retryAfterDays) }, { status: 429 });
        default: return NextResponse.json({ code: 'HANDLE_TAKEN', field: 'handle', error: HEADHUNTER_API_ERRORS.HANDLE_TAKEN }, { status: 409 });
      }
    }
    // Both URLs change: the new one starts resolving, the old one redirects.
    invalidateHeadhunterCache(result.handle);
    invalidateHeadhunterCache(result.previous);
    // A fast-track trial page (not eligible yet) is noindex and was never announced, so there is nothing to tell crawlers.
    if (result.eligible) announceMinisites([result.handle, result.previous]);
    return NextResponse.json({ ok: true, handle: result.handle, status: result.status }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: HEADHUNTER_API_ERRORS.UNAVAILABLE }, { status: 503 });
  }
});
