import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts.mjs';

// Heavy views are loaded with next/dynamic only when opened; in tests they render nothing.
// Default imports of these packages need __esModule so the transpiled `import x from` resolves to the component.
const stubs = {
  'next/dynamic': { __esModule: true, default: () => () => null },
  'next/link': { __esModule: true, default: ({ href, children, prefetch, ...rest }) => createElement('a', { href: String(href), ...rest }, children) },
  'next/image': { __esModule: true, default: ({ src, alt, width, height, priority, ...rest }) => createElement('img', { src, alt, width, height, ...rest }) },
};
const load = (entry, extra = {}) => loadModule(entry, { stubs: { ...stubs, ...extra } });

const base = { title: 'פרויקט', category: 'פיתוח אתרים', description: 'תיאור מלא של הפרויקט.', budget: '₪1,000', deadline: 'גמיש', posted: 'פרויקט חדש', client: 'לקוח/ה', clientHistory: 'פרויקט ראשון', skills: ['עברית'], fit: 'x', activity: 'y', proposals: 0, status: 'open' };
const human = { ...base, slug: 'real-human-1', title: 'אתר לסטודיו אמיתי', createdAt: Date.now() - 1000 };
const agent = { ...base, slug: 'agent project/2', title: 'פרויקט של סוכן', sample: true, ownerKind: 'ai-agent', createdAt: Date.now() - 2000 };
const html = (props = {}) => {
  const { default: WorkspaceHome } = load('src/components/workspace-home.tsx');
  return renderToStaticMarkup(createElement(WorkspaceHome, props, createElement('section', null, createElement('h2', null, 'תוכן גילוי'))));
};
const demoSlugs = () => load('src/lib/data.ts').projects.map((project) => project.slug);

test('SSR markup carries no placeholder text and no zero-value personal KPIs', () => {
  const markup = html({ initialProjects: [human, agent] });
  for (const text of ['בודקים התחברות', 'טוענים את מצב החברות', 'בודקים גישה', 'studio-kpis', 'הפעילות שלך']) assert.ok(!markup.includes(text), `unexpected ${text}`);
  assert.doesNotMatch(markup, /<b>0<\/b>/);
});

test('the h1 is the first heading in the document', () => {
  const markup = html({ initialProjects: [human] });
  const headings = [...markup.matchAll(/<h([1-6])[\s>]/g)].map((match) => match[1]);
  assert.equal(headings[0], '1');
  assert.ok(markup.indexOf('<h1>') < markup.indexOf('<h2'));
  // The personal panel precedes the feed in the DOM (focus order is unchanged) but holds no heading.
  assert.ok(markup.indexOf('class="personal"') < markup.indexOf('<h1>'));
  const personal = markup.slice(markup.indexOf('class="personal"'), markup.indexOf('<main'));
  assert.doesNotMatch(personal, /<h[1-6]/);
});

test('until the viewer is known the home panel keeps its space but is hidden from everyone', () => {
  const markup = html({ initialProjects: [] });
  assert.match(markup, /class="panel-view is-pending"[^>]*aria-hidden="true"/);
  assert.match(markup, /class="auth-entry auth-pending" aria-hidden="true"/);
});

test('anonymous welcome copy replaces the personal KPIs', () => {
  const markup = html({ initialProjects: [] });
  for (const text of ['ברוכים הבאים.', 'התחברו כדי להקים פרופיל, להגיש הצעות ולנהל שיחות. אפשר לעיין בפרויקטים גם בלי חשבון.', 'התחברות והקמת פרופיל']) assert.ok(markup.includes(text), text);
  assert.match(markup, /<a href="\/signin" class="button button-dark welcome-cta">/);
});

test('server-provided projects are in the first paint next to the demo cards', () => {
  const markup = html({ initialProjects: [human, agent] });
  assert.ok(markup.includes('אתר לסטודיו אמיתי') && markup.includes('פרויקט של סוכן'));
  assert.equal((markup.match(/<article class="studio-project/g) || []).length, 2 + demoSlugs().length);
  assert.ok(markup.includes('מחפשים קול חדש למותג קפה מקומי'), 'demo cards stay merged');
});

test('real and AI-agent cards link to their project page; demo cards and buttons do not', () => {
  const markup = html({ initialProjects: [human, agent] });
  const cards = markup.split('<article class="studio-project').slice(1);
  const linked = cards.filter((card) => card.includes('class="studio-open-page"'));
  assert.equal(linked.length, 2);
  assert.match(markup, /<a href="\/projects\/real-human-1" class="studio-open-page" aria-label="פתיחת עמוד הפרויקט"/);
  assert.match(markup, /href="\/projects\/agent%20project%2F2" class="studio-open-page" aria-label="פתיחת עמוד הפרויקט"/);
  for (const slug of demoSlugs()) assert.ok(!markup.includes(`href="/projects/${slug}"`), `demo ${slug} must not be linked`);
  assert.doesNotMatch(markup, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<a[\s>]/);
});

test('without server data (read failed) only the demo cards render and the client may fetch once', () => {
  const markup = html({ initialProjects: null });
  assert.ok(!markup.includes('אתר לסטודיו אמיתי'));
  assert.equal((markup.match(/<article class="studio-project/g) || []).length, demoSlugs().length);
  assert.ok(!markup.includes('studio-open-page'));
});

test('viewerFromSession only accepts a clearly signed-in session', () => {
  const { viewerFromSession, LOADING_VIEWER } = load('src/components/viewer-context.tsx');
  assert.equal(LOADING_VIEWER.status, 'loading');
  const user = { uid: 'u1', email: 'a@b.co', name: 'דנה', picture: null, extra: 'ignored' };
  assert.deepEqual(JSON.parse(JSON.stringify(viewerFromSession(true, { user }))), { status: 'signed-in', user: { uid: 'u1', email: 'a@b.co', name: 'דנה', picture: null } });
  for (const [ok, data] of [[true, { user: null }], [true, {}], [true, null], [true, { user: {} }], [true, { user: { uid: 5 } }], [false, { user }], [true, 'text']]) {
    assert.equal(viewerFromSession(ok, data).status, 'anonymous', JSON.stringify([ok, data]));
  }
});

test('account-only components render nothing visible while the viewer is unknown', () => {
  const { useViewer, ViewerProvider } = load('src/components/viewer-context.tsx');
  assert.throws(() => renderToStaticMarkup(createElement(() => { useViewer(); return null; })), /ViewerProvider/);
  assert.equal(typeof ViewerProvider, 'function');
  // AppShell mounts the provider with AuthControl and TrialStatus inside it.
  const { AppShell } = load('src/components/marketplace.tsx');
  const markup = renderToStaticMarkup(createElement(AppShell, { active: 'discover' }, createElement('p', null, 'תוכן')));
  for (const text of ['בודקים התחברות', 'טוענים את מצב החברות', 'trial-status']) assert.ok(!markup.includes(text), text);
  assert.match(markup, /auth-entry auth-pending/);
});

// Public reads are cached for 60 seconds and keep their cached value plain JSON.
function loadProjects(documents) {
  const cached = [];
  const queries = [];
  const snapshot = (id, data) => ({ id, exists: true, data: () => data, get: (key) => data[key] });
  const firestore = () => ({ collection: () => ({
    where: (...args) => ({ limit: (n) => ({ get: async () => { queries.push({ where: args, limit: n }); return { docs: documents.map(([id, data]) => snapshot(id, data)) }; } }) }),
    doc: (id) => ({ get: async () => { const found = documents.find(([key]) => key === id); return found ? snapshot(...found) : { exists: false, get: () => undefined, data: () => undefined }; } }),
  }) });
  const module = loadModule('src/lib/db/projects.ts', { stubs: { './firestore': { firestore }, 'next/cache': { unstable_cache: (fn, keys, options) => { cached.push({ keys, options }); return fn; } } } });
  return { module, cached, queries };
}
const stamp = (ms) => ({ toMillis: () => ms });
const record = (over) => ({ status: 'open', title: 'כותרת', description: 'תיאור', createdAt: stamp(1000), ...over });

test('listFeedProjects mirrors the public feed: open and closed, listable, newest first, plain JSON', async () => {
  const { module, queries } = loadProjects([
    ['old', record({ createdAt: stamp(1000) })],
    ['new-closed', record({ status: 'closed', createdAt: stamp(3000) })],
    ['private', record({ visibility: 'private', createdAt: stamp(5000) })],
    ['sample', record({ sample: true, owner: { kind: 'ai-agent', name: 'סוכן' }, createdAt: stamp(2000) })],
    ['draft', record({ status: 'draft', createdAt: stamp(6000) })],
  ]);
  const items = await module.listFeedProjects();
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(queries[0]), { where: ['status', 'in', ['open', 'closed']], limit: 100 });
  assert.deepEqual(plain(items.map((item) => item.slug)), ['new-closed', 'sample', 'old']);
  assert.deepEqual(plain(items), items.map((item) => ({ ...item })).map(plain), 'cached value survives a JSON round trip');
  assert.equal(typeof items[0].createdAt, 'number');
});

test('public project reads are cached for 60 seconds with project tags', async () => {
  const { module, cached } = loadProjects([['a b', record()]]);
  await module.listOpenProjects();
  await module.listFeedProjects();
  assert.equal((await module.getOpenProject('a b')).slug, 'a b');
  assert.equal(await module.getOpenProject('missing'), null);
  for (const { options } of cached) { assert.equal(options.revalidate, 60); assert.ok(options.tags.includes('projects')); }
  const perProject = cached.filter(({ keys }) => keys[0] === 'public-project');
  assert.equal(perProject.map(({ options }) => options.tags[1]).join('|'), 'project:a b|project:missing');
  assert.equal(perProject.map(({ keys }) => keys[1]).join('|'), 'a b|missing');
});
