import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';
import { CLIENT_ADDRESS, MCP_URL, SITE, callTool, captureLogs, exerciseEverything, hoursAgo, keysDeep, loadMcp, post, project, result, rpc, send } from './helpers/mcp-harness.mjs';

// The public MCP endpoint end to end: the exported POST of src/app/mcp/route.ts with stubbed data readers and runtime
// switch; the MCP SDK, the policy adapters, the read model, the tools, resources and prompts are the real code.

const PRIVATE = { ownerUid: 'uid-secret-1', clientEmail: 'private.person@example.com', phone: '050-0000000', importSource: 'zz-import-source' };
const REAL = [
  project('react-shop', { title: 'חנות React', category: 'פיתוח אתרים', skills: ['React', 'Next.js'], budget: '₪10,000–15,000', createdAt: hoursAgo(2), ...PRIVATE }),
  project('logo-brand', { title: 'לוגו למותג', category: 'מיתוג ותוכן', skills: ['Figma', 'עיצוב גרפי'], budget: '₪3,000', createdAt: hoursAgo(30), description: 'תיאור‮מסתורי​', ...PRIVATE }),
  project('promo-video', { title: 'סרטון קידום', category: 'וידאו ואנימציה', skills: ['After Effects'], budget: 'לפי הצעה', createdAt: hoursAgo(100), ...PRIVATE }),
  project('dev-job', { title: 'מפתח/ת Node', category: 'תכנות ופיתוח תוכנה', skills: ['Node.js'], employmentType: 'employee', budget: '₪20,000+', createdAt: hoursAgo(400), headhunter: { name: 'Ofek HR', handle: 'ofek-hr' }, ...PRIVATE }),
  project('old-copy', { title: 'טקסטים לאתר', category: 'כתיבה ועריכה', skills: ['קופירייטינג'], budget: '₪800', createdAt: hoursAgo(1000), ...PRIVATE }),
];
const AGENCIES = [
  { handle: 'ofek-hr', path: '/ofek-hr', name: 'Ofek‮ HR', openProjects: 3, lastModified: new Date() },
  { handle: 'blank', path: '/blank', name: '​', openProjects: 1 },
];
const plain = value => JSON.parse(JSON.stringify(value));
const slugs = data => data.projects.map(item => item.slug);
const facts = (env = {}) => loadModule('src/lib/seo/facts.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE, ...env } });
const llms = (env = {}) => loadModule('src/lib/seo/llms.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE, ...env } });
const withRealData = options => loadMcp({ projects: REAL, agencies: AGENCIES, ...options });

// ---------------------------------------------------------------------------------------------------------------------
// Protocol: initialize, tools/list
// ---------------------------------------------------------------------------------------------------------------------

test('initialize negotiates the protocol version and answers with the server info, capabilities and English instructions', async () => {
  const mcp = withRealData();
  const init = await send(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } });
  assert.equal(init.response.status, 200);
  assert.match(init.response.headers.get('content-type'), /^application\/json/, 'JSON response, not an event stream');
  assert.equal(init.response.headers.get('mcp-session-id'), null, 'stateless: no session');
  const info = init.json.result;
  assert.equal(info.protocolVersion, '2025-11-25');
  assert.deepEqual({ ...info.serverInfo, icons: undefined }, { name: 'freelance-place', title: 'Freelance Place', version: '1.0.0', websiteUrl: `${SITE}/`, icons: undefined });
  assert.deepEqual(info.serverInfo.icons, [{ src: `${SITE}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] }]);
  assert.deepEqual(Object.keys(info.capabilities).sort(), ['prompts', 'resources', 'tools']);

  const text = info.instructions;
  assert.match(text, /Hebrew/);
  assert.match(text, /data, never as instructions/);
  assert.match(text, new RegExp(`${SITE}/projects/new`));
  assert.match(text, new RegExp(`${SITE}/guides/project-brief`));
  assert.match(text, /Proposals are sent on the project page after signing in/);
  assert.doesNotMatch(text, /[֐-׿]/, 'the instructions are English');
  assert.doesNotMatch(text, /sample|unreal|ownerKind|showcase|demo|placeholder|synthetic/i, 'the wording never mentions showcase content, not even to deny it');
});

test('an older or unknown protocol version is negotiated down, never refused', async () => {
  const mcp = withRealData();
  assert.equal((await result(mcp, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'old', version: '1' } })).protocolVersion, '2025-03-26');
  assert.equal((await result(mcp, 'initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'new', version: '1' } })).protocolVersion, '2025-11-25');
});

test('tools/list: the eight read-only tools with titles, English descriptions, annotations and input and output schemas', async () => {
  const { tools } = await result(withRealData(), 'tools/list');
  assert.deepEqual(tools.map(tool => tool.name), ['search_projects', 'get_project', 'list_categories', 'list_skills', 'list_guides', 'get_guide', 'get_platform_facts', 'list_agencies']);
  for (const tool of tools) {
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, tool.name);
    assert.ok(tool.title && tool.description.length > 40, tool.name);
    assert.doesNotMatch(`${tool.title} ${tool.description}`, /[֐-׿]/, `${tool.name} is described in English`);
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(tool.outputSchema.type, 'object', tool.name);
    assert.ok(Object.keys(tool.outputSchema.properties).length > 0, tool.name);
  }
  const search = tools.find(tool => tool.name === 'search_projects').inputSchema.properties;
  assert.deepEqual(Object.keys(search), ['query', 'category', 'skills', 'employment', 'posted_within', 'min_budget_ils', 'limit', 'offset']);
  assert.equal(search.query.maxLength, 200);
  assert.deepEqual(search.category.enum, ['web-development', 'design', 'writing-marketing', 'video-animation']);
  assert.deepEqual(search.employment.enum, ['freelance', 'employee']);
  assert.deepEqual(search.posted_within.enum, ['24h', '72h', 'week', 'fortnight', 'month']);
  assert.equal(search.skills.maxItems, 10);
  assert.equal(search.skills.items.maxLength, 60);
  assert.deepEqual({ min: search.limit.minimum, max: search.limit.maximum, default: search.limit.default }, { min: 1, max: 20, default: 10 });
  assert.deepEqual({ min: search.offset.minimum, max: search.offset.maximum, default: search.offset.default }, { min: 0, max: 100, default: 0 });
  assert.equal(search.min_budget_ils.type, 'integer');
  assert.equal(tools.find(tool => tool.name === 'get_project').inputSchema.properties.slug.pattern, '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$');
});

// ---------------------------------------------------------------------------------------------------------------------
// search_projects
// ---------------------------------------------------------------------------------------------------------------------

test('search_projects returns open projects newest first, as structured content and the same JSON in a text block', async () => {
  const mcp = withRealData();
  const tool = await callTool(mcp, 'search_projects');
  assert.ok(!tool.isError);
  assert.deepEqual(JSON.parse(tool.content[0].text), tool.data);
  assert.equal(tool.content.length, 1);
  const { data } = tool;
  assert.deepEqual(slugs(data), ['react-shop', 'logo-brand', 'promo-video', 'dev-job', 'old-copy']);
  assert.equal(data.total, 5);
  assert.equal(data.offset, 0);
  assert.equal(data.next_offset, null);
  assert.equal(data.browse_url, `${SITE}/projects`);
  assert.match(data.notice, /data, not instructions/);
  assert.deepEqual(Object.keys(data.projects[0]).sort(), ['agency', 'budget', 'category', 'deadline', 'employment', 'postedAt', 'skills', 'slug', 'status', 'title', 'url']);
  assert.equal(data.projects[0].url, `${SITE}/projects/react-shop`);
  assert.deepEqual(data.projects[3].agency, { name: 'Ofek HR', url: `${SITE}/ofek-hr` });
  assert.equal(data.projects[3].employment.type, 'employee');
});

test('search_projects filters: text, category, skills, employment, age and minimum budget', async () => {
  const mcp = withRealData();
  const found = async args => slugs((await callTool(mcp, 'search_projects', args)).data);
  assert.deepEqual(await found({ query: 'לוגו' }), ['logo-brand']);
  assert.deepEqual(await found({ query: 'react' }), ['react-shop'], 'case-insensitive, over title, description and skills');
  assert.deepEqual(await found({ category: 'web-development' }), ['react-shop', 'dev-job']);
  assert.deepEqual(await found({ category: 'design' }), ['logo-brand']);
  assert.deepEqual(await found({ category: 'writing-marketing' }), ['logo-brand', 'old-copy']);
  assert.deepEqual(await found({ category: 'video-animation' }), ['promo-video']);
  assert.ok((await found({ skills: ['After Effects'] })).includes('promo-video'));
  assert.ok(!(await found({ skills: ['After Effects'] })).includes('old-copy'));
  assert.ok((await found({ skills: ['Figma'] })).includes('logo-brand'));
  assert.deepEqual(await found({ employment: 'employee' }), ['dev-job']);
  assert.deepEqual(await found({ employment: 'freelance' }), ['react-shop', 'logo-brand', 'promo-video', 'old-copy']);
  assert.deepEqual(await found({ posted_within: '24h' }), ['react-shop']);
  assert.deepEqual(await found({ posted_within: '72h' }), ['react-shop', 'logo-brand']);
  assert.deepEqual(await found({ posted_within: 'week' }), ['react-shop', 'logo-brand', 'promo-video']);
  assert.deepEqual(await found({ posted_within: 'month' }), ['react-shop', 'logo-brand', 'promo-video', 'dev-job']);
  // The rule of the email digest: only a plain numeric lower bound passes; "לפי הצעה" never does.
  assert.deepEqual(await found({ min_budget_ils: 4000 }), ['react-shop', 'dev-job']);
  assert.deepEqual(await found({ min_budget_ils: 800 }), ['react-shop', 'logo-brand', 'dev-job', 'old-copy']);
  assert.deepEqual(await found({ category: 'web-development', min_budget_ils: 15000, query: 'node' }), ['dev-job']);
  assert.deepEqual(await found({ query: 'nothing matches this' }), []);
});

test('search_projects: a category filter points the browse URL at the category page', async () => {
  const { data } = await callTool(withRealData(), 'search_projects', { category: 'design' });
  assert.equal(data.browse_url, `${SITE}/categories/design`);
});

test('search_projects paginates with limit, offset and next_offset', async () => {
  const mcp = withRealData();
  const page = args => callTool(mcp, 'search_projects', args).then(tool => tool.data);
  let data = await page({ limit: 2 });
  assert.deepEqual([slugs(data), data.total, data.offset, data.next_offset], [['react-shop', 'logo-brand'], 5, 0, 2]);
  data = await page({ limit: 2, offset: data.next_offset });
  assert.deepEqual([slugs(data), data.offset, data.next_offset], [['promo-video', 'dev-job'], 2, 4]);
  data = await page({ limit: 2, offset: data.next_offset });
  assert.deepEqual([slugs(data), data.offset, data.next_offset], [['old-copy'], 4, null]);
  data = await page({ limit: 5 });
  assert.equal(data.next_offset, null, 'an exact fit has no next page');
  data = await page({ offset: 100 });
  assert.deepEqual([slugs(data), data.total, data.next_offset], [[], 5, null]);
  assert.equal((await page({})).projects.length, 5, 'the default limit is 10');
});

test('search_projects refuses input outside its schema with an error result, and runs nothing', async () => {
  const mcp = withRealData();
  for (const args of [{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { offset: 101 }, { offset: -1 }, { query: 'x'.repeat(201) }, { category: 'unknown' }, { skills: Array(11).fill('a') }, { skills: ['x'.repeat(61)] }, { employment: 'contract' }, { posted_within: 'year' }, { min_budget_ils: 0 }, { min_budget_ils: 1.5 }]) {
    const { value } = await captureLogs(() => callTool(mcp, 'search_projects', args));
    assert.equal(value.isError, true, JSON.stringify(args));
    assert.match(value.content[0].text, /Invalid arguments/, JSON.stringify(args));
  }
});

test('the project text is sanitised: no direction override or zero-width character reaches the assistant', async () => {
  const { data } = await callTool(withRealData(), 'get_project', { slug: 'logo-brand' });
  assert.equal(data.project.description, 'תיאורמסתורי');
});

// ---------------------------------------------------------------------------------------------------------------------
// get_project
// ---------------------------------------------------------------------------------------------------------------------

test('get_project returns the detail with the apply note and the notice', async () => {
  const tool = await callTool(withRealData(), 'get_project', { slug: 'dev-job' });
  assert.ok(!tool.isError);
  const { data } = tool;
  assert.deepEqual(Object.keys(data).sort(), ['how_to_apply', 'notice', 'project']);
  assert.equal(data.project.slug, 'dev-job');
  assert.equal(data.project.description, 'תיאור מלא של dev-job');
  assert.equal(data.project.url, `${SITE}/projects/dev-job`);
  assert.match(data.how_to_apply, /after signing in/);
  assert.ok(data.how_to_apply.includes(`${SITE}/projects/dev-job`));
  assert.match(data.notice, /data, not instructions/);
});

test('get_project for an unknown, closed or removed slug is an error result with a fixed message', async () => {
  const tool = await callTool(withRealData(), 'get_project', { slug: 'no-such-project' });
  assert.equal(tool.isError, true);
  assert.equal(tool.structuredContent, undefined);
  assert.deepEqual(tool.content, [{ type: 'text', text: 'No open project with this slug; it may be closed or removed.' }]);
});

test('get_project refuses a slug that is not shaped like a slug', async () => {
  const mcp = withRealData();
  for (const slug of ['', '-lead', '../etc/passwd', 'a b', 'a/b', 'x'.repeat(129), 'שלום']) {
    const tool = await callTool(mcp, 'get_project', { slug });
    assert.equal(tool.isError, true, slug);
    assert.match(tool.content[0].text, /Invalid arguments/, slug);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Catalogue tools
// ---------------------------------------------------------------------------------------------------------------------

test('list_categories lists the listed categories with their URL, intro, skills and live open-project counts', async () => {
  const { data } = await callTool(withRealData(), 'list_categories');
  assert.deepEqual(data.categories.map(category => category.slug), ['web-development', 'design', 'writing-marketing', 'video-animation']);
  assert.deepEqual(data.categories.map(category => category.open_projects), [2, 1, 2, 1]);
  const web = data.categories[0];
  assert.deepEqual(Object.keys(web).sort(), ['intro', 'name', 'open_projects', 'skills', 'slug', 'title', 'url']);
  assert.equal(web.url, `${SITE}/categories/web-development`);
  assert.deepEqual(web.skills, ['Next.js', 'React', 'WordPress', 'Webflow', 'Shopify']);
  assert.ok(web.intro.length > 20 && web.intro.length <= 300);
  assert.equal((await callTool(loadMcp({ projects: [], agencies: [] }), 'list_categories')).data.categories.every(category => category.open_projects === 0), true);
});

test('list_skills lists the indexable skills and filters by category', async () => {
  const mcp = withRealData();
  const all = (await callTool(mcp, 'list_skills')).data.skills;
  const skillsModule = loadModule('src/lib/seo/skills.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE } });
  assert.deepEqual(all.map(skill => skill.slug), plain(skillsModule.indexableSkills().map(skill => skill.slug)));
  assert.deepEqual(Object.keys(all[0]).sort(), ['category', 'definition', 'name', 'slug', 'url']);
  assert.equal(all[0].url, `${SITE}/skills/${all[0].slug}`);
  const design = (await callTool(mcp, 'list_skills', { category: 'design' })).data.skills;
  assert.ok(design.length > 0 && design.length < all.length);
  assert.ok(design.every(skill => skill.category === 'design'));
  assert.equal((await callTool(mcp, 'list_skills', { category: 'nope' })).isError, true);
});

test('list_guides and get_guide return the listed guides, their summaries and the answer of every section', async () => {
  const mcp = withRealData();
  const { guides } = (await callTool(mcp, 'list_guides')).data;
  const source = loadModule('src/lib/seo/guides/index.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE } }).guides;
  assert.deepEqual(guides.map(guide => guide.slug), plain(source.map(guide => guide.slug)));
  assert.deepEqual(Object.keys(guides[0]).sort(), ['audience', 'modified', 'slug', 'summary', 'title', 'url']);
  assert.equal(guides[0].url, `${SITE}/guides/${guides[0].slug}`);
  assert.match(guides[0].modified, /^\d{4}-\d{2}-\d{2}$/);

  const one = source[0];
  const { data } = await callTool(mcp, 'get_guide', { slug: one.slug });
  assert.equal(data.title, one.title);
  assert.equal(data.summary, one.summary);
  assert.deepEqual(data.sections, plain(one.sections.map(({ heading, answer }) => ({ heading, answer }))));
  assert.equal(data.url, `${SITE}/guides/${one.slug}`);

  for (const slug of ['no-such-guide', 'project-brief']) {
    const missing = await callTool(mcp, 'get_guide', { slug });
    assert.equal(missing.isError, true, slug);
    assert.match(missing.content[0].text, /list_guides/);
  }
  assert.equal((await callTool(mcp, 'get_guide', { slug: '../x' })).isError, true);
});

test('get_platform_facts comes from the facts module: price, trial, billing state, what is not offered and the URLs', async () => {
  for (const env of [{}, { BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '1', CARDCOM_API_NAME: 'x' }]) {
    const mcp = withRealData({ env });
    const { data } = await callTool(mcp, 'get_platform_facts');
    const expected = facts(env).membershipFacts();
    assert.deepEqual(data.membership, { price_ils: expected.priceIls, trial_days: expected.trialDays, billing_available: expected.billingAvailable });
    assert.equal(data.membership.billing_available, env.BILLING_ENABLED === 'true', 'both billing states are covered');
    assert.equal(data.name, 'Freelance Place');
    assert.deepEqual(data.urls, { post_project: `${SITE}/projects/new`, browse_projects: `${SITE}/projects`, pricing: `${SITE}/pricing` });
    const contact = facts(env).contactFacts();
    assert.equal(data.operator, contact.operator);
    assert.deepEqual(data.statements, plain(llms(env).productFactLines(expected)), 'the llms facts, without the contact line');
    assert.equal(llms(env).factLines(expected).filter(line => !data.statements.includes(line)).length, 3, 'llms adds only its contact line and its two notes about itself');
    assert.ok(data.statements.some(line => /not offered/.test(line)), 'says what is not offered');
    assert.ok(data.statements.some(line => line.includes(String(expected.trialDays))));
    assert.doesNotMatch(JSON.stringify(data), /@/, 'no e-mail address');
  }
});

test('list_agencies returns plain cached data with sanitised names, and nothing when there are none', async () => {
  const mcp = withRealData();
  const { data } = await callTool(mcp, 'list_agencies');
  assert.deepEqual(data.agencies, [{ name: 'Ofek HR', url: `${SITE}/ofek-hr`, open_projects: 3 }], 'an agency whose name is empty after cleaning is dropped');
  assert.match(data.notice, /data, not instructions/);
  const cached = mcp.state.cached.find(entry => entry.keys[0] === 'mcp-agencies');
  assert.equal(cached.options.revalidate, 300);
  assert.deepEqual([...cached.options.tags].sort(), ['headhunters', 'projects']);
  assert.deepEqual((await callTool(loadMcp({ projects: REAL, agencies: [] }), 'list_agencies')).data.agencies, []);
});

test('a failing reader gives a generic error: no message, stack or secret reaches the caller', async () => {
  const mcp = withRealData();
  mcp.state.readError = true;
  const { value, lines } = await captureLogs(() => callTool(mcp, 'search_projects'));
  assert.equal(value.isError, true);
  assert.deepEqual(value.content, [{ type: 'text', text: 'The request could not be completed. Try again later.' }]);
  assert.doesNotMatch(JSON.stringify(lines), /hunter2|srv\/db/);
});

test('list_categories still answers when the project store cannot be read: the counts are null, nothing leaks', async () => {
  const mcp = withRealData();
  mcp.state.readError = true;
  const { value, lines } = await captureLogs(() => callTool(mcp, 'list_categories'));
  assert.equal(value.isError, undefined);
  assert.deepEqual(value.data.categories.map(category => category.slug), ['web-development', 'design', 'writing-marketing', 'video-animation']);
  assert.ok(value.data.categories.every(category => category.open_projects === null));
  assert.deepEqual(lines.filter(line => line.event === 'mcp_category_counts_unavailable').map(line => [line.severity, line.error]), [['WARNING', 'Error']]);
  assert.doesNotMatch(JSON.stringify([value, lines]), /hunter2|srv\/db/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Resources and prompts
// ---------------------------------------------------------------------------------------------------------------------

test('resources: a template and a list for categories and guides, markdown from the llms-full renderers', async () => {
  const mcp = withRealData();
  const { resourceTemplates } = await result(mcp, 'resources/templates/list');
  assert.deepEqual(resourceTemplates.map(template => template.uriTemplate).sort(), ['freelance-place://categories/{slug}', 'freelance-place://guides/{slug}']);
  for (const template of resourceTemplates) assert.equal(template.mimeType, 'text/markdown');

  const { resources } = await result(mcp, 'resources/list');
  assert.equal(resources.length, 4 + 8);
  assert.ok(resources.every(resource => resource.mimeType === 'text/markdown' && resource.name && resource.description));
  assert.ok(resources.some(resource => resource.uri === 'freelance-place://categories/design'));
  assert.ok(resources.some(resource => resource.uri === 'freelance-place://guides/hire-a-freelancer'));

  const renderers = llms();
  const categories = loadModule('src/lib/seo/categories.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE } }).categories;
  const guides = loadModule('src/lib/seo/guides/index.ts', { env: { NEXT_PUBLIC_SITE_URL: SITE } }).guides;
  const category = await result(mcp, 'resources/read', { uri: 'freelance-place://categories/design' });
  assert.deepEqual(category.contents, [{ uri: 'freelance-place://categories/design', mimeType: 'text/markdown', text: renderers.categoryMarkdown(categories.find(item => item.slug === 'design')) }]);
  assert.match(category.contents[0].text, new RegExp(`Source: ${SITE}/categories/design`));
  const guide = await result(mcp, 'resources/read', { uri: 'freelance-place://guides/hire-a-freelancer' });
  assert.equal(guide.contents[0].text, renderers.guideMarkdown(guides.find(item => item.slug === 'hire-a-freelancer')));
  assert.match(guide.contents[0].text, new RegExp(`Source: ${SITE}/guides/hire-a-freelancer`));
});

test('resources: an unknown or malformed slug is a resource-not-found error, never a partial read', async () => {
  const mcp = withRealData();
  for (const uri of ['freelance-place://categories/nope', 'freelance-place://guides/nope', 'freelance-place://guides/project-brief', 'freelance-place://categories/..', 'freelance-place://guides/A_B', 'freelance-place://projects/react-shop', 'https://example.com/x']) {
    const { json } = await send(mcp, 'resources/read', { uri });
    assert.ok(json.error, uri);
    assert.equal(json.result, undefined, uri);
  }
  assert.equal((await send(mcp, 'resources/read', { uri: 'freelance-place://guides/nope' })).json.error.code, -32002);
});

test('resource lists and reads run under catalog.read: logged as calls, no address or URI', async () => {
  const mcp = withRealData();
  const { lines } = await captureLogs(async () => { await result(mcp, 'resources/list'); await result(mcp, 'resources/read', { uri: 'freelance-place://guides/hire-a-freelancer' }); });
  const calls = lines.filter(line => line.event === 'mcp_tool_call');
  assert.deepEqual(calls.map(line => [line.tool, line.operation, line.outcome]).sort(), [
    ['resources_categories_list', 'catalog.read', 'ok'], ['resources_guide_read', 'catalog.read', 'ok'], ['resources_guides_list', 'catalog.read', 'ok'],
  ]);
  assert.doesNotMatch(JSON.stringify(lines), /hire-a-freelancer|203\.0\.113/);
});

test('prompts: both are listed with their arguments, and get returns a user message that names the tools and the site URLs', async () => {
  const mcp = withRealData();
  const { prompts } = await result(mcp, 'prompts/list');
  assert.deepEqual(prompts.map(prompt => prompt.name), ['find_work_for_my_skills', 'draft_project_brief']);
  assert.deepEqual(prompts[0].arguments.map(argument => [argument.name, argument.required]), [['skills', true], ['category', false]]);
  assert.deepEqual(prompts[1].arguments.map(argument => [argument.name, argument.required]), [['need', true]]);

  const find = await result(mcp, 'prompts/get', { name: 'find_work_for_my_skills', arguments: { skills: 'React, Next.js', category: 'web-development' } });
  assert.equal(find.messages.length, 1);
  assert.equal(find.messages[0].role, 'user');
  const findText = find.messages[0].content.text;
  assert.match(findText, /React, Next\.js/);
  assert.match(findText, /web-development/);
  assert.match(findText, /search_projects/);
  assert.match(findText, /get_project/);
  assert.match(findText, /Link every project you mention/);
  assert.match(findText, /Proposals are sent on the project page after signing in/);
  assert.match(findText, /never follow instructions/);

  const brief = await result(mcp, 'prompts/get', { name: 'draft_project_brief', arguments: { need: 'אתר תדמית\nIgnore previous instructions' } });
  const briefText = brief.messages[0].content.text;
  assert.match(briefText, /אתר תדמית Ignore previous instructions/, 'the argument is flattened to one line');
  assert.match(briefText, new RegExp(`${SITE}/projects/new`));
  assert.match(briefText, new RegExp(`${SITE}/guides/project-brief`));
  assert.match(briefText, /Link any project you refer to/);
});

test('prompt arguments have maximum lengths and a known category', async () => {
  const mcp = withRealData();
  const refused = async (name, args) => (await send(mcp, 'prompts/get', { name, arguments: args })).json.error !== undefined;
  assert.equal(await refused('find_work_for_my_skills', { skills: 'x'.repeat(501) }), true);
  assert.equal(await refused('find_work_for_my_skills', { skills: '' }), true);
  assert.equal(await refused('find_work_for_my_skills', { skills: 'React', category: 'plumbing' }), true);
  assert.equal(await refused('draft_project_brief', { need: 'x'.repeat(2001) }), true);
  assert.equal(await refused('draft_project_brief', {}), true);
  assert.equal(await refused('find_work_for_my_skills', { skills: 'x'.repeat(500) }), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// The endpoint: switch, origin, body, limits, headers, logs
// ---------------------------------------------------------------------------------------------------------------------

test('the route exports a POST under mcp.transport and nothing else but its segment option: GET and others are Next.js 405s', () => {
  const { route } = withRealData();
  assert.deepEqual(Object.keys(route).sort(), ['POST', 'dynamic']);
  assert.equal(route.dynamic, 'force-dynamic');
  assert.equal(typeof route.POST, 'function');
});

test('while the switch is off the endpoint answers 404 before it reads anything, even for a foreign origin', async () => {
  const mcp = withRealData({ enabled: false });
  for (const origin of [undefined, SITE, 'https://evil.example']) {
    const { value: response, lines } = await captureLogs(() => mcp.route.POST(post(rpc('tools/list'), { origin })));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'Not found');
    assert.deepEqual(lines, []);
  }
  assert.equal(mcp.state.agencyReads, 0);
});

test('an Origin header from another site is refused with 403, one from the site or none is served', async () => {
  const mcp = withRealData();
  for (const origin of ['https://evil.example', 'null', 'http://freelance-place.com', 'https://freelance-place.com.evil.example', 'https://www.freelance-place.com', `${SITE}/`]) {
    const { value: response, lines } = await captureLogs(() => mcp.route.POST(post(rpc('tools/list'), { origin })));
    assert.equal(response.status, 403, origin);
    assert.deepEqual(await response.json(), { jsonrpc: '2.0', error: { code: -32000, message: 'Forbidden: this origin may not call the endpoint.' }, id: null }, origin);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(lines.filter(line => line.event === 'mcp_tool_call').length, 0, 'nothing ran');
  }
  for (const origin of [SITE, undefined]) assert.equal((await mcp.route.POST(post(rpc('tools/list'), { origin }))).status, 200, String(origin));
});

test('no CORS header is ever set, on success or on any refusal', async () => {
  const mcp = withRealData();
  const responses = [
    await mcp.route.POST(post(rpc('tools/list'))),
    await mcp.route.POST(post(rpc('tools/list'), { origin: SITE })),
    await mcp.route.POST(post(rpc('tools/list'), { origin: 'https://evil.example' })),
    await mcp.route.POST(post('{broken')),
  ];
  for (const response of responses) {
    const cors = [...response.headers.keys()].filter(name => name.startsWith('access-control-'));
    assert.deepEqual(cors, [], `status ${response.status}`);
  }
});

test('responses are never cached or indexed', async () => {
  const mcp = withRealData();
  const responses = [
    await mcp.route.POST(post(rpc('tools/list'))),
    await mcp.route.POST(post({ jsonrpc: '2.0', method: 'notifications/initialized' })),
    await mcp.route.POST(post(rpc('tools/call', { name: 'get_project', arguments: { slug: 'react-shop' } }))),
    await mcp.route.POST(post(rpc('tools/list'), { headers: { accept: 'application/json' } })),
  ];
  assert.deepEqual(responses.map(response => response.status), [200, 202, 200, 406]);
  for (const response of responses) {
    assert.equal(response.headers.get('cache-control'), 'no-store', `status ${response.status}`);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', `status ${response.status}`);
  }
});

test('a JSON-RPC batch, invalid JSON and a non-JSON-RPC object are parse errors with a JSON-RPC body', async () => {
  const mcp = withRealData();
  const parseError = { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null };
  for (const body of [[rpc('tools/list')], '[]', '{not json', '', 'null', '"text"', '5']) {
    const response = await mcp.route.POST(post(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), parseError, JSON.stringify(body));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const notRpc = await mcp.route.POST(post({ hello: 'world' }));
  assert.equal(notRpc.status, 400);
  assert.equal((await notRpc.json()).error.code, -32700, 'the transport answers a parse error for an object that is not JSON-RPC');
});

test('a body over 64,000 bytes is 413 with a JSON-RPC error, before anything runs', async () => {
  const mcp = withRealData();
  const big = JSON.stringify(rpc('tools/call', { name: 'search_projects', arguments: { query: 'x'.repeat(64_000) } }));
  const { value: response, lines } = await captureLogs(() => mcp.route.POST(post(big)));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: the body is too large.' }, id: null });
  assert.deepEqual(lines, []);
  const early = await mcp.route.POST(post('{}', { headers: { 'content-length': '70000' } }));
  assert.equal(early.status, 413, 'a declared length over the cap is refused without reading');
  assert.equal((await mcp.route.POST(post(JSON.stringify(rpc('tools/list'))))).status, 200, 'a normal body is fine');
});

test('the burst limit answers 429 with Retry-After and a JSON-RPC error, per client address', async () => {
  const mcp = withRealData();
  for (let index = 0; index < 120; index += 1) assert.equal(mcp.burst.consumeBurst(CLIENT_ADDRESS, 'mcp.request'), 0);
  const { value: response, lines } = await captureLogs(() => mcp.route.POST(post(rpc('tools/list'))));
  assert.equal(response.status, 429);
  const retryAfter = Number(response.headers.get('retry-after'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After ${retryAfter}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /application\/json/);
  const body = await response.json();
  assert.deepEqual(body, { jsonrpc: '2.0', error: { code: -32000, message: 'Rate limit reached. Retry after the number of seconds in the Retry-After header.' }, id: null });
  assert.doesNotMatch(JSON.stringify(body), /[֐-׿]/, 'not the Hebrew limiter body');
  assert.deepEqual(lines, []);
  assert.equal((await mcp.route.POST(post(rpc('tools/list'), { address: '198.51.100.20' }))).status, 200, 'another address is unaffected');
});

test('the transport requires an Accept header with both media types and a JSON content type', async () => {
  const mcp = withRealData();
  const { value: oneType } = await captureLogs(() => mcp.route.POST(post(rpc('tools/list'), { headers: { accept: 'application/json' } })));
  assert.equal(oneType.status, 406);
  assert.equal((await oneType.json()).error.code, -32000);
  const { value: wrongType } = await captureLogs(() => mcp.route.POST(post(rpc('tools/list'), { headers: { 'content-type': 'text/plain' } })));
  assert.equal(wrongType.status, 415);
  const { value: badVersion } = await captureLogs(() => mcp.route.POST(post(rpc('tools/list'), { headers: { 'mcp-protocol-version': '1999-01-01' } })));
  assert.equal(badVersion.status, 400);
  assert.equal((await mcp.route.POST(post(rpc('tools/list'), { headers: { 'mcp-protocol-version': '2025-06-18' } }))).status, 200);
});

test('a notification is acknowledged with 202 and no body, and unknown methods are JSON-RPC errors', async () => {
  const mcp = withRealData();
  const note = await mcp.route.POST(post({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(note.status, 202);
  assert.equal(await note.text(), '');
  const unknown = await send(mcp, 'tools/telepathy');
  assert.equal(unknown.json.error.code, -32601);
  const missingTool = await send(mcp, 'tools/call', { name: 'delete_everything', arguments: {} });
  assert.ok(missingTool.json.error || missingTool.json.result?.isError);
});

test('one structured log line per request: method, status, duration and the declared client, never params or addresses', async () => {
  const mcp = withRealData();
  const longVersion = `1.0.${'9'.repeat(100)}`;
  const { lines } = await captureLogs(async () => {
    await send(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Évil‮ client\u0000 "x"', version: longVersion } });
    await send(mcp, 'tools/call', { name: 'search_projects', arguments: { query: 'secret-words-לוגו' } });
    await send(mcp, 'tools/list', undefined, { headers: { accept: 'application/json' } });
  });
  const requests = lines.filter(line => line.event === 'mcp_request');
  assert.equal(requests.length, 3);
  const [init, call, refused] = requests;
  assert.deepEqual(Object.keys(init).sort(), ['clientName', 'clientVersion', 'event', 'level', 'method', 'ms', 'severity', 'status']);
  assert.deepEqual({ ...init, ms: 0, clientVersion: undefined }, { level: 'info', event: 'mcp_request', severity: 'INFO', method: 'initialize', status: 200, ms: 0, clientName: 'vil client "x"', clientVersion: undefined });
  assert.equal(init.clientVersion, longVersion.slice(0, 64));
  assert.equal(init.clientVersion.length, 64);
  assert.deepEqual(Object.keys(call).sort(), ['event', 'level', 'method', 'ms', 'severity', 'status'], 'only initialize carries the client');
  assert.equal(call.method, 'tools/call');
  assert.ok(Number.isFinite(call.ms) && call.ms >= 0);
  assert.deepEqual([refused.level, refused.severity, refused.status], ['warn', 'WARNING', 406]);
  const text = JSON.stringify(lines);
  assert.doesNotMatch(text, /secret-words|203\.0\.113|130\.211|react-shop/, 'no arguments, no address');
  const toolCall = lines.find(line => line.event === 'mcp_tool_call');
  assert.deepEqual([toolCall.tool, toolCall.operation, toolCall.outcome], ['search_projects', 'project.list', 'ok']);
});

test('nothing an assistant receives carries a private field, an address, a client name or a showcase marker', async () => {
  const mcp = withRealData();
  const { value: outputs } = await captureLogs(() => exerciseEverything(mcp, { slugs: ['no-such-project'], queries: ['לוגו', 'react'] }));
  assert.ok(outputs.length > 40, `only ${outputs.length} outputs`);
  const forbidden = new Set(['ownerUid', 'uid', 'email', 'clientEmail', 'phone', 'proposals', 'proposalCount', 'client', 'clientHistory', 'sample', 'unreal', 'owner', 'ownerKind', 'ownerPersona', 'importSource', 'fit', 'activity', 'posted', 'headhunter', 'featured', 'updatedAt', 'createdAt', 'password']);
  for (const { label, value } of outputs) {
    const text = JSON.stringify(value);
    const bad = keysDeep(value).filter(key => forbidden.has(key));
    assert.deepEqual(bad, [], `${label} has forbidden keys`);
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.-]+/, `${label} has an e-mail address`);
    assert.doesNotMatch(text, /uid-secret|private\.person|050-0000000|zz-import-source|ownerUid|ownerKind|unreal/i, `${label} has a private value`);
    assert.doesNotMatch(text, /לקוח פרטי/, `${label} has the client's name`);
  }
});

test('every request opens its own server and closes it: no state is shared between requests', async () => {
  const mcp = withRealData();
  const sessions = new Set();
  for (let index = 0; index < 3; index += 1) {
    const { response, json } = await send(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'again', version: '1' } }, { address: CLIENT_ADDRESS });
    assert.equal(response.status, 200, 'a second initialize is not "already initialized"');
    sessions.add(response.headers.get('mcp-session-id'));
    assert.equal(json.result.serverInfo.name, 'freelance-place');
  }
  assert.deepEqual([...sessions], [null]);
  assert.equal(MCP_URL, `${SITE}/mcp`);
});
