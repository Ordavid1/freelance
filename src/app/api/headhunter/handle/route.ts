import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { checkHandleAvailability, headhunterGate, invalidateHeadhunterCache, renameHandle } from '@/lib/db/headhunters';
import { announceMinisites } from '@/lib/headhunters/indexnow';
import { validateHandle } from '@/lib/headhunters/handle';
import { handleCooldownError, HEADHUNTER_API_ERRORS } from '@/lib/headhunters/messages';
import { accountWriteDenied } from '@/lib/security/marketplace-policy';
import { enforceActionLimit } from '@/lib/security/rate-limit';
import { readJsonBody } from '@/lib/security/request-body';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' };

// Availability for the live check in the editor. The answer never says who owns a taken handle (or whether it is
// taken, retired or only look-alike), and the check spends the same per-account budget as a rename.
export async function GET(request: Request) {
  const gate = await headhunterGate();
  if (!gate.ok) return gate.response;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: HEADHUNTER_API_ERRORS.SIGN_IN }, { status: 401 });
  const limited = await enforceActionLimit(user.uid, 'headhunter.handle');
  if (limited) return limited;
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
}

export async function POST(request: Request) {
  const gate = await headhunterGate();
  if (!gate.ok) return gate.response;
  if (!isSameOrigin(request)) return NextResponse.json({ error: HEADHUNTER_API_ERRORS.FORBIDDEN }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: HEADHUNTER_API_ERRORS.SIGN_IN }, { status: 401 });
  const limited = await enforceActionLimit(user.uid, 'headhunter.handle');
  if (limited) return limited;
  const accountDenied = await accountWriteDenied(user.uid);
  if (accountDenied) return accountDenied;
  const parsedBody = await readJsonBody(request, 1_024);
  if (!parsedBody.ok) return parsedBody.response;
  const checked = validateHandle(parsedBody.value.handle);
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
    announceMinisites([result.handle, result.previous]);
    return NextResponse.json({ ok: true, handle: result.handle, status: result.status }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: HEADHUNTER_API_ERRORS.UNAVAILABLE }, { status: 503 });
  }
}
