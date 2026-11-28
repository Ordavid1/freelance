import 'server-only';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CATALOGUE_SLUG, listedCategories, listedGuides } from '@/lib/mcp/catalogue';
import { defineTool, type McpCaller } from '@/lib/mcp/policy';
import { categoryMarkdown, guideMarkdown } from '@/lib/seo/llms';
import { absoluteUrl, summarize } from '@/lib/seo/site';

// Resources are the same catalogue as the tools in a form a client can attach as context: one markdown document per
// category and per guide, rendered by the code that renders /llms-full.txt. A list or a read is a call like a tool call:
// it runs through `defineTool`, so it is logged and metered under `catalog.read`.

const MARKDOWN = 'text/markdown';
const URI_PREFIX = 'freelance-place://';
/** MCP's code for a resource that does not exist. */
const RESOURCE_NOT_FOUND = -32002;

type Entry = { slug: string; name: string; title: string; description: string };
const uri = (kind: 'categories' | 'guides', slug: string) => `${URI_PREFIX}${kind}/${encodeURIComponent(slug)}`;

const listCategoryResources = defineTool({
  name: 'resources_categories_list',
  operation: 'catalog.read',
  run: async (): Promise<Entry[]> => listedCategories().map((category) => ({ slug: category.slug, name: category.name, title: category.title, description: summarize(category.intro, 300) })),
});
const listGuideResources = defineTool({
  name: 'resources_guides_list',
  operation: 'catalog.read',
  run: async (): Promise<Entry[]> => listedGuides().map((guide) => ({ slug: guide.slug, name: guide.title, title: guide.title, description: summarize(guide.summary, 300) })),
});
const readCategoryResource = defineTool({
  name: 'resources_category_read',
  operation: 'catalog.read',
  run: async ({ slug }: { slug: string }) => {
    const category = listedCategories().find((candidate) => candidate.slug === slug);
    return category ? categoryMarkdown(category) : null;
  },
});
const readGuideResource = defineTool({
  name: 'resources_guide_read',
  operation: 'catalog.read',
  run: async ({ slug }: { slug: string }) => {
    const guide = listedGuides().find((candidate) => candidate.slug === slug);
    return guide ? guideMarkdown(guide) : null;
  },
});

async function listing(kind: 'categories' | 'guides', tool: typeof listCategoryResources, caller: McpCaller) {
  const outcome = await tool.call({}, caller);
  if (!outcome.ok) throw new McpError(-32603, outcome.error);
  return { resources: outcome.data.map((entry) => ({ uri: uri(kind, entry.slug), name: entry.name, title: entry.title, description: entry.description, mimeType: MARKDOWN })) };
}

async function reading(kind: 'categories' | 'guides', tool: typeof readCategoryResource, variable: string | string[] | undefined, caller: McpCaller) {
  const slug = Array.isArray(variable) ? variable[0] : variable;
  if (typeof slug !== 'string' || !CATALOGUE_SLUG.test(slug)) throw new McpError(RESOURCE_NOT_FOUND, 'Resource not found.');
  const outcome = await tool.call({ slug }, caller);
  if (!outcome.ok) throw new McpError(-32603, outcome.error);
  if (outcome.data === null) throw new McpError(RESOURCE_NOT_FOUND, 'Resource not found.');
  return { contents: [{ uri: uri(kind, slug), mimeType: MARKDOWN, text: outcome.data }] };
}

export function registerResources(server: McpServer, caller: McpCaller) {
  server.registerResource('categories', new ResourceTemplate(`${URI_PREFIX}categories/{slug}`, { list: () => listing('categories', listCategoryResources, caller) }), {
    title: 'Freelance Place categories',
    description: `One document per project category (what to define in a brief, how to choose a professional, answers to common questions). Documents are in Hebrew; each names the page it comes from.`,
    mimeType: MARKDOWN,
  }, (_uri, variables) => reading('categories', readCategoryResource, variables.slug, caller));

  server.registerResource('guides', new ResourceTemplate(`${URI_PREFIX}guides/{slug}`, { list: () => listing('guides', listGuideResources, caller) }), {
    title: 'Freelance Place guides',
    description: `One document per guide for people who hire freelancers or work as freelancers in Israel. Guides on the site: ${absoluteUrl('/guides')}. Documents are in Hebrew.`,
    mimeType: MARKDOWN,
  }, (_uri, variables) => reading('guides', readGuideResource, variables.slug, caller));
}
