import { timingSafeEqual } from 'node:crypto';
import { firestore } from '@/lib/db/firestore';
export const runtime = 'nodejs';
function params(request: Request) {
  const q = new URL(request.url).searchParams, uid = q.get('uid'), token = q.get('token');
  return uid && /^[a-zA-Z0-9_-]{1,128}$/.test(uid) && token && /^[a-f0-9]{64}$/.test(token) ? { uid, token } : null;
}
const html = (body: string, status = 200) => new Response(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>עדכוני פרויקטים</title><body style="font-family:Arial;padding:32px;color:#17263a">${body}</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
// GET only confirms: mail-provider link scanners must not unsubscribe a user.
export async function GET(request: Request) {
  if (!params(request)) return html('קישור לא תקין.', 400);
  return html('<h1>להפסיק עדכוני פרויקטים במייל?</h1><form method="post"><button type="submit">הפסקת עדכונים</button></form>');
}
export async function POST(request: Request) {
  const input = params(request);
  if (!input) return html('קישור לא תקין.', 400);
  try {
    const db = firestore(), ref = db.collection('projectMailPreferences').doc(input.uid);
    const ok = await db.runTransaction(async tx => {
      const current = await tx.get(ref), token = current.get('unsubscribeToken');
      if (typeof token !== 'string' || token.length !== 64 || !timingSafeEqual(Buffer.from(token), Buffer.from(input.token))) return false;
      tx.update(ref, { enabled: false, pending: null }); return true;
    });
    return ok ? html('<h1>עדכוני הפרויקטים הופסקו.</h1><p>אפשר להפעיל אותם שוב בלשונית ההודעות.</p>') : html('הקישור אינו תקף.', 400);
  } catch { return html('לא ניתן לעדכן כרגע. נסו שוב.', 503); }
}
