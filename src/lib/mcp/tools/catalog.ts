import 'server-only';
import { z } from 'zod';
import { defineTool } from '@/lib/mcp/policy';
import { toolSpec } from '@/lib/mcp/tools/types';
import { CATALOGUE_SLUG, CATEGORY_SLUGS, listedCategories, listedGuides } from '@/lib/mcp/catalogue';
import { listOpenProjects } from '@/lib/db/projects';
import { projectMatchesCategory } from '@/lib/seo/categories';
import { BRAND, contactFacts, membershipFacts } from '@/lib/seo/facts';
import { productFactLines } from '@/lib/seo/llms';
import { isSyntheticProject } from '@/lib/seo/publication';
import { absoluteUrl, summarize } from '@/lib/seo/site';
import { indexableSkills } from '@/lib/seo/skills';

const INTRO_LIMIT = 300;

// ---- list_categories ------------------------------------------------------------------------------------------

const categoriesOutput = {
  categories: z.array(z.object({
    slug: z.string().describe('Use as the category filter of search_projects and list_skills.'),
    name: z.string(),
    title: z.string(),
    url: z.string(),
    intro: z.string(),
    skills: z.array(z.string()).describe('Skills the category covers.'),
    open_projects: z.number().int().nullable().describe('Open projects in the category right now, or null when the count cannot be read at the moment.'),
  })),
};

export const listCategories = toolSpec({
  title: 'List categories',
  description: 'List the project categories of Freelance Place with their skills and the number of open projects in each. Category names are Hebrew.',
  input: {},
  output: categoriesOutput,
  tool: defineTool({
    name: 'list_categories',
    operation: 'catalog.read',
    run: async () => {
      // The catalogue is static; only the counts need the project store. When it cannot be read the categories are
      // still answered, with unknown counts, instead of failing the whole call.
      const open = await listOpenProjects()
        .then((projects) => projects.filter((project) => !isSyntheticProject(project)))
        .catch((error: unknown) => {
          console.warn(JSON.stringify({ event: 'mcp_category_counts_unavailable', severity: 'WARNING', error: error instanceof Error ? error.name : 'Error' }));
          return null;
        });
      return {
        categories: listedCategories().map((category) => ({
          slug: category.slug, name: category.name, title: category.title, url: absoluteUrl(`/categories/${category.slug}`),
          intro: summarize(category.intro, INTRO_LIMIT), skills: [...category.skills],
          open_projects: open ? open.filter((project) => projectMatchesCategory(project, category)).length : null,
        })),
      };
    },
  }),
});

// ---- list_skills ----------------------------------------------------------------------------------------------

const skillsInput = { category: z.enum(CATEGORY_SLUGS).optional().describe('Category slug from list_categories.') };
const skillsOutput = {
  skills: z.array(z.object({ slug: z.string(), name: z.string(), url: z.string(), category: z.string(), definition: z.string() })),
};

export const listSkills = toolSpec({
  title: 'List skills',
  description: 'List the skills that have a page on Freelance Place, with a one-sentence definition (Hebrew). Use the names as the skills filter of search_projects.',
  input: skillsInput,
  output: skillsOutput,
  tool: defineTool({
    name: 'list_skills',
    operation: 'catalog.read',
    run: async ({ category }: z.output<z.ZodObject<typeof skillsInput>>) => ({
      skills: indexableSkills().filter((skill) => !category || skill.category === category).map((skill) => ({
        slug: skill.slug, name: skill.name, url: absoluteUrl(`/skills/${skill.slug}`), category: skill.category, definition: skill.definition,
      })),
    }),
  }),
});

// ---- list_guides, get_guide -----------------------------------------------------------------------------------

const guidesOutput = {
  guides: z.array(z.object({
    slug: z.string(), title: z.string(), url: z.string(),
    audience: z.enum(['clients', 'freelancers', 'both']),
    summary: z.string(), modified: z.string().describe('Date of the last edit, YYYY-MM-DD.'),
  })),
};

export const listGuides = toolSpec({
  title: 'List guides',
  description: 'List the guides published by Freelance Place for people who hire freelancers or work as freelancers in Israel. Guides are in Hebrew.',
  input: {},
  output: guidesOutput,
  tool: defineTool({
    name: 'list_guides',
    operation: 'catalog.read',
    run: async () => ({
      guides: listedGuides().map((guide) => ({
        slug: guide.slug, title: guide.title, url: absoluteUrl(`/guides/${guide.slug}`), audience: guide.audience, summary: guide.summary, modified: guide.modified,
      })),
    }),
  }),
});

const guideInput = { slug: z.string().regex(CATALOGUE_SLUG).describe('Guide slug from list_guides.') };
const guideOutput = {
  slug: z.string(), title: z.string(), url: z.string(),
  audience: z.enum(['clients', 'freelancers', 'both']),
  summary: z.string(), modified: z.string(),
  sections: z.array(z.object({ heading: z.string(), answer: z.string() })).describe('Each section of the guide with its direct answer. The full text is on the page at url.'),
  disclaimer: z.string().nullable(),
};

export const getGuide = toolSpec({
  title: 'Get a guide',
  description: 'Get a guide of Freelance Place: its summary and the direct answer of every section. The full guide, with lists and tables, is on the page at url.',
  input: guideInput,
  output: guideOutput,
  missing: 'No guide with this slug. Use list_guides to see the guides.',
  tool: defineTool({
    name: 'get_guide',
    operation: 'catalog.read',
    run: async ({ slug }: z.output<z.ZodObject<typeof guideInput>>) => {
      const guide = listedGuides().find((candidate) => candidate.slug === slug);
      if (!guide) return null;
      return {
        slug: guide.slug, title: guide.title, url: absoluteUrl(`/guides/${guide.slug}`), audience: guide.audience, summary: guide.summary, modified: guide.modified,
        sections: guide.sections.map(({ heading, answer }) => ({ heading, answer })), disclaimer: guide.disclaimer ?? null,
      };
    },
  }),
});

// ---- get_platform_facts ---------------------------------------------------------------------------------------

const factsOutput = {
  name: z.string(),
  membership: z.object({
    price_ils: z.number().describe('Monthly membership price in shekels.'),
    trial_days: z.number().int().describe('Days a freelancer can submit proposals before membership is needed.'),
    billing_available: z.boolean().describe('Whether paying for membership is possible now. When false, no charge is made.'),
  }),
  operator: z.string().describe('Who operates the platform. Contact details are on the website.'),
  statements: z.array(z.string()).describe('The platform facts as the website states them: posting is free, how the trial and membership work, and what is not offered (for example no payments or escrow between client and freelancer).'),
  urls: z.object({ post_project: z.string(), browse_projects: z.string(), pricing: z.string() }),
};

export const getPlatformFacts = toolSpec({
  title: 'Get platform facts',
  description: 'The facts about Freelance Place that assistants should quote exactly: what posting and membership cost, the free trial, whether payment is available, and what the platform does not offer. Generated from the same source as the website, so it matches the live site.',
  input: {},
  output: factsOutput,
  tool: defineTool({
    name: 'get_platform_facts',
    operation: 'catalog.read',
    run: async () => {
      const facts = membershipFacts();
      return {
        name: BRAND.name,
        // No e-mail address ever leaves this server; the contact details are on the website.
        operator: contactFacts().operator,
        membership: { price_ils: facts.priceIls, trial_days: facts.trialDays, billing_available: facts.billingAvailable },
        // The product facts of /llms.txt, without its contact line and the lines that describe that file.
        statements: productFactLines(facts),
        urls: { post_project: absoluteUrl('/projects/new'), browse_projects: absoluteUrl('/projects'), pricing: absoluteUrl('/pricing') },
      };
    },
  }),
});
