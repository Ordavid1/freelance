// The public MCP endpoint (src/app/mcp/route.ts) loaded through the vm harness with its data readers, the runtime switch and
// the Firestore-backed pieces stubbed. The MCP SDK, zod and the real policy adapters, read model, tools, resources and
// prompts run for real, so a request goes through the same code path as in production.
import { createRequire } from 'node:module';
import { loadModule } from './load-ts.mjs';
import { loadPolicy } from './policy.mjs';

const nodeRequire = createRequire(import.meta.url);
export const SITE = 'https://freelance-place.com';
export const MCP_URL = `${SITE}/mcp`;
export const CLIENT_ADDRESS = '203.0.113.9';

const HOUR = 3_600_000;
/** A project as the public readers return it (the `Project` model of src/lib/data.ts). */
export function project(slug, extra = {}) {
  return {
    slug, title: `פרויקט ${slug}`, category: 'פיתוח אתרים', description: `תיאור מלא של ${slug}`, budget: '₪5,000', deadline: 'עד סוף החודש',
    employmentType: 'freelance', posted: 'לפני שעה', client: 'לקוח פרטי', clientHistory: '3 פרויקטים', skills: ['React'], status: 'open',
    createdAt: Date.now() - HOUR, updatedAt: Date.now(), fit: 'f', activity: 'a', proposals: 7, ...extra,
  };
}
export const hoursAgo = hours => Date.now() - hours * HOUR;

export function loadMcp({ projects = [], details = null, agencies = [], enabled = true, env = {} } = {}) {
  const state = { projects, details, agencies, enabled, cached: [], agencyReads: 0 };
  const burst = loadModule('src/lib/security/burst-limit.ts');
  const sdk = path => nodeRequire(`@modelcontextprotocol/sdk/${path}`);
  const siteEnv = { NEXT_PUBLIC_SITE_URL: SITE, ...env };
  const stubs = {
    'zod': nodeRequire('zod'),
    '@modelcontextprotocol/sdk/server/mcp.js': sdk('server/mcp.js'),
    '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js': sdk('server/webStandardStreamableHttp.js'),
    '@modelcontextprotocol/sdk/types.js': sdk('types.js'),
    'next/cache': { unstable_cache: (fn, keys, options) => { state.cached.push({ keys, options }); return fn; } },
    '@/lib/db/projects': {
      listOpenProjects: async () => { if (state.readError) throw new Error('firestore password=hunter2 at /srv/db.ts:9'); return state.projects; },
      getDiscoverableProject: async slug => (state.details ?? state.projects).find(item => item.slug === slug) ?? null,
    },
    '@/lib/seo/headhunters': { indexableHeadhunterPages: async () => { state.agencyReads += 1; return state.agencies; } },
    '@/lib/security/runtime-switch': { featureEnabled: async feature => feature === 'mcp' && state.enabled },
    '@/lib/security/burst-limit': burst,
    '@/lib/security/rate-limit': { enforceActionLimit: async () => null, enforceAnonymousLimit: async () => null, enforceGlobalBudget: async () => null },
  };
  const policy = loadPolicy({ '@/lib/auth/session': { getCurrentUser: async () => null, isSameOrigin: () => true }, '@/lib/security/burst-limit': burst }, siteEnv);
  const route = loadModule('src/app/mcp/route.ts', { env: siteEnv, stubs: { ...stubs, '@/lib/security/policy': policy } });
  return { route, state, burst };
}

/** A POST to the endpoint with the headers a streamable-HTTP client sends. `body` may be an object, an array or raw text. */
export function post(body, { headers = {}, origin, address = CLIENT_ADDRESS } = {}) {
  return new Request(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': `${address}, 130.211.0.1`,
      ...(origin === undefined ? {} : { origin }), ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
export const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

/** Sends one JSON-RPC request and returns the response with its parsed body. */
export async function send(mcp, method, params, options) {
  const response = await mcp.route.POST(post(rpc(method, params), options));
  const text = await response.text();
  return { response, text, json: text ? JSON.parse(text) : null };
}
export async function result(mcp, method, params, options) {
  const { response, json } = await send(mcp, method, params, options);
  if (response.status !== 200 || json?.error) throw new Error(`${method}: ${response.status} ${JSON.stringify(json)}`);
  return json.result;
}
/** tools/call returning the MCP tool result; `data` is the structured content. */
export async function callTool(mcp, name, args = {}) {
  const tool = await result(mcp, 'tools/call', { name, arguments: args });
  return { ...tool, data: tool.structuredContent };
}

/** Captures the structured log lines of a block of code. */
export async function captureLogs(work) {
  const lines = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  for (const level of ['info', 'warn', 'error']) console[level] = line => lines.push({ level, ...JSON.parse(line) });
  try { return { value: await work(), lines }; } finally { Object.assign(console, original); }
}

/** Every key of a JSON value, at any depth. */
export const keysDeep = value => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]) : []);

/**
 * Calls every tool (with and without filters), every resource and every prompt, and returns what came back, so a test can
 * look for something that must never appear anywhere. `slugs` are extra project slugs to ask get_project about.
 */
export async function exerciseEverything(mcp, { slugs = [], queries = [] } = {}) {
  const outputs = [];
  const keep = (label, value) => outputs.push({ label, value });
  keep('initialize', await result(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));
  keep('tools/list', await result(mcp, 'tools/list'));
  const search = [{}, { limit: 20 }, { limit: 20, offset: 1 }, { skills: ['React', 'Figma', 'After Effects'] }, { category: 'design' }, { employment: 'employee' }, { posted_within: 'month' }, { min_budget_ils: 1 }, ...queries.map(query => ({ query }))];
  for (const args of search) keep(`search_projects ${JSON.stringify(args)}`, await callTool(mcp, 'search_projects', args));
  const listed = (await callTool(mcp, 'search_projects', { limit: 20 })).data?.projects ?? [];
  for (const slug of [...listed.map(item => item.slug), ...slugs]) keep(`get_project ${slug}`, await callTool(mcp, 'get_project', { slug }));
  for (const [name, args] of [['list_categories', {}], ['list_skills', {}], ['list_skills', { category: 'design' }], ['list_guides', {}], ['get_platform_facts', {}], ['list_agencies', {}]]) keep(name, await callTool(mcp, name, args));
  const guides = (await callTool(mcp, 'list_guides')).data.guides;
  for (const guide of guides) keep(`get_guide ${guide.slug}`, await callTool(mcp, 'get_guide', { slug: guide.slug }));
  const resources = (await result(mcp, 'resources/list')).resources;
  keep('resources/list', resources);
  keep('resources/templates/list', await result(mcp, 'resources/templates/list'));
  for (const resource of resources) keep(`resources/read ${resource.uri}`, await result(mcp, 'resources/read', { uri: resource.uri }));
  keep('prompts/list', await result(mcp, 'prompts/list'));
  keep('prompts/get find_work', await result(mcp, 'prompts/get', { name: 'find_work_for_my_skills', arguments: { skills: 'React, Figma', category: 'design' } }));
  keep('prompts/get draft_brief', await result(mcp, 'prompts/get', { name: 'draft_project_brief', arguments: { need: 'אתר תדמית לעסק קטן' } }));
  return outputs;
}
