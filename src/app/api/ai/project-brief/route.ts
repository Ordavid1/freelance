import { NextResponse } from 'next/server';
import { generateWithVertex, isVertexConfigured } from '@/lib/ai';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי להשתמש בכלי הניסוח.' }, { status: 401 });
  if (Number(request.headers.get('content-length') || 0) > 12_000) return NextResponse.json({ error: 'הבקשה גדולה מדי.' }, { status: 413 });
  const body = await request.json().catch(() => null) as { sentence?: unknown } | null;
  if (typeof body?.sentence !== 'string' || body.sentence.trim().length < 8 || body.sentence.length > 3000) return NextResponse.json({ error: 'כתבו לפחות משפט קצר (עד 3,000 תווים).' }, { status: 400 });
  if (!isVertexConfigured()) {
    if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Vertex AI לא הוגדר בסביבה הזו.' }, { status: 503 });
    return NextResponse.json({ demo: true, title: 'טיוטת הדגמה', description: `${body.sentence.trim()}\n\nנרצה לעבוד יחד על הגדרת התכולה והתוצרים.`, skills: ['כישורים לדוגמה'] });
  }
  try {
    const result = await generateWithVertex(`נסח/י טיוטת פרויקט ברורה בעברית לפי הטקסט הבא. שמור/י על עובדות שנמסרו בלבד, ואל תמציא/י תקציב או תאריך. החזר/י JSON בלבד במבנה {"title":string,"description":string,"skills":string[]}. קלט: ${body.sentence}`) as { title?: unknown; description?: unknown; skills?: unknown };
    if (typeof result?.title !== 'string' || typeof result?.description !== 'string' || !Array.isArray(result?.skills) || !result.skills.every((x) => typeof x === 'string')) throw new Error('Invalid draft shape');
    return NextResponse.json({ demo: false, title: result.title.slice(0, 120), description: result.description.slice(0, 5000), skills: result.skills.slice(0, 12) });
  } catch { return NextResponse.json({ error: 'לא הצלחנו ליצור טיוטה ב־Vertex AI. בדקו הרשאות וחיבור ל־GCP ונסו שוב.' }, { status: 502 }); }
}
