import { cleanupStaleUploads } from '@/lib/security/upload-cleanup';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
export const POST = route('maintenance.uploads', {}, async () => {
  try {
    const result = await cleanupStaleUploads();
    console.info(JSON.stringify({ event: 'upload_cleanup', severity: result.review ? 'WARNING' : 'INFO', ...result }));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.warn(JSON.stringify({ event: 'upload_cleanup', failed: true }));
    return Response.json({ error: 'CLEANUP_UNAVAILABLE' }, { status: 503 });
  }
});
