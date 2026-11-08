import { NextResponse } from 'next/server';
import { generateWithVertex, isVertexConfigured } from '@/lib/ai';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { sentence?: unknown } | null;
  if (typeof body?.sentence !== 'string' || body.sentence.trim().length < 8 || body.sentence.length > 3000) return NextResponse.json({ error: 'כתבו לפחות משפט קצר (עד 3,000 תווים).' }, { status: 400 });
  if (!isVertexConfigured()) return NextResponse.json({ demo: true, title: 'שדרוג חוויית האתר והגדלת פניות', description: `${body.sentence.trim()}\n\nנרצה לעבוד יחד על הגדרת התכולה, תוצרים ברורים ולוח זמנים מוסכם. אנא כללו בהצעה דוגמאות רלוונטיות, זמינות והערכה ראשונית של משך העבודה.`, skills: ['אפיון', 'עיצוב מוצר', 'פיתוח'] });
  try {
    const result = await generateWithVertex(`נסח/י טיוטת פרויקט ברורה בעברית לפי הטקסט הבא. שמור/י על עובדות שנמסרו בלבד, ואל תמציא/י תקציב או תאריך. החזר/י JSON בלבד במבנה {"title":string,"description":string,"skills":string[]}. קלט: ${body.sentence}`) as { title?: unknown; description?: unknown; skills?: unknown };
    if (typeof result?.title !== 'string' || typeof result?.description !== 'string' || !Array.isArray(result?.skills) || !result.skills.every((x) => typeof x === 'string')) throw new Error('Invalid draft shape');
    return NextResponse.json({ demo: false, title: result.title.slice(0, 120), description: result.description.slice(0, 5000), skills: result.skills.slice(0, 12) });
  } catch { return NextResponse.json({ error: 'לא הצלחנו ליצור טיוטה ב־Vertex AI. בדקו הרשאות וחיבור ל־GCP ונסו שוב.' }, { status: 502 }); }
}
