import { NextResponse } from 'next/server';
import { generateWithVertex, isVertexConfigured, safePublicUrl } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'לא הצלחנו לקרוא את הקבצים.' }, { status: 400 });
  const uploaded = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if(uploaded.length > 5) return NextResponse.json({error:'עד 5 קבצים'}, {status:400});
  const fileParts: {mimeType:string;data:string}[] = []; 
  const rawUrls = String(form.get('urls') || '').split('\n').map((u) => u.trim()).filter(Boolean);
  if (rawUrls.length > 5 || rawUrls.some((url) => !safePublicUrl(url))) return NextResponse.json({ error: 'אפשר להוסיף עד 5 כתובות ציבוריות (HTTP או HTTPS).' }, { status: 400 });
  let filePart: { mimeType: string; data: string } | undefined;
  for (const file of uploaded) {
    const allowed = ['application/pdf', 'text/plain', 'text/markdown'];
    if (!allowed.includes(file.type) || file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'אפשר להעלות PDF, TXT או Markdown עד 8MB.' }, { status: 400 });
    filePart = { mimeType: file.type === 'text/markdown' ? 'text/plain' : file.type, data: Buffer.from(await file.arrayBuffer()).toString('base64') }; fileParts.push(filePart);
  }
  if (!filePart && !rawUrls.length) return NextResponse.json({ error: 'הוסיפו מסמך אחד או כתובת אתר אחת לפחות.' }, { status: 400 });
  if (!isVertexConfigured()) return NextResponse.json({ demo: true, name: 'אור דוד', headline: 'מעצב מוצר ומפתח חוויות דיגיטליות', bio: 'אני עוזר לעסקים להפוך רעיונות למוצרים דיגיטליים ברורים ונעימים לשימוש.', skills: ['עיצוב מוצר', 'Figma', 'מחקר משתמשים', 'עברית'], facts: [...(filePart ? [{ text: 'מעצב מוצר עם ניסיון בתכנון חוויות דיגיטליות.', source: 'קובץ שהועלה' }] : []), ...rawUrls.map(source => ({ text: 'נמצא תיק עבודות או מידע מקצועי באתר.', source }))], sources: [...(filePart ? ['קובץ שהועלה'] : []), ...rawUrls] });
  try {
    const sourceInstruction = rawUrls.length ? `נתח/י גם את הכתובות הציבוריות דרך URL Context: ${rawUrls.join(', ')}. לכל עובדה ציין/י source לפי שם הקובץ או הכתובת.` : '';
    const result = await generateWithVertex(`צור/י טיוטת פרופיל פרילנסר בעברית מתוך המסמכים המצורפים. השתמש/י רק בעובדות מפורשות, אל תמציא/י שנות ניסיון או לקוחות, והחזר/י JSON בלבד: {"name":string,"headline":string,"bio":string,"skills":string[],"portfolio":string,"experience":string,"education":string,"facts":[{"text":string,"source":string}]}. ${sourceInstruction}`, { files: fileParts, urls: rawUrls }) as { name?: unknown; headline?: unknown; bio?: unknown; skills?: unknown; facts?: unknown; portfolio?: unknown; experience?: unknown; education?: unknown };
    if (typeof result?.headline !== 'string' || typeof result?.bio !== 'string' || !Array.isArray(result?.skills) || !result.skills.every(x => typeof x === 'string') || !Array.isArray(result?.facts) || !result.facts.every((fact) => fact && typeof fact.text === 'string' && typeof fact.source === 'string')) throw new Error('Invalid draft shape');
    const allowedSources = new Set([...(filePart ? ['קובץ שהועלה'] : []), ...rawUrls]);
    const facts = result.facts.filter((fact) => allowedSources.has(fact.source)).slice(0, 30).map((fact) => ({ text: fact.text.slice(0, 600), source: fact.source }));
    return NextResponse.json({ portfolio: typeof result.portfolio === "string" ? result.portfolio.slice(0,4000) : "", experience: typeof result.experience === "string" ? result.experience.slice(0,4000) : "", education: typeof result.education === "string" ? result.education.slice(0,4000) : "", demo: false, name: typeof result.name === 'string' ? result.name.slice(0, 100) : '', headline: result.headline.slice(0, 140), bio: result.bio.slice(0, 1500), skills: result.skills.slice(0, 20).map(s => s.slice(0, 60)), facts, sources: [...allowedSources] });
  } catch { return NextResponse.json({ error: 'לא הצלחנו לעבד את המקורות ב־Vertex AI. בדקו הרשאות וחיבור ל־GCP ונסו שוב.' }, { status: 502 }); }
}
