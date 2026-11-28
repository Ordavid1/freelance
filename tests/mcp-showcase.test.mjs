import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { projectRoot } from './helpers/load-ts.mjs';
import { callTool, captureLogs, exerciseEverything, hoursAgo, loadMcp, project, result } from './helpers/mcp-harness.mjs';

// Showcase projects (seeded, published by an AI agent) are labelled inside the product, but they are not client demand.
// Beside tests/seo-showcase.test.mjs: nothing the MCP server says may mention, list, count or link to one. Every reader the
// server uses already excludes them; these tests feed them to the server anyway, through every tool, resource and prompt,
// so a reader that ever stopped excluding them would still not leak.

const SHOWCASE = [
  project('showcase-sample-slug', { title: 'SHOWCASE-SAMPLE-TITLE', description: 'SHOWCASE-SAMPLE-TEXT', sample: true, skills: ['React'], createdAt: hoursAgo(1) }),
  project('showcase-unreal-slug', { title: 'SHOWCASE-UNREAL-TITLE', description: 'SHOWCASE-UNREAL-TEXT', unreal: true, skills: ['Figma'], category: 'עיצוב מוצר', createdAt: hoursAgo(1) }),
  project('showcase-agent-slug', { title: 'SHOWCASE-AGENT-TITLE', description: 'SHOWCASE-AGENT-TEXT', owner: { kind: 'ai-agent', name: 'SHOWCASE-PERSONA' }, skills: ['After Effects'], category: 'וידאו ואנימציה', createdAt: hoursAgo(1) }),
  project('showcase-ownerkind-slug', { title: 'SHOWCASE-KIND-TITLE', description: 'SHOWCASE-KIND-TEXT', ownerKind: 'ai-agent', ownerPersona: 'SHOWCASE-PERSONA', skills: ['Node.js'], createdAt: hoursAgo(1) }),
];
const REAL = [
  project('real-web', { title: 'אתר תדמית אמיתי', description: 'REAL-TEXT-ONE', skills: ['React'], createdAt: hoursAgo(3) }),
  project('real-design', { title: 'מיתוג אמיתי', description: 'REAL-TEXT-TWO', category: 'עיצוב מוצר', skills: ['Figma'], createdAt: hoursAgo(5) }),
];
// Showcase records first and interleaved, so neither order nor position hides them.
const MIXED = [SHOWCASE[0], REAL[0], SHOWCASE[1], SHOWCASE[2], REAL[1], SHOWCASE[3]];
const MARKERS = [...SHOWCASE.flatMap(item => [item.slug, item.title, item.description]), 'SHOWCASE', 'showcase', 'ai-agent', 'ownerKind', 'ownerPersona', 'unreal'];
const textOf = value => JSON.stringify(value);
const unleaked = (label, value) => { for (const marker of MARKERS) assert.ok(!textOf(value).includes(marker), `${label} contains "${marker}"`); };

test('search_projects lists, counts and pages only the real projects, whatever the reader returned', async () => {
  const mcp = loadMcp({ projects: MIXED });
  const { data } = await callTool(mcp, 'search_projects', { limit: 20 });
  assert.deepEqual(data.projects.map(item => item.slug), ['real-web', 'real-design']);
  assert.equal(data.total, 2);
  assert.equal(data.next_offset, null);
  for (const args of [{ query: 'SHOWCASE' }, { query: 'showcase-sample-slug' }, { skills: ['Node.js'] }, { employment: 'freelance' }, { category: 'web-development' }, { category: 'design' }, { category: 'video-animation' }]) {
    const found = (await callTool(mcp, 'search_projects', { ...args, limit: 20 })).data;
    unleaked(JSON.stringify(args), found);
    assert.ok(found.projects.every(item => item.slug.startsWith('real-')), JSON.stringify(args));
  }
  assert.equal((await callTool(mcp, 'search_projects', { limit: 1 })).data.next_offset, 1, 'a page boundary is counted over real projects only');
});

test('get_project never serialises a showcase project, even when the reader hands one over', async () => {
  const mcp = loadMcp({ projects: MIXED, details: MIXED });
  for (const item of SHOWCASE) {
    const { value: tool, lines } = await captureLogs(() => callTool(mcp, 'get_project', { slug: item.slug }));
    assert.equal(tool.isError, true, item.slug);
    assert.equal(tool.structuredContent, undefined);
    assert.deepEqual(tool.content, [{ type: 'text', text: 'The request could not be completed. Try again later.' }]);
    unleaked(item.slug, tool);
    assert.equal(lines.some(line => line.event === 'mcp_tool_error'), true, 'a refused showcase record is an error in the log');
    unleaked('log', lines);
  }
  assert.equal((await callTool(mcp, 'get_project', { slug: 'real-web' })).data.project.description, 'REAL-TEXT-ONE');
});

test('category counts include real projects only', async () => {
  const { data } = await callTool(loadMcp({ projects: MIXED }), 'list_categories');
  const counts = Object.fromEntries(data.categories.map(category => [category.slug, category.open_projects]));
  assert.deepEqual(counts, { 'web-development': 1, design: 1, 'writing-marketing': 0, 'video-animation': 0 });
  unleaked('list_categories', data);
});

test('nothing any tool, resource or prompt returns names a showcase project, its text or its markers', async () => {
  const mcp = loadMcp({ projects: MIXED, details: MIXED, agencies: [{ handle: 'ofek-hr', path: '/ofek-hr', name: 'Ofek HR', openProjects: 1 }] });
  const { value: outputs } = await captureLogs(() => exerciseEverything(mcp, { slugs: SHOWCASE.map(item => item.slug), queries: ['SHOWCASE', 'showcase', 'ai-agent', 'REAL-TEXT'] }));
  assert.ok(outputs.length > 40, `only ${outputs.length} outputs`);
  for (const { label, value } of outputs) unleaked(label, value);
  const search = outputs.filter(({ label }) => label.startsWith('search_projects')).flatMap(({ value }) => value.data?.projects ?? []);
  assert.ok(search.some(item => item.slug === 'real-web'), 'the real projects are served');
  assert.ok(search.every(item => item.slug.startsWith('real-')));
});

test('server info, instructions, tool descriptions and prompts do not mention showcase content at all', async () => {
  const mcp = loadMcp({ projects: MIXED });
  const initialize = await result(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const tools = await result(mcp, 'tools/list');
  const prompts = await result(mcp, 'prompts/list');
  const resources = await result(mcp, 'resources/templates/list');
  for (const [label, value] of [['initialize', initialize], ['tools', tools], ['prompts', prompts], ['resources', resources]]) {
    assert.doesNotMatch(textOf(value), /showcase|sample|unreal|ai-agent|demo project|synthetic|AI agent/i, label);
  }
});

function sourceFiles(path) {
  const absolute = `${projectRoot}/${path}`;
  return statSync(absolute).isDirectory() ? readdirSync(absolute).flatMap(name => sourceFiles(`${path}/${name}`)) : [path];
}
const mcpFiles = ['src/lib/mcp', 'src/app/mcp'].flatMap(sourceFiles).filter(file => /\.tsx?$/.test(file));

test('no MCP source reads a showcase marker itself; the publication rule is the one place that knows them', () => {
  assert.ok(mcpFiles.length >= 12, `only ${mcpFiles.length} files`);
  for (const file of mcpFiles) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8');
    assert.doesNotMatch(source, /ownerKind|owner\??\.kind|\.sample\b|\.unreal\b|\bunreal:/, `${file} reads showcase markers itself`);
  }
});

test('every MCP source that reads the open-project list applies the showcase rule to it', () => {
  const readers = mcpFiles.filter(file => /listOpenProjects|getDiscoverableProject/.test(readFileSync(`${projectRoot}/${file}`, 'utf8')));
  assert.ok(readers.length >= 2, readers.join());
  for (const file of readers) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8');
    assert.match(source, /isSyntheticProject|toProjectDetail|toProjectSummaries/, `${file} must filter or map through the showcase-safe model`);
  }
  assert.match(readFileSync(`${projectRoot}/src/lib/mcp/tools/projects.ts`, 'utf8'), /getDiscoverableProject/, 'a single project is read with the discoverability rule on the stored record');
});
