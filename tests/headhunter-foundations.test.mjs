import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const env = { NEXT_PUBLIC_SITE_URL: 'https://freelance-place.com' };
const load = (name, options = { env }) => loadModule(`src/lib/headhunters/${name}.ts`, options);
const constants = load('constants');
const reserved = load('reserved');
const handle = load('handle');
const counting = load('counting');
const state = load('state');
const validation = load('validation');
const urls = load('urls');
const share = load('share');
const presentation = load('presentation');

test('constants', () => {
  assert.equal(constants.HEADHUNTER_MIN_PROJECTS, 10);
  assert.equal(constants.HEADHUNTER_REVIEW_FLOOR, 5);
  assert.equal(constants.HEADHUNTER_RENAME_COOLDOWN_DAYS, 30);
  assert.equal(constants.HEADHUNTER_RETIRED_HOLD_DAYS, 365);
  assert.equal(constants.HEADHUNTER_MIN_DESCRIPTION, 80);
  assert.equal(constants.HEADHUNTER_LIMITS.tagline, 90);
  eq([...constants.HEADHUNTER_STATUSES], ['draft', 'pending', 'approved', 'suspended', 'rejected']);
  eq([...constants.HEADHUNTER_KINDS], ['agency', 'independent']);
  assert.equal(constants.HEADHUNTERS_COLLECTION, 'headhunters');
  assert.equal(constants.HANDLES_COLLECTION, 'handles');
  assert.equal(constants.HEADHUNTER_CONFIG.doc, 'headhunters');
  assert.equal(constants.HEADHUNTERS_TAG, 'headhunters');
  assert.equal(constants.headhunterTag('acme'), 'headhunter:acme');
});

test('reserved words and routes', () => {
  for (const word of ['admin', 'pricing', 'xplace', 'headhunters', '_next', '__', 'llms-full']) assert.equal(reserved.isReservedHandle(word), true, word);
  assert.equal(reserved.isReservedHandle('ofek-hr'), false);
  assert.equal(reserved.isReservedHandle('Admin'), false, 'exact match only; normalise first');
  assert.ok(reserved.WATCHED_BRAND_TERMS.includes('google'));
  assert.equal(reserved.isReservedHandle('google'), false, 'watched terms are flagged, not rejected');
});

test('handle normalisation and format boundaries', () => {
  assert.equal(handle.normalizeHandle('  Ofek-HR '), 'ofek-hr');
  assert.equal(handle.normalizeHandle(42), '');
  assert.equal(handle.normalizeHandle(null), '');
  const ok = (value) => handle.isHandleFormat(value);
  assert.equal(ok('ab'), false);
  assert.equal(ok('abc'), true);
  assert.equal(ok('a'.repeat(30)), true);
  assert.equal(ok('a'.repeat(31)), false);
  assert.equal(ok('a--b'), false);
  assert.equal(ok('-abc'), false);
  assert.equal(ok('abc-'), false);
  assert.equal(ok('a-b-c'), true);
  assert.equal(ok('Abc'), false);
  assert.equal(ok('a_b'), false);
  assert.equal(ok('אבג'), false);
  assert.equal(ok('123'), true);
});

test('skeleton', () => {
  assert.equal(handle.handleSkeleton('xp1ace'), 'xpiace');
  assert.equal(handle.handleSkeleton('adm1n'), handle.handleSkeleton('admin'));
  assert.equal(handle.handleSkeleton('xpiace'), handle.handleSkeleton('xplace'));
  assert.equal(handle.handleSkeleton('f-0-0'), 'foo');
  assert.equal(handle.handleSkeleton('rnicrosoft'), 'microsoft');
  assert.equal(handle.handleSkeleton('vvix'), 'wix');
  assert.equal(handle.handleSkeleton('a3457'), 'aeast');
});

test('validateHandle: format, reserved, look-alike, watched flags', () => {
  eq({ ...handle.validateHandle('  Ofek-HR ') }, { ok: true, handle: 'ofek-hr', flags: [] });
  assert.equal(handle.validateHandle('ab').code, 'FORMAT');
  assert.equal(handle.validateHandle('a--b').code, 'FORMAT');
  assert.equal(handle.validateHandle(undefined).code, 'FORMAT');
  for (const reservedHandle of ['pricing', 'Admin', 'xp1ace', 'adm1n', 'xpiace', 'freelance-place-jobs', 'fr33lance', 'adm-in', 'my-freelance-team', 'xplace-il']) {
    const result = handle.validateHandle(reservedHandle);
    assert.equal(result.ok, false, reservedHandle);
    assert.equal(result.code, 'RESERVED', reservedHandle);
    assert.ok(result.error.length > 0);
  }
  const watched = handle.validateHandle('g00gle');
  assert.equal(watched.ok, true);
  eq(watched.flags, ['lookalike:google']);
  eq(handle.validateHandle('google-recruiting').flags, ['lookalike:google']);
  eq(handle.validateHandle('meta').flags, ['lookalike:meta']);
  eq(handle.validateHandle('metadata-co').flags, [], 'short terms only match exactly');
  eq(handle.validateHandle('acme-hr').flags, []);
});

test('suggestHandle', () => {
  assert.equal(handle.suggestHandle('Acme Recruiting Ltd.'), 'acme-recruiting-ltd');
  assert.equal(handle.suggestHandle('  Café  Déjà!! '), 'cafe-deja');
  assert.equal(handle.suggestHandle('שרה כהן'), 'shrh-khn');
  assert.equal(handle.suggestHandle('חיים'), 'chyym');
  assert.equal(handle.suggestHandle('דנה גיוס'), 'dnh-gyvs');
  assert.equal(handle.suggestHandle('A'.repeat(40)).length, 30);
  assert.equal(handle.suggestHandle('a'.repeat(29) + ' b'), 'a'.repeat(29), 'no trailing hyphen after the cut');
  assert.equal(handle.suggestHandle('Admin'), '', 'reserved');
  assert.equal(handle.suggestHandle('ab'), '', 'too short');
  assert.equal(handle.suggestHandle('!!!'), '');
  assert.equal(handle.suggestHandle(7), '');
  assert.equal(handle.suggestHandle('Pricing'), '');
});

const long = 'תיאור פרויקט מפורט שכולל מספיק תווים כדי לעבור את הסף של שמונים תווים לפחות, ועוד קצת.';
const project = (over = {}) => ({ id: 'p', status: 'open', visibility: 'public', title: 'מפתח/ת React', description: long, ...over });

test('countsTowardHeadhunter', () => {
  const counts = counting.countsTowardHeadhunter;
  assert.equal(counts(project()), true);
  assert.equal(counts(project({ status: 'closed' })), true);
  assert.equal(counts(project({ status: 'archived' })), false);
  assert.equal(counts(project({ status: 'removed' })), false);
  assert.equal(counts(project({ visibility: 'private' })), false);
  assert.equal(counts(project({ description: 'קצר' })), false);
  assert.equal(counts(project({ description: ` ${'x'.repeat(79)} ` })), false);
  assert.equal(counts(project({ description: 'x'.repeat(80) })), true);
  assert.equal(counts(project({ title: '  ' })), false);
  assert.equal(counts(project({ sample: true })), false);
  assert.equal(counts(project({ unreal: true })), false);
  assert.equal(counts(project({ owner: { kind: 'ai-agent' } })), false);
  assert.equal(counts({}), false);
});

test('projectFingerprint and countPublishedProjects', () => {
  assert.equal(counting.projectFingerprint({ title: 'Hello, World!', description: 'A  B' }), 'hello world a b');
  assert.equal(counting.projectFingerprint({ title: 'x', description: 'y'.repeat(900) }).length <= 400, true);
  assert.equal(counting.projectFingerprint({}), '');
  const result = counting.countPublishedProjects([
    project({ id: 'a', title: 'אחד' }),
    project({ id: 'dup-text', title: 'אחד!' }),
    project({ id: 'b', title: 'שניים', importSource: { key: 'xplace:1' } }),
    project({ id: 'dup-key', title: 'שלושה', importSource: { key: 'xplace:1' } }),
    project({ id: 'showcase', title: 'ארבעה', sample: true }),
    project({ id: 'archived', title: 'חמישה', status: 'archived' }),
    project({ id: 'short', title: 'שישה', description: 'קצר' }),
    project({ id: 'c', title: 'שבעה', status: 'closed' }),
    project({ id: undefined, title: 'שמונה' }),
  ]);
  assert.equal(result.count, 4);
  eq(result.countedIds, ['a', 'b', 'c', '#8']);
  eq(result.duplicateIds, ['dup-text', 'dup-key']);
  eq(result.skippedIds, ['showcase', 'archived', 'short']);
  assert.equal(counting.countPublishedProjects(new Set()).count, 0);
});

test('a skipped project does not block a later qualifying one with the same key', () => {
  const result = counting.countPublishedProjects([project({ id: 'old', status: 'archived', importSource: { key: 'k' } }), project({ id: 'new', importSource: { key: 'k' } })]);
  eq(result.countedIds, ['new']);
});

test('eligibility thresholds', () => {
  assert.equal(counting.isEligible(9), false);
  assert.equal(counting.isEligible(10), true);
  assert.equal(counting.needsReReview(4), true);
  assert.equal(counting.needsReReview(5), false);
});

test('headhunterPublicState matrix', () => {
  const run = (over) => state.headhunterPublicState({ status: 'approved', eligible: true, accountActive: true, openProjects: 3, ...over });
  eq({ ...run({}) }, { live: true, indexable: true, reason: 'live' });
  eq({ ...run({ openProjects: 0 }) }, { live: true, indexable: false, reason: 'no-open-projects' });
  for (const status of ['draft', 'pending', 'suspended', 'rejected', undefined]) eq({ ...run({ status }) }, { live: false, indexable: false, reason: 'not-approved' });
  eq({ ...run({ eligible: false }) }, { live: false, indexable: false, reason: 'not-eligible' });
  eq({ ...run({ accountActive: false }) }, { live: false, indexable: false, reason: 'account-restricted' });
  assert.equal(run({ openProjects: Number.NaN }).indexable, false);
});

const valid = (over = {}) => ({ displayName: 'Acme גיוס', kind: 'agency', contact: { email: 'Hello@Acme.CO.il' }, ...over });
const check = (body, options) => validation.validateHeadhunterInput(body, options);
const failure = (body, options) => { const result = check(body, options); assert.equal(result.ok, false); return result; };

test('validateHeadhunterInput: success and normalisation', () => {
  const result = check(valid({ city: ' תל  אביב ', tagline: 'גיוס הייטק', about: 'שורה אחת\n\n\n\nשורה שניים', share: { title: 'כותרת', description: '' }, contact: { email: ' Hello@Acme.CO.il ', phone: '+972 (3) 555-1234', website: 'https://Acme.co.il/jobs/', linkedin: 'https://il.linkedin.com/company/acme' } }));
  assert.equal(result.ok, true);
  eq({ ...result.value.contact }, { email: 'hello@acme.co.il', phone: '+97235551234', website: 'https://acme.co.il/jobs/', linkedin: 'https://il.linkedin.com/company/acme' });
  assert.equal(result.value.city, 'תל אביב');
  assert.equal(result.value.about, 'שורה אחת\n\nשורה שניים');
  eq({ ...result.value.share }, { title: 'כותרת' });
  assert.equal('attested' in result.value, false);
});

test('validateHeadhunterInput: error codes', () => {
  assert.equal(failure(null).code, 'INVALID_BODY');
  assert.equal(failure([]).code, 'INVALID_BODY');
  assert.equal(failure('x').code, 'INVALID_BODY');
  assert.equal(failure(valid({ extra: 1 })).code, 'UNKNOWN_FIELD');
  assert.equal(failure(valid({ displayName: 'a' })).code, 'DISPLAY_NAME_INVALID');
  assert.equal(failure(valid({ displayName: 5 })).code, 'DISPLAY_NAME_INVALID');
  assert.equal(failure(valid({ displayName: undefined })).code, 'DISPLAY_NAME_INVALID');
  assert.equal(failure(valid({ displayName: 'a'.repeat(61) })).code, 'FIELD_TOO_LONG');
  assert.equal(check(valid({ displayName: 'a'.repeat(60) })).ok, true);
  assert.equal(failure(valid({ kind: 'company' })).code, 'KIND_INVALID');
  assert.equal(failure(valid({ city: 'x'.repeat(41) })).field, 'city');
  assert.equal(failure(valid({ tagline: 'x'.repeat(91) })).code, 'FIELD_TOO_LONG');
  assert.equal(failure(valid({ about: 'x'.repeat(601) })).code, 'FIELD_TOO_LONG');
  assert.equal(failure(valid({ share: { title: 'x'.repeat(71) } })).field, 'share.title');
  assert.equal(failure(valid({ share: { description: 'x'.repeat(161) } })).field, 'share.description');
  assert.equal(failure(valid({ share: { image: 'x' } })).code, 'FIELD_INVALID');
  assert.equal(failure(valid({ tagline: 7 })).code, 'FIELD_INVALID');
  for (const field of ['displayName', 'city', 'tagline', 'about']) {
    for (const link of ['see http://x.co', 'https://x.co', 'go to www.x.co', 'WWW.X.CO']) {
      const result = failure(valid({ [field]: link }));
      assert.equal(result.code, 'LINKS_NOT_ALLOWED', `${field}: ${link}`);
      assert.equal(result.field, field);
    }
  }
  assert.equal(failure(valid({ share: { title: 'https://x.co' } })).code, 'LINKS_NOT_ALLOWED');
  assert.equal(failure(valid({ share: { description: 'www.x.co' } })).field, 'share.description');
  assert.equal(failure(valid({ contact: {} })).code, 'CONTACT_REQUIRED');
  assert.equal(failure(valid({ contact: undefined })).code, 'CONTACT_REQUIRED');
  assert.equal(failure(valid({ contact: { email: '  ' } })).code, 'CONTACT_REQUIRED');
  assert.equal(failure(valid({ contact: 'a@b.co' })).code, 'CONTACT_INVALID');
  assert.equal(failure(valid({ contact: { fax: '1' } })).code, 'CONTACT_INVALID');
  assert.equal(failure(valid({ contact: { email: 5 } })).code, 'CONTACT_INVALID');
  assert.equal(failure(valid(), { requireAttestation: true }).code, 'ATTESTATION_REQUIRED');
  assert.equal(failure(valid({ attested: 'true' }), { requireAttestation: true }).code, 'ATTESTATION_REQUIRED');
  assert.equal(check(valid({ attested: true }), { requireAttestation: true }).ok, true);
  assert.equal(check(valid({ attested: false })).ok, true, 'attestation is optional unless required');
});

test('validateHeadhunterInput: markup is stripped, not stored', () => {
  const result = check(valid({ tagline: '<b>גיוס</b> <script>alert(1)</script>מהיר' }));
  assert.equal(result.ok, true);
  assert.equal(result.value.tagline.includes('<'), false);
});

test('contact validation per channel', () => {
  const contactError = (contact) => { const result = failure(valid({ contact })); assert.equal(result.code, 'CONTACT_INVALID', JSON.stringify(contact)); return result; };
  const contactValue = (contact) => { const result = check(valid({ contact })); assert.equal(result.ok, true, JSON.stringify(contact)); return result.value.contact; };
  for (const email of ['a@b', 'a b@c.co', '@c.co', 'a@c.c', `${'a'.repeat(120)}@c.co`]) contactError({ email });
  for (const phone of ['123456', '1'.repeat(16), '12-ab-34567', '++9721234567']) contactError({ phone });
  assert.equal(contactValue({ phone: '1234567' }).phone, '1234567');
  assert.equal(contactValue({ phone: '1'.repeat(15) }).phone, '1'.repeat(15));
  assert.equal(contactValue({ whatsapp: '050-123-4567' }).whatsapp, '972501234567');
  assert.equal(contactValue({ whatsapp: '+972 50 123 4567' }).whatsapp, '972501234567');
  assert.equal(contactValue({ whatsapp: '00972501234567' }).whatsapp, '972501234567');
  assert.equal(contactValue({ whatsapp: '972501234567' }).whatsapp, '972501234567');
  contactError({ whatsapp: '0' + '1'.repeat(14) });
  for (const website of ['http://acme.co', 'https://user:pw@acme.co', 'https://localhost', 'acme.co', 'javascript:alert(1)', `https://acme.co/${'a'.repeat(200)}`]) contactError({ website });
  assert.equal(contactValue({ website: 'https://acme.co' }).website, 'https://acme.co/');
  for (const linkedin of ['https://linkedin.com.evil.example/company/x', 'https://evil-linkedin.com/company/x', 'https://notlinkedin.com/in/x', 'https://linkedin.com/pub/x', 'http://linkedin.com/in/x', 'https://linkedin.com/company']) contactError({ linkedin });
  assert.equal(contactValue({ linkedin: 'https://www.linkedin.com/in/dana' }).linkedin, 'https://www.linkedin.com/in/dana');
  assert.equal(contactValue({ linkedin: 'https://linkedin.com/company/acme' }).linkedin, 'https://linkedin.com/company/acme');
});

test('contactLinks order, hrefs and labels', () => {
  eq(validation.contactLinks({}), []);
  const links = validation.contactLinks({ linkedin: 'https://www.linkedin.com/in/dana', website: 'https://acme.co.il/jobs/', whatsapp: '972501234567', phone: '+97235551234', email: 'a@acme.co.il' });
  eq(links.map((link) => ({ ...link })), [
    { kind: 'email', href: 'mailto:a@acme.co.il', label: 'a@acme.co.il' },
    { kind: 'phone', href: 'tel:+97235551234', label: '+97235551234' },
    { kind: 'whatsapp', href: 'https://wa.me/972501234567', label: 'וואטסאפ' },
    { kind: 'website', href: 'https://acme.co.il/jobs/', label: 'acme.co.il/jobs' },
    { kind: 'linkedin', href: 'https://www.linkedin.com/in/dana', label: 'LinkedIn' },
  ]);
  assert.equal(validation.contactLinks({ website: 'https://acme.co/' })[0].label, 'acme.co');
});

test('minisite urls', () => {
  assert.equal(urls.minisitePath('ofek-hr'), '/ofek-hr');
  assert.throws(() => urls.minisitePath('Ofek'));
  assert.throws(() => urls.minisitePath('a--b'));
  assert.throws(() => urls.minisitePath(''));
  assert.equal(urls.minisiteUrl('ofek-hr'), 'https://freelance-place.com/ofek-hr');
  assert.equal(urls.minisiteDisplay('ofek-hr'), 'freelance-place.com/ofek-hr');
  const staging = load('urls', { env: { NEXT_PUBLIC_SITE_URL: 'https://staging.example.org' } });
  assert.equal(staging.minisiteDisplay('ofek-hr'), 'staging.example.org/ofek-hr');
  assert.equal(staging.minisiteUrl('ofek-hr'), 'https://staging.example.org/ofek-hr');
  const www = load('urls', { env: { NEXT_PUBLIC_SITE_URL: 'https://www.freelance-place.com' } });
  assert.equal(www.minisiteDisplay('ofek-hr'), 'freelance-place.com/ofek-hr');
});

test('share fallbacks resolve per field', () => {
  const base = { displayName: 'Acme', handle: 'acme', openProjects: 3 };
  const none = share.resolveHeadhunterShare(base, 'Freelance Place');
  assert.equal(none.title, 'Acme | Freelance Place');
  assert.ok(none.description.includes('3 פרויקטים פתוחים') && none.description.includes('Acme'));
  eq({ ...none.image }, { kind: 'generated', path: '/acme/opengraph-image' });

  const tagline = share.resolveHeadhunterShare({ ...base, tagline: ' גיוס הייטק. ' }, 'Freelance Place');
  assert.equal(tagline.description, 'גיוס הייטק · 3 פרויקטים פתוחים');
  assert.equal(share.resolveHeadhunterShare({ ...base, tagline: 'גיוס הייטק', openProjects: 0 }, 'FP').description, 'גיוס הייטק');
  assert.ok(share.resolveHeadhunterShare({ ...base, openProjects: 0 }, 'FP').description.includes('אין פרויקטים פתוחים'));

  const onlyTitle = share.resolveHeadhunterShare({ ...base, share: { title: ' כותרת מותאמת ' } }, 'Freelance Place');
  assert.equal(onlyTitle.title, 'כותרת מותאמת');
  assert.equal(onlyTitle.description, none.description);
  assert.equal(onlyTitle.image.kind, 'generated');

  const onlyImage = share.resolveHeadhunterShare({ ...base, share: { title: '  ', description: '', imagePath: '/acme/share-image?v=2' } }, 'Freelance Place');
  assert.equal(onlyImage.title, none.title);
  assert.equal(onlyImage.image.kind, 'custom');
  assert.ok(onlyImage.image.url.endsWith('/acme/share-image?v=2') && onlyImage.image.url.startsWith('http'));
  for (const imagePath of ['https://cdn.example/x.png', '//cdn.example/x.png', 'x.png']) {
    assert.equal(share.resolveHeadhunterShare({ ...base, share: { imagePath } }, 'FP').image.kind, 'generated', `no hotlinked image: ${imagePath}`);
  }

  const clamped = share.resolveHeadhunterShare({ ...base, displayName: 'א'.repeat(60), tagline: 'ב'.repeat(300), share: { title: 'ג'.repeat(200) } }, 'Freelance Place');
  assert.ok(clamped.title.length <= 70 && clamped.description.length <= 160);
  assert.ok(share.resolveHeadhunterShare({ ...base, displayName: 'ד'.repeat(60) }, 'Freelance Place').title.length <= 70);
});

test('presentation copy', () => {
  assert.equal(presentation.HEADHUNTER_KIND_LABEL.agency, 'סוכנות גיוס');
  assert.equal(presentation.HEADHUNTER_KIND_LABEL.independent, 'מגייס/ת עצמאי/ת');
  assert.equal(presentation.headhunterTagLabel('Acme'), 'פרויקט של Acme, לעמוד הסוכנות');
  assert.equal(presentation.openProjectsLabel(0), 'אין פרויקטים פתוחים');
  assert.equal(presentation.openProjectsLabel(1), 'פרויקט פתוח אחד');
  assert.equal(presentation.openProjectsLabel(2), '2 פרויקטים פתוחים');
  assert.equal(presentation.progressLabel(7), '7 מתוך 10 פרויקטים');
  assert.equal(presentation.progressLabel(25), '10 מתוך 10 פרויקטים');
  assert.equal(presentation.progressLabel(-1), '0 מתוך 10 פרויקטים');
  assert.equal(presentation.remainingLabel(7), 'עוד 3 פרויקטים לפתיחת עמוד הסוכנות');
  assert.equal(presentation.remainingLabel(9), 'עוד פרויקט אחד לפתיחת עמוד הסוכנות');
  assert.equal(presentation.remainingLabel(10), 'עמדתם בדרישת הפרויקטים');
  assert.ok(presentation.HEADHUNTER_PAGE_NOTE('Acme').includes('Acme'));
  assert.equal(presentation.HEADHUNTER_EMPTY_OPEN, 'אין כרגע פרויקטים פתוחים');
  assert.equal(presentation.HEADHUNTER_CLOSED_HEADING, 'נסגרו לאחרונה');
  assert.equal(presentation.HEADHUNTER_OPEN_HEADING, 'פרויקטים פתוחים');
  assert.equal(presentation.HEADHUNTER_MESSAGE_CTA, 'שליחת הודעה בפלטפורמה');
  const all = Object.values(presentation).map((value) => typeof value === 'function' ? value('x', 'x') : JSON.stringify(value)).join(' ');
  assert.equal(all.includes('סוכן AI'), false);
});
