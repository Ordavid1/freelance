import { NextResponse } from 'next/server';
import { generateWithVertex, isVertexConfigured, safePublicUrl } from '@/lib/ai';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { userUploadsBucket } from '@/lib/db/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  if (!await getCurrentUser()) return NextResponse.json({ error: 'יש להתחבר כדי לייבא פרופיל.' }, { status: 401 });
  if (Number(request.headers.get('content-length') || 0) > 45 * 1024 * 1024) return NextResponse.json({ error: 'הבקשה גדולה מדי.' }, { status: 413 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'לא הצלחנו לקרוא את הקבצים.' }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לייבא פרופיל.' }, { status: 401 });
  const uploaded = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (uploaded.length) return NextResponse.json({ error: 'יש לשמור את המסמכים במקורות הפרופיל לפני עיבוד.' }, { status: 400 });
  const rawSourceIds = String(form.get('sourceIds') || '[]');
  let sourceIds: string[];
  try {
    const parsed: unknown = JSON.parse(rawSourceIds);
    if (!Array.isArray(parsed) || parsed.length > 5 || parsed.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Invalid source IDs');
    sourceIds = [...new Set(parsed)];
  } catch { return NextResponse.json({ error: 'רשימת מסמכי המקור לא תקינה.' }, { status: 400 }); }
  let storedFiles: { mimeType: string; data: string }[] = [];
  if (sourceIds.length) {
    try {
      const refs = sourceIds.map((id) => firestore().collection('users').doc(user.uid).collection('profileSources').doc(id));
      const docs = await firestore().getAll(...refs);
      if (docs.some((doc) => !doc.exists || doc.get('ownerUid') !== user.uid)) return NextResponse.json({ error: 'חלק ממסמכי המקור אינם שייכים לחשבון הזה.' }, { status: 403 });
      const files = docs.map((doc) => ({ objectName: doc.get('objectName'), contentType: doc.get('contentType'), size: doc.get('size'), status: doc.get('status') }));
      if (files.some((file) => file.status !== 'ready' || typeof file.objectName !== 'string' || !file.objectName.startsWith(`users/${user.uid}/profile-sources/`) || !['application/pdf', 'text/plain'].includes(file.contentType) || typeof file.size !== 'number' || file.size > 8 * 1024 * 1024)) return NextResponse.json({ error: 'מסמך המקור אינו תקין או טרם הושלם.' }, { status: 400 });
      const total = files.reduce((sum, file) => sum + (file.size as number), 0);
      if (total > 24 * 1024 * 1024) return NextResponse.json({ error: 'אפשר לעבד עד 24MB של מסמכים בכל פעם.' }, { status: 413 });
      storedFiles = await Promise.all(files.map(async (file) => {
        const [bytes] = await userUploadsBucket().file(file.objectName as string).download();
        if (bytes.byteLength !== file.size) throw new Error('Stored source size mismatch');
        return { mimeType: file.contentType as string, data: bytes.toString('base64') };
      }));
    } catch {
      return NextResponse.json({ error: 'לא הצלחנו לקרוא מסמך שמור. בדקו שהקובץ קיים ונסו שוב.' }, { status: 503 });
    }
  }
  const fileParts: {mimeType:string;data:string}[] = [...storedFiles];
  const rawUrls = String(form.get('urls') || '').split('\n').map((u) => u.trim()).filter(Boolean);
  const rawSocialSources = String(form.get('socialSources') || '[]');
  let socialSources: { provider: 'github' | 'linkedin'; sourceText: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(rawSocialSources);
    if (!Array.isArray(parsed) || parsed.length > 2 || parsed.some((item) => !item || !['github', 'linkedin'].includes(item.provider) || typeof item.sourceText !== 'string' || item.sourceText.length > 14_000)) throw new Error('Invalid social sources');
    socialSources = parsed;
  } catch {
    if (rawSocialSources !== '[]') return NextResponse.json({ error: 'נתוני הפרופיל החברתי לא תקינים. נסו לייבא אותם שוב.' }, { status: 400 });
  }
  if (rawUrls.length > 5 || rawUrls.some((url) => !safePublicUrl(url))) return NextResponse.json({ error: 'אפשר להוסיף עד 5 כתובות ציבוריות (HTTP או HTTPS).' }, { status: 400 });
  const filePart = fileParts[0];
  if (!filePart && !rawUrls.length && !socialSources.length) return NextResponse.json({ error: 'הוסיפו מסמך, חברו GitHub או LinkedIn, או הוסיפו כתובת אתר.' }, { status: 400 });
  if (!isVertexConfigured()) {
    if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Vertex AI לא הוגדר בסביבה הזו.' }, { status: 503 });
    return NextResponse.json({ demo: true, name: '', headline: '', bio: '', skills: [], facts: [], sources: rawUrls });
  }
  try {
    const sourceInstruction = rawUrls.length ? `נתח/י גם את הכתובות הציבוריות דרך URL Context: ${rawUrls.join(', ')}.` : '';
    const socialInstruction = socialSources.length ? `הנתונים הבאים הגיעו מחשבונות שהמשתמש חיבר ואישר. שלב/י אותם עם המסמכים. ציין/י עובדות רק כשיש להן מקור מפורש.\n${socialSources.map((item) => `[${item.provider}]\n${item.sourceText}`).join('\n\n')}` : '';
    const result = await generateWithVertex(`צור/י טיוטת פרופיל פרילנסר בעברית מתוך המסמכים המצורפים. השתמש/י רק בעובדות מפורשות, אל תמציא/י שנות ניסיון או לקוחות, והחזר/י JSON בלבד: {"name":string,"headline":string,"bio":string,"skills":string[],"portfolio":string,"experience":string,"education":string,"facts":[{"text":string,"source":string}]}. ${sourceInstruction}\n${socialInstruction}`, { files: fileParts, urls: rawUrls }) as { name?: unknown; headline?: unknown; bio?: unknown; skills?: unknown; facts?: unknown; portfolio?: unknown; experience?: unknown; education?: unknown };
    if (typeof result?.headline !== 'string' || typeof result?.bio !== 'string' || !Array.isArray(result?.skills) || !result.skills.every(x => typeof x === 'string') || !Array.isArray(result?.facts) || !result.facts.every((fact) => fact && typeof fact.text === 'string' && typeof fact.source === 'string')) throw new Error('Invalid draft shape');
    const allowedSources = new Set([...(filePart ? ['מסמכים ששמורים בחשבון'] : []), ...rawUrls, ...socialSources.map((item) => item.provider)]);
    const facts = result.facts.filter((fact) => allowedSources.has(fact.source)).slice(0, 30).map((fact) => ({ text: fact.text.slice(0, 600), source: fact.source }));
    return NextResponse.json({ portfolio: typeof result.portfolio === "string" ? result.portfolio.slice(0,4000) : "", experience: typeof result.experience === "string" ? result.experience.slice(0,4000) : "", education: typeof result.education === "string" ? result.education.slice(0,4000) : "", demo: false, name: typeof result.name === 'string' ? result.name.slice(0, 100) : '', headline: result.headline.slice(0, 140), bio: result.bio.slice(0, 1500), skills: result.skills.slice(0, 20).map(s => s.slice(0, 60)), facts, sources: [...allowedSources] });
  } catch { return NextResponse.json({ error: 'לא הצלחנו לעבד את המקורות ב־Vertex AI. בדקו הרשאות וחיבור ל־GCP ונסו שוב.' }, { status: 502 }); }
}
