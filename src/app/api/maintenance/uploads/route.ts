import { OAuth2Client } from 'google-auth-library';
import { cleanupStaleUploads } from '@/lib/security/upload-cleanup';
import { publicAppOrigin } from '@/lib/auth/session';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const expected = process.env.MAINTENANCE_SCHEDULER_EMAIL;
  if (!expected) return Response.json({ error: 'MAINTENANCE_NOT_CONFIGURED' }, { status: 503 });
  try {
    const ticket = await new OAuth2Client().verifyIdToken({ idToken: request.headers.get('authorization')?.replace(/^Bearer /, '') || '', audience: `${publicAppOrigin(request)}/api/maintenance/uploads` });
    const token = ticket.getPayload();
    if (token?.email !== expected || token.email_verified !== true) throw new Error();
  } catch { return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }); }
  try {
    const result = await cleanupStaleUploads();
    console.info(JSON.stringify({ event: 'upload_cleanup', severity: result.review ? 'WARNING' : 'INFO', ...result }));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.warn(JSON.stringify({ event: 'upload_cleanup', failed: true }));
    return Response.json({ error: 'CLEANUP_UNAVAILABLE' }, { status: 503 });
  }
}
