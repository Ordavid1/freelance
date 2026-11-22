import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts.mjs';

// WP6: the apply/edit screen (/profile/headhunter), the entry card, the decision emails and the analytics hooks.

const SITE = 'https://freelance-place.com';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: SITE };
const NOT_FOUND = { digest: 'NEXT_NOT_FOUND' };
const constants = loadModule('src/lib/headhunters/constants.ts', { env });
const MIN = constants.HEADHUNTER_MIN_PROJECTS;

const record = (extra = {}) => ({
  ownerUid: 'u1', status: 'draft', displayName: 'אופק גיוס', handle: 'ofek-hr', kind: 'agency', city: 'תל אביב',
  tagline: 'מחברים פרילנסרים', about: 'סוכנות בוטיק', contact: { email: 'hello@ofek-hr.example', phone: '035550100' },
  counters: { published: 7 }, flags: ['lookalike:secret'], version: 3, ...extra,
});

function loadPage({ enabled = true, configFails = false, user = { uid: 'u1', email: 'a@b.example' }, rec = null, applicationsOpen = true, readFails = false, accountActive = true } = {}) {
  const redirects = [];
  const page = loadModule('src/app/profile/headhunter/page.tsx', { env, stubs: {
    'next/navigation': {
      notFound() { throw Object.assign(new Error('NEXT_NOT_FOUND'), NOT_FOUND); },
      redirect(to) { redirects.push(to); throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' }); },
      useRouter: () => ({ refresh() {} }),
    },
    'next/link': { __esModule: true, default: ({ href, children, prefetch, ...rest }) => createElement('a', { href, ...rest }, children) },
    'next/image': { __esModule: true, default: ({ src, alt }) => createElement('img', { src, alt }) },
    '@/components/support-chat': { SupportHeaderActions: ({ children }) => createElement('div', { className: 'actions' }, children) },
    '@/lib/auth/session': { getCurrentUser: async () => user },
    '@/lib/db/headhunters': {
      getHeadhunterConfig: async () => { if (configFails) throw new Error('down'); return { enabled, applicationsOpen }; },
      getHeadhunter: async () => { if (readFails) throw new Error('down'); return rec; },
      isAccountActive: async () => accountActive,
    },
  } });
  return { page, redirects };
}
const html = async (options) => renderToStaticMarkup(await loadPage(options).page.default());

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

test('page: 404 while the feature switch is off or unreadable, even when signed out', async () => {
  await assert.rejects(loadPage({ enabled: false }).page.default(), NOT_FOUND);
  await assert.rejects(loadPage({ enabled: false, user: null }).page.default(), NOT_FOUND);
  await assert.rejects(loadPage({ configFails: true }).page.default(), NOT_FOUND);
});

test('page: signed-out visitors are sent to sign in and come back to this page', async () => {
  const { page, redirects } = loadPage({ user: null });
  await assert.rejects(page.default(), { digest: 'NEXT_REDIRECT' });
  assert.deepEqual(redirects, ['/signin?next=%2Fprofile%2Fheadhunter']);
  const { safeNextPath } = loadModule('src/lib/auth/safe-next.ts');
  assert.equal(safeNextPath('/profile/headhunter'), '/profile/headhunter');
  assert.equal(safeNextPath('/profile/headhunter?x=1'), '/', 'only the exact path is allowed');
});

test('page: noindex metadata, and the path is private', async () => {
  const { page } = loadPage();
  assert.equal(page.metadata.robots.index, false);
  const site = loadModule('src/lib/seo/site.ts', { env });
  assert.equal(site.isPrivatePath('/profile/headhunter'), true);
});

// ---------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------

test('state: applications closed shows a short note and no form', async () => {
  const out = await html({ applicationsOpen: false });
  assert.match(out, /ההרשמה לעמודי סוכנויות טרם נפתחה/);
  assert.doesNotMatch(out, /<form/);
  assert.match(out, new RegExp(`אחרי ${MIN} פרויקטים ואישור`), 'the page intro takes the threshold from the constant');
});

test('state: no record shows the apply form with counters, hints, the public-contact notice and the attestation', async () => {
  const out = await html();
  assert.match(out, /<h1>עמוד הסוכנות שלי<\/h1>/);
  assert.match(out, /<form/);
  assert.match(out, /שליחת הבקשה/);
  assert.match(out, /type="checkbox"/);
  assert.match(out, /0 \/ 60/); assert.match(out, /0 \/ 90/); assert.match(out, /0 \/ 600/); assert.match(out, /0 \/ 70/); assert.match(out, /0 \/ 160/);
  assert.match(out, /freelance-place\.com\//);
  assert.match(out, /אותיות לטיניות בלבד/);
  assert.match(out, /יפורסמו בעמוד הסוכנות/);
  assert.match(out, new RegExp(`אחרי ${MIN} פרויקטים שפורסמו`));
  assert.match(out, /placeholder="[^"]*\| Freelance Place"/, 'the share title shows its fallback as the placeholder');
  assert.doesNotMatch(out, /החלפת כתובת/, 'no rename before a record exists');
  assert.match(out, /הזינו כתובת תקינה/, 'no tag preview without a handle');
});

test('state: draft shows the progress meter, the remaining label and a link to publish a project', async () => {
  const out = await html({ rec: record() });
  assert.match(out, /טיוטה · עוד לא פורסם/);
  assert.match(out, new RegExp(`7 מתוך ${MIN} פרויקטים`));
  assert.match(out, /עוד 3 פרויקטים לפתיחת עמוד הסוכנות/);
  assert.match(out, /role="progressbar"[^>]*aria-valuenow="7"/);
  assert.match(out, /width:70%/);
  assert.match(out, /<a href="\/projects\/new"[^>]*>לפרסום פרויקט<\/a>/);
  assert.match(out, /שמירת שינויים/);
  assert.doesNotMatch(out, /נדרשים שינויים/);
  assert.match(out, /value="אופק גיוס"/);
  assert.match(out, /החלפת כתובת/);
  assert.match(out, /ממשיכה להפנות/);
  assert.doesNotMatch(out, /lookalike|u1/, 'internal flags and the owner uid are never rendered');
});

test('state: changes requested shows the moderator reason', async () => {
  const out = await html({ rec: record({ counters: { published: 12 }, eligibleAt: 1, reviewReason: 'הוסיפו קישור לאתר החברה' }) });
  assert.match(out, /נדרשים שינויים/);
  assert.match(out, /הוסיפו קישור לאתר החברה/);
  assert.match(out, /חוזרת לבדיקה/);
});

test('state: pending says it is under review and stays editable', async () => {
  const out = await html({ rec: record({ status: 'pending', counters: { published: 12 }, eligibleAt: 1 }) });
  assert.match(out, /הבקשה בבדיקה/);
  assert.match(out, /ממתין לאישור/);
  assert.match(out, /שמירת שינויים/);
  assert.doesNotMatch(out, /role="progressbar"/);
});

test('state: approved shows the live address, copy and open actions, and the live tag preview', async () => {
  const out = await html({ rec: record({ status: 'approved', counters: { published: 12 }, eligibleAt: 1 }) });
  assert.match(out, /העמוד פעיל/);
  assert.match(out, /<code dir="ltr">freelance-place\.com\/ofek-hr<\/code>/);
  assert.match(out, /העתקת הקישור/);
  assert.match(out, /<a href="\/ofek-hr" class="hh-ed-btn pri">לצפייה בעמוד<\/a>/);
  assert.match(out, /class="hh-tag"/);
  assert.match(out, /התג והעמוד פעילים/);
  assert.match(out, /שמירת שינויים/);
});

test('state: approved but account restricted is not shown as live', async () => {
  const out = await html({ rec: record({ status: 'approved', counters: { published: 12 }, eligibleAt: 1 }), accountActive: false });
  assert.doesNotMatch(out, /העתקת הקישור/);
});

for (const [status, field, reason, title] of [['rejected', 'rejectedReason', 'השם דומה מדי לשם קיים', 'הבקשה לא אושרה'], ['suspended', 'suspendedReason', 'תלונה על תוכן', 'העמוד הושהה']]) {
  test(`state: ${status} is read-only with the reason and a support path`, async () => {
    const out = await html({ rec: record({ status, [field]: reason, counters: { published: 12 }, eligibleAt: 1 }) });
    assert.match(out, new RegExp(title));
    assert.match(out, new RegExp(reason));
    assert.match(out, /צ׳אט התמיכה/);
    assert.doesNotMatch(out, /<form/);
    assert.doesNotMatch(out, /<input/);
  });
}

test('state: an unreadable record shows a short error, not the apply form', async () => {
  const out = await html({ readFails: true });
  assert.match(out, /לא הצלחנו לטעון/);
  assert.doesNotMatch(out, /<form/);
});

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

const editor = loadModule('src/lib/headhunters/editor.ts', { env });

test('editor helpers: mode, request body, field mapping', () => {
  const view = (status) => ({ status });
  assert.equal(editor.editorMode(null, true), 'apply');
  assert.equal(editor.editorMode(null, false), 'closed');
  assert.deepEqual(['draft', 'pending', 'approved', 'rejected', 'suspended'].map((status) => editor.editorMode(view(status), true)), ['draft', 'pending', 'approved', 'readonly', 'readonly']);

  const values = { ...editor.EMPTY_FORM, displayName: ' אופק ', handle: ' OFEK-HR ', email: ' a@b.example ', shareTitle: 'כותרת', attested: true };
  const apply = editor.requestBody(values, { apply: true });
  assert.equal(apply.handle, 'ofek-hr'); assert.equal(apply.attested, true); assert.equal(apply.displayName, 'אופק');
  assert.deepEqual({ ...apply.contact }, { email: 'a@b.example' });
  assert.deepEqual({ ...apply.share }, { title: 'כותרת' });
  const edit = editor.requestBody(values, { apply: false });
  assert.equal('handle' in edit, false); assert.equal('attested' in edit, false);
  assert.deepEqual({ ...editor.requestBody({ ...values, shareTitle: '' }, { apply: false }).share }, {}, 'an emptied share block is sent so PATCH clears it');

  assert.equal(editor.formKeyForField('share.title'), 'shareTitle');
  assert.equal(editor.formKeyForField('contact.email'), 'email');
  assert.equal(editor.formKeyForField('contact'), 'contact');
  assert.equal(editor.formKeyForField('handle'), 'handle');
  assert.equal(editor.formKeyForField(undefined), null);
});

test('editor helpers: preview never throws on half-typed input', () => {
  const view = editor.previewView({ ...editor.EMPTY_FORM, handle: 'Not Valid!', whatsapp: '050-1', website: 'https://x.example/' }, 'שם');
  assert.equal(view.displayName, 'שם'); assert.equal(view.handle, '');
  assert.deepEqual([...view.contact.map((link) => link.kind)], ['whatsapp', 'website']);
  assert.equal(view.contact[0].href, 'https://wa.me/0501');
});

// ---------------------------------------------------------------------------------------------
// Entry card on the profile page
// ---------------------------------------------------------------------------------------------

test('entry card: copy and link, with the threshold from the constant', () => {
  const { HeadhunterEntry } = loadModule('src/components/headhunter-entry.tsx', { env, stubs: { 'next/link': { __esModule: true, default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children) } } });
  const out = renderToStaticMarkup(createElement(HeadhunterEntry));
  assert.match(out, /עמוד סוכנות גיוס/);
  assert.match(out, new RegExp(`אחרי ${MIN} פרויקטים ואישור`));
  assert.match(out, /href="\/profile\/headhunter"/);
});

test('profile page: passes the entry flag only while the switch is on', async () => {
  const props = [];
  const load = (config) => loadModule('src/app/profile/import/page.tsx', { env, stubs: {
    '@/components/workspace-home': { __esModule: true, default: (p) => { props.push(p); return null; } },
    '@/lib/db/headhunters': { headhunterEntryEnabled: config },
  } });
  for (const config of [async () => true, async () => false]) {
    const element = await load(config).default();
    props.push(element.props);
  }
  assert.deepEqual(props.map((p) => p.headhunterEntry), [true, false]);
});

// ---------------------------------------------------------------------------------------------
// Decision emails
// ---------------------------------------------------------------------------------------------

const mail = loadModule('src/lib/headhunters/mail.ts', { env });

test('email: approval carries the minisite URL and a sharing line, and nothing else', () => {
  const built = mail.buildDecisionMail({ action: 'approve', handle: 'ofek-hr', displayName: 'אופק גיוס', reason: 'internal' });
  assert.match(built.subject, /אושר/);
  assert.match(built.text, /https:\/\/freelance-place\.com\/ofek-hr/);
  assert.match(built.html, /href="https:\/\/freelance-place\.com\/ofek-hr"/);
  assert.match(built.text, /אפשר לשתף את הקישור/);
  assert.doesNotMatch(built.text + built.html, /internal|ofek-hr\.example|lookalike|u1/, 'no reason, contact or flags in the approval');
});

test('email: rejection and requested changes carry the reason and the editor link', () => {
  for (const [action, subject] of [['reject', /לא אושרה/], ['request-changes', /נדרשים שינויים/]]) {
    const built = mail.buildDecisionMail({ action, handle: 'ofek-hr', displayName: 'אופק גיוס', reason: 'הוסיפו <b>אתר</b>' });
    assert.match(built.subject, subject);
    assert.match(built.text, /הסיבה: הוסיפו <b>אתר<\/b>/);
    assert.match(built.html, /הוסיפו &lt;b&gt;אתר&lt;\/b&gt;/, 'the reason is escaped in HTML');
    assert.match(built.text, /https:\/\/freelance-place\.com\/profile\/headhunter/);
    assert.doesNotMatch(built.text, /\/ofek-hr/, 'no minisite link before approval');
  }
});

test('email: suspend and reinstate send nothing', () => {
  for (const action of ['suspend', 'reinstate']) assert.equal(mail.buildDecisionMail({ action, handle: 'ofek-hr', displayName: 'x' }), null);
});

test('email: the origin comes from the site configuration', () => {
  const other = loadModule('src/lib/headhunters/mail.ts', { env: { ...env, NEXT_PUBLIC_SITE_URL: 'https://staging.example' } });
  assert.match(other.buildDecisionMail({ action: 'approve', handle: 'ofek-hr', displayName: 'x' }).text, /https:\/\/staging\.example\/ofek-hr/);
});

function loadSender({ sendResult = { data: { id: 'm1' } }, identity = { email: 'owner@example.com', emailVerified: true, disabled: false }, config = { RESEND_API_KEY: 're_x', SUPPORT_FROM_EMAIL: 'Freelance Place <support@freelance-place.com>' }, throws = false } = {}) {
  const sent = [];
  const module = loadModule('src/lib/notifications/headhunter-mail.ts', { env: { ...env, ...config }, stubs: {
    resend: { Resend: class { constructor(key) { this.key = key; } emails = { send: async (message) => { if (throws) throw new Error('network'); sent.push(message); return sendResult; } }; } },
    '@/lib/auth/firebase-admin': { adminAuth: () => ({ getUser: async () => identity }) },
    '@/lib/support/config': { mailbox: (value) => (/@/.test(value) ? value : null) },
  } });
  return { module, sent };
}
const approval = { action: 'approve', handle: 'ofek-hr', displayName: 'אופק גיוס' };

test('sender: delivers to the account address with the project-notification sender', async () => {
  const { module, sent } = loadSender();
  assert.equal(await module.sendHeadhunterDecisionMail('u1', approval), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.equal(sent[0].from, 'Freelance Place <support@freelance-place.com>');
  assert.match(sent[0].text, /https:\/\/freelance-place\.com\/ofek-hr/);
});

test('sender: skips without configuration, for unverified or disabled accounts and for silent actions', async () => {
  assert.equal(await loadSender({ config: {} }).module.sendHeadhunterDecisionMail('u1', approval), 'skipped');
  assert.equal(await loadSender({ identity: { email: 'a@b.example', emailVerified: false } }).module.sendHeadhunterDecisionMail('u1', approval), 'skipped');
  assert.equal(await loadSender({ identity: { email: 'a@b.example', emailVerified: true, disabled: true } }).module.sendHeadhunterDecisionMail('u1', approval), 'skipped');
  const { module, sent } = loadSender();
  assert.equal(await module.sendHeadhunterDecisionMail('u1', { ...approval, action: 'suspend' }), 'skipped');
  assert.equal(sent.length, 0);
});

test('sender: a provider error or a network failure is reported, never thrown', async () => {
  assert.equal(await loadSender({ sendResult: { error: { message: 'rate' } } }).module.sendHeadhunterDecisionMail('u1', approval), 'failed');
  assert.equal(await loadSender({ throws: true }).module.sendHeadhunterDecisionMail('u1', approval), 'failed');
});

test('decision hook: starts the email and never throws when the email module fails', async () => {
  const calls = [];
  const warnings = [];
  const load = (send) => loadModule('src/lib/headhunters/events.ts', { env, stubs: {
    './indexnow.ts': { announceMinisites: () => {} },
    '../notifications/headhunter-mail.ts': { sendHeadhunterDecisionMail: send },
  } });
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const ok = load(async (uid, event) => { calls.push([uid, event.action]); return 'sent'; });
    assert.doesNotThrow(() => ok.onHeadhunterDecision({ uid: 'u1', action: 'approve', handle: 'ofek-hr', displayName: 'x' }));
    const failing = load(async () => { throw new Error('resend down'); });
    assert.doesNotThrow(() => failing.onHeadhunterDecision({ uid: 'u1', action: 'reject', handle: 'ofek-hr', displayName: 'x', reason: 'abc' }));
    const sync = load(() => { throw new Error('sync boom'); });
    assert.doesNotThrow(() => sync.onHeadhunterDecision({ uid: 'u1', action: 'approve', handle: 'ofek-hr', displayName: 'x' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally { console.warn = original; }
  assert.deepEqual(calls, [['u1', 'approve']]);
  assert.ok(warnings.length >= 2, 'failures are logged as warnings');
});

// ---------------------------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------------------------

test('analytics: the contact list keeps its markup with tracking on, and the preview header is a level-2 heading', () => {
  const minisite = loadModule('src/components/headhunter-minisite.tsx', { env, stubs: { '@/lib/analytics': { trackEvent() {} } } });
  const links = [{ kind: 'email', href: 'mailto:a@b.example', label: 'a@b.example' }, { kind: 'whatsapp', href: 'https://wa.me/97250', label: 'וואטסאפ' }];
  const live = renderToStaticMarkup(createElement(minisite.HeadhunterContact, { links, handle: 'ofek-hr' }));
  assert.match(live, /^<ul class="hh-contact" aria-label="[^"]+"><li><a href="mailto:a@b\.example">/, 'the markup is the same as without tracking');
  const hero = renderToStaticMarkup(createElement(minisite.HeadhunterHero, { view: { displayName: 'x', handle: 'ofek-hr', kind: 'agency', contact: links, share: {} }, openCount: 0, publishedCount: 0, preview: true }));
  assert.match(hero, /<h2 id="hh-name">x<\/h2>/);
});

test('analytics: a contact click sends the handle and channel only', () => {
  const events = [];
  const { ContactClickTracker } = loadModule('src/components/headhunter-contact-tracker.tsx', { env, stubs: { '@/lib/analytics': { trackEvent: (name, params) => events.push([name, params]) } } });
  const element = ContactClickTracker({ handle: 'ofek-hr', label: 'x', children: null });
  const click = (href) => element.props.onClick({ target: { closest: () => (href ? { getAttribute: () => href } : null) } });
  for (const href of ['tel:0501234567', 'mailto:a@b.example', 'https://wa.me/97250', 'https://www.linkedin.com/company/acme', 'https://acme.example', null]) click(href);
  assert.deepEqual(events.map(([name, params]) => [name, { ...params }]), ['phone', 'email', 'whatsapp', 'linkedin', 'website'].map((channel) => ['headhunter_contact_click', { handle: 'ofek-hr', channel }]));
});
