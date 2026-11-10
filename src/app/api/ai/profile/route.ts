import { enforceActionLimit } from '@/lib/security/rate-limit';
import { readFormBody } from '@/lib/security/request-body';
import { createHash, randomUUID } from 'node:crypto';
import { profileResponseSchema, profileSystemInstruction, PROFILE_PROMPT_VERSION, validateProfileDraft } from '@/lib/profile-generation';
import { NextResponse } from 'next/server';
import { generateWithVertex, isVertexConfigured, safePublicUrl, type VertexDiagnostics } from '@/lib/ai';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { userUploadsBucket } from '@/lib/db/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'יש להתחבר כדי לייבא פרופיל.' }, { status: 401 });
  const limited = await enforceActionLimit(user.uid, 'ai.profile');
  if (limited) return limited;
  const parsedBody = await readFormBody(request, 256 * 1024);
  if (!parsedBody.ok) return parsedBody.response;
  const form = parsedBody.value;
  if (!form) return NextResponse.json({ error: 'לא הצלחנו לקרוא את הקבצים.' }, { status: 400 });
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
  if (rawSocialSources.length > 50_000) return NextResponse.json({ error: 'נתוני המקורות גדולים מדי.' }, { status: 413 });
  let socialSources: { provider: 'github' | 'linkedin' | 'dribbble'; sourceText: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(rawSocialSources);
    if (!Array.isArray(parsed) || parsed.length > 3 || parsed.some((item) => !item || !['github', 'linkedin', 'dribbble'].includes(item.provider) || typeof item.sourceText !== 'string' || item.sourceText.length > 14_000)) throw new Error('Invalid social sources');
    socialSources = parsed;
    if (new Set(socialSources.map(s => s.provider)).size !== socialSources.length) throw new Error('Duplicate social provider');
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
  const urls = [...new Set(rawUrls.map(url => { const parsed = new URL(url); parsed.hash = ''; return parsed.href; }))];
  const sourceManifest = [
    ...sourceIds.map((id, index) => ({ id: `document:${id}`, attachment: index + 1 })),
    ...urls.map(url => ({ id: url, url })),
    ...socialSources.map(item => ({ id: item.provider, excerpt: item.sourceText })),
  ];
  const allowedSources = new Set(sourceManifest.map(source => source.id));
  const requestId = randomUUID();
  const traceId = request.headers.get('x-cloud-trace-context')?.split('/')[0];
  const trace = traceId && /^[a-f0-9]{32}$/.test(traceId) ? `projects/${process.env.GOOGLE_CLOUD_PROJECT}/traces/${traceId}` : undefined;
  const startedAt = Date.now();
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let diagnostics: VertexDiagnostics | undefined;
  const log = (status: string, output?: unknown) => console.info(JSON.stringify({
    severity: status === 'success' ? 'INFO' : 'WARNING', 'logging.googleapis.com/trace': trace,
    event: 'profile_generation', requestId, status, promptVersion: PROFILE_PROMPT_VERSION,
    model: process.env.VERTEX_MODEL_ID || 'gemini-3.8-flash', durationMs: Date.now() - startedAt,
    input: { documents: sourceIds.length, attachmentBytes: fileParts.map(file => Buffer.byteLength(file.data, 'base64')), urls: urls.length, socialProviders: socialSources.map(s => s.provider), sha256: hash({ sourceManifest, files: fileParts }) },
    outputSha256: output ? hash(output) : undefined,
    vertex: diagnostics ? { ...diagnostics, urls: diagnostics.urls.map(item => ({ urlSha256: hash(item.url), status: item.status })) } : undefined,
  }));
  try {
    const result = await generateWithVertex(`Source manifest (attachment numbers match the attached files in order):\n${JSON.stringify(sourceManifest)}\nExtract supported professional facts and synthesize the profile according to the system instructions. Cite each fact with a source id from this manifest.`, {
      files: fileParts, urls, systemInstruction: profileSystemInstruction,
      responseJsonSchema: profileResponseSchema([...allowedSources]), maxOutputTokens: 16384,
      onDiagnostics: value => { diagnostics = value; },
    });
    const draft = validateProfileDraft(result, allowedSources);
    const retrieved = new Set((diagnostics?.urls || []).filter(item => item.status === 'URL_RETRIEVAL_STATUS_SUCCESS').map(item => { try { const url = new URL(item.url); url.hash = ''; return url.href; } catch { return ''; } }));
    const unavailableUrls = urls.filter(url => !retrieved.has(url));
    if (urls.length && unavailableUrls.length === urls.length && !fileParts.length && !socialSources.length) throw new Error('No requested URL was retrieved');
    draft.facts = draft.facts.filter(fact => !unavailableUrls.includes(fact.source));
    const response = { ...draft, demo: false, sources: [...allowedSources], generationId: requestId,
      warnings: unavailableUrls.length ? ['חלק מהקישורים לא נקראו בהצלחה. בדקו את הטיוטה והוסיפו מסמך אם חסר מידע.'] : [] };
    log('success', response);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store', 'X-Profile-Generation-Id': requestId } });
  } catch {
    log('failed');
    return NextResponse.json({ error: 'לא הצלחנו ליצור טיוטה מאומתת מהמקורות. נסו שוב או הוסיפו מסמך.', generationId: requestId }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
