// Content lint for the editorial data modules (skills, guides, glossary). It runs on
// whatever exists, so each content file is checked the moment it is added. The rules
// come from the honesty and quality guardrails in .claude/plans/10-11-26-SEO-AEO-Plan.md
// and .claude/plans/10-11-26-SEO-AEO-Content-Briefs.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

const CATEGORY_SLUGS = ['web-development', 'design', 'writing-marketing', 'video-animation'];
const PLANNED_GUIDE_SLUGS = [
  'project-brief', 'hire-a-freelancer', 'compare-freelancer-quotes', 'freelancer-or-agency', 'website-cost-factors',
  'freelance-pricing-models', 'write-a-winning-proposal', 'freelance-contract-checklist', 'freelance-sites-israel',
];
const STATIC_PATHS = ['/', '/pricing', '/about', '/how-it-works', '/faq', '/glossary', '/guides', '/skills', '/projects', '/alternatives/xplace', '/guides/project-brief', '/privacy', '/terms'];

const BANNED_PHRASES = ['הכי טוב', 'מס׳ 1', 'מספר 1', 'מוביל', 'מובטח', 'מבטיחים', '100%', 'ללא סיכון', 'אחריות מלאה', 'כולם', 'תמיד'];
// Facts that may appear as numbers because facts.ts owns them (membership price, trial length).
const ALLOWED_NUMBER_SNIPPETS = ['14 ימי ניסיון', '14 ימי', '₪19.99', '19.99'];
const UNIT_AFTER_DIGITS = /\d[\d.,]*\s*(?:ימים|יום|שבועות|שבוע|חודשים|חודש|שנים|שנה|שעות|שעה|דקות|דקה|אחוז|%|₪|ש״ח|שקלים|דולר|אירו|\$|€)/;
const CURRENCY_BEFORE_DIGITS = /(?:₪|\$|€)\s*\d/;
const NUMBER_WORD_UNIT = /(?:שני|שניים|שתי|שתיים|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש|שישה|שש|שבעה|שבע|שמונה|תשעה|תשע|עשרה|עשר|עשרים)\s+(?:ימים|שבועות|חודשים|שנים|שעות|דקות)/;

// SEO_CONTENT_COMPLETE=1 additionally requires the whole planned catalogue and rejects placeholders.
const STRICT = process.env.SEO_CONTENT_COMPLETE === '1';
const hasPlaceholder = (value) => JSON.stringify(value ?? null).includes('PLACEHOLDER');

const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const isSlug = (value) => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const words = (text) => text.split(/\s+/).filter(Boolean).length;

function files(dir, { skip = [] } = {}) {
  const full = path.join(projectRoot, 'src/lib/seo', dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((name) => /\.tsx?$/.test(name) && !skip.includes(name)).sort().map((name) => `src/lib/seo/${dir}/${name}`);
}

function collectSkills() {
  const skills = [];
  for (const file of files('skill-data', { skip: ['index.ts'] })) {
    const mod = loadModule(file);
    for (const value of Object.values(mod)) if (Array.isArray(value)) for (const skill of value) skills.push({ ...skill, __file: file });
  }
  return skills;
}
function collectGuides() {
  const guides = [];
  for (const file of files('guides', { skip: ['index.ts'] })) {
    const mod = loadModule(file);
    const guide = mod.guide ?? Object.values(mod).find((value) => value && typeof value === 'object' && !Array.isArray(value) && value.slug && value.sections);
    if (guide) guides.push({ ...guide, __file: file });
  }
  return guides;
}
function collectGlossary() {
  const file = 'src/lib/seo/glossary-data.ts';
  if (!existsSync(path.join(projectRoot, file))) return [];
  const mod = loadModule(file);
  return Array.isArray(mod.glossaryTerms) ? mod.glossaryTerms : [];
}

function collectInfo() {
  const file = 'src/lib/seo/info-content.ts';
  if (!existsSync(path.join(projectRoot, file))) return [];
  const mod = loadModule(file);
  const facts = (billingAvailable) => ({ priceIls: 19.99, priceLabel: '₪19.99', trialDays: 14, billingAvailable });
  const out = [];
  for (const billing of [true, false]) {
    out.push({ name: `pricing (billing ${billing})`, content: mod.pricingContent(facts(billing)), kind: 'page' });
    out.push({ name: `faq (billing ${billing})`, content: mod.faqContent(facts(billing)), kind: 'faq' });
  }
  out.push({ name: 'about', content: mod.aboutContent(), kind: 'page' });
  out.push({ name: 'how-it-works', content: mod.howItWorksContent(), kind: 'page' });
  return out;
}
function collectCategoryFaq() {
  const file = 'src/lib/seo/category-faq.ts';
  if (!existsSync(path.join(projectRoot, file))) return {};
  return loadModule(file).categoryQuestions ?? {};
}
function glossaryIntro() {
  const file = 'src/lib/seo/glossary-data.ts';
  return existsSync(path.join(projectRoot, file)) ? loadModule(file).glossaryIntro : undefined;
}

const skills = collectSkills();
const guides = collectGuides();
const glossary = collectGlossary();
const info = collectInfo();
const categoryFaq = collectCategoryFaq();
const intro = glossaryIntro();

// Every string inside an object, with a readable location for failure messages. The `url` key (only
// used by sources[]) is skipped: lintSources requires it to be an https URL, lintText forbids URLs in text.
function* strings(value, where) {
  if (typeof value === 'string') yield [where, value];
  else if (Array.isArray(value)) for (const [index, item] of value.entries()) yield* strings(item, `${where}[${index}]`);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) if (!key.startsWith('__') && key !== 'url') yield* strings(item, `${where}.${key}`);
}

function lintText(where, text, problems) {
  for (const phrase of BANNED_PHRASES) if (text.includes(phrase)) problems.push(`${where}: banned phrase "${phrase}"`);
  let scrubbed = text;
  for (const allowed of ALLOWED_NUMBER_SNIPPETS) scrubbed = scrubbed.split(allowed).join(' ');
  if (UNIT_AFTER_DIGITS.test(scrubbed) || CURRENCY_BEFORE_DIGITS.test(scrubbed)) problems.push(`${where}: price, duration or percentage figure (only facts.ts values are allowed): "${text.slice(0, 80)}"`);
  if (NUMBER_WORD_UNIT.test(scrubbed)) problems.push(`${where}: duration written in words: "${text.slice(0, 80)}"`);
  if (/[א-ת][A-Za-z]/.test(text)) problems.push(`${where}: Latin text attached to a Hebrew letter, use the maqaf ־ (e.g. ב־Figma): "${text.slice(0, 80)}"`);
  if (/[א-ת]-[A-Za-z]/.test(text)) problems.push(`${where}: use the Hebrew maqaf ־ instead of "-" before Latin text: "${text.slice(0, 80)}"`);
  if (/[א-ת]"[א-ת]/.test(text)) problems.push(`${where}: use gershayim ״ instead of an ASCII quote inside a Hebrew word: "${text.slice(0, 80)}"`);
  if (/https?:\/\//.test(text)) problems.push(`${where}: URLs belong in "sources" (with a check date), not in text`);
  if (/\s{2,}/.test(text) || text !== text.trim()) problems.push(`${where}: stray whitespace`);
}

function relatedProblems(at, related, selfSlug, skillSlugs) {
  const problems = [];
  for (const path of related ?? []) {
    const known = STATIC_PATHS.includes(path)
      || /^\/categories\/(.+)$/.test(path) && CATEGORY_SLUGS.includes(path.split('/')[2])
      || /^\/guides\/(.+)$/.test(path) && PLANNED_GUIDE_SLUGS.includes(path.split('/')[2]) && path.split('/')[2] !== selfSlug
      || /^\/skills\/(.+)$/.test(path) && (skillSlugs.size === 0 || skillSlugs.has(path.split('/')[2]));
    if (!known) problems.push(`${at}: related "${path}" does not resolve to a known page`);
  }
  return problems;
}

function lintSources(owner, sources, problems) {
  for (const [index, source] of (sources ?? []).entries()) {
    const where = `${owner}.sources[${index}]`;
    if (!source.name || typeof source.name !== 'string') problems.push(`${where}: missing name`);
    if (!/^https:\/\/[^\s]+$/.test(source.url ?? '')) problems.push(`${where}: url must be an absolute https URL`);
    if (!isDate(source.checked)) problems.push(`${where}: "checked" must be a YYYY-MM-DD date`);
  }
}

test('skill data satisfies the shape and length contract', () => {
  const problems = [];
  for (const skill of skills) {
    const at = `skill ${skill.slug ?? '?'} (${skill.__file})`;
    if (!isSlug(skill.slug)) problems.push(`${at}: slug must be ASCII kebab-case`);
    if (!skill.name) problems.push(`${at}: missing name`);
    if (!Array.isArray(skill.aliases) || skill.aliases.length < 2) problems.push(`${at}: needs at least 2 aliases`);
    if (!CATEGORY_SLUGS.includes(skill.category)) problems.push(`${at}: unknown category ${skill.category}`);
    if (!skill.title || skill.title.length < 20 || skill.title.length > 60) problems.push(`${at}: title must be 20-60 chars (is ${skill.title?.length})`);
    if (!skill.description || skill.description.length < 70 || skill.description.length > 165) problems.push(`${at}: description must be 70-165 chars (is ${skill.description?.length})`);
    if (!skill.definition || skill.definition.length < 80 || skill.definition.length > 280) problems.push(`${at}: definition must be 80-280 chars (is ${skill.definition?.length})`);
    if (!skill.whenNeeded || skill.whenNeeded.length < 60) problems.push(`${at}: whenNeeded is missing or too short`);
    for (const [field, min] of [['deliverables', 4], ['howToChoose', 4], ['priceDrivers', 3], ['questions', 3]]) {
      if (!Array.isArray(skill[field]) || skill[field].length < min) problems.push(`${at}: ${field} needs at least ${min} entries`);
    }
    for (const field of ['deliverables', 'howToChoose', 'priceDrivers']) for (const [index, item] of (skill[field] ?? []).entries()) if (typeof item !== 'string' || item.length < 15) problems.push(`${at}: ${field}[${index}] is too short to be useful`);
    for (const [index, item] of (skill.questions ?? []).entries()) {
      if (!item.question?.endsWith('?')) problems.push(`${at}: questions[${index}].question must end with "?"`);
      if (!item.answer || item.answer.length < 40 || item.answer.length > 400) problems.push(`${at}: questions[${index}].answer must be 40-400 chars (is ${item.answer?.length})`);
    }
    if (!Array.isArray(skill.related) || skill.related.length < 2 || skill.related.length > 4) problems.push(`${at}: related needs 2-4 skill slugs`);
    if (!isDate(skill.published) || !isDate(skill.modified) || skill.modified < skill.published) problems.push(`${at}: published/modified must be valid dates with modified >= published`);
    const body = [skill.definition, skill.whenNeeded, ...(skill.deliverables ?? []), ...(skill.howToChoose ?? []), ...(skill.priceDrivers ?? []), ...(skill.questions ?? []).flatMap((item) => [item.question, item.answer])].join(' ');
    if (words(body) < 250) problems.push(`${at}: needs at least 250 words of body content (has ${words(body)})`);
    lintSources(at, skill.sources, problems);
  }
  assert.deepEqual(problems, []);
});

test('skill slugs, titles and descriptions are unique and references resolve', () => {
  const problems = [];
  const bySlug = new Map();
  for (const skill of skills) {
    if (bySlug.has(skill.slug)) problems.push(`duplicate skill slug ${skill.slug}`);
    bySlug.set(skill.slug, skill);
  }
  const titles = new Set(); const descriptions = new Set();
  for (const skill of skills) {
    if (titles.has(skill.title)) problems.push(`duplicate title: ${skill.title}`);
    if (descriptions.has(skill.description)) problems.push(`duplicate description on ${skill.slug}`);
    titles.add(skill.title); descriptions.add(skill.description);
    for (const slug of skill.related ?? []) {
      if (slug === skill.slug) problems.push(`${skill.slug}: related points to itself`);
      else if (skills.length >= 20 && !bySlug.has(slug)) problems.push(`${skill.slug}: related "${slug}" is not a skill`);
    }
    for (const slug of skill.guides ?? []) if (!PLANNED_GUIDE_SLUGS.includes(slug)) problems.push(`${skill.slug}: guides "${slug}" is not a planned guide`);
  }
  assert.deepEqual(problems, []);
});

test('guide data satisfies the shape and length contract', () => {
  const problems = [];
  const skillSlugs = new Set(skills.map((skill) => skill.slug));
  for (const guide of guides) {
    const at = `guide ${guide.slug ?? '?'} (${guide.__file})`;
    if (!isSlug(guide.slug)) problems.push(`${at}: slug must be ASCII kebab-case`);
    if (!guide.title || guide.title.length < 20 || guide.title.length > 60) problems.push(`${at}: title must be 20-60 chars (is ${guide.title?.length})`);
    if (!guide.description || guide.description.length < 70 || guide.description.length > 165) problems.push(`${at}: description must be 70-165 chars (is ${guide.description?.length})`);
    if (!['clients', 'freelancers', 'both'].includes(guide.audience)) problems.push(`${at}: audience must be clients, freelancers or both`);
    if (!isDate(guide.published) || !isDate(guide.modified) || guide.modified < guide.published) problems.push(`${at}: published/modified must be valid dates with modified >= published`);
    if (!guide.summary || guide.summary.length < 60 || guide.summary.length > 320) problems.push(`${at}: summary must be 60-320 chars (is ${guide.summary?.length})`);
    if (!Array.isArray(guide.sections) || guide.sections.length < 4) problems.push(`${at}: needs at least 4 sections`);
    const ids = new Set();
    for (const [index, section] of (guide.sections ?? []).entries()) {
      const sectionAt = `${at}.sections[${index}]`;
      if (!isSlug(section.id)) problems.push(`${sectionAt}: id must be ASCII kebab-case`);
      if (ids.has(section.id)) problems.push(`${sectionAt}: duplicate id ${section.id}`);
      ids.add(section.id);
      if (!section.heading) problems.push(`${sectionAt}: missing heading`);
      if (!section.answer || section.answer.length < 30 || section.answer.length > 320) problems.push(`${sectionAt}: answer must be 30-320 chars (is ${section.answer?.length})`);
      if (!section.paragraphs?.length && !section.list?.items?.length && !section.table?.rows?.length) problems.push(`${sectionAt}: needs paragraphs, a list or a table beyond the answer`);
      if (section.table) {
        if (!section.table.caption) problems.push(`${sectionAt}: table needs a caption`);
        for (const [rowIndex, row] of section.table.rows.entries()) if (row.length !== section.table.columns.length) problems.push(`${sectionAt}: table row ${rowIndex} has ${row.length} cells for ${section.table.columns.length} columns`);
      }
    }
    if (!Array.isArray(guide.faq) || guide.faq.length < 3) problems.push(`${at}: needs at least 3 FAQ entries`);
    for (const [index, item] of (guide.faq ?? []).entries()) {
      if (!item.question?.endsWith('?')) problems.push(`${at}.faq[${index}].question must end with "?"`);
      if (!item.answer || item.answer.length < 40 || item.answer.length > 400) problems.push(`${at}.faq[${index}].answer must be 40-400 chars (is ${item.answer?.length})`);
    }
    if (!Array.isArray(guide.related) || guide.related.length < 3 || guide.related.length > 6) problems.push(`${at}: related needs 3-6 paths`);
    for (const related of guide.related ?? []) {
      const known = STATIC_PATHS.includes(related)
        || /^\/categories\/(.+)$/.test(related) && CATEGORY_SLUGS.includes(related.split('/')[2])
        || /^\/guides\/(.+)$/.test(related) && PLANNED_GUIDE_SLUGS.includes(related.split('/')[2]) && related.split('/')[2] !== guide.slug
        || /^\/skills\/(.+)$/.test(related) && (skillSlugs.size === 0 || skillSlugs.has(related.split('/')[2]));
      if (!known) problems.push(`${at}: related "${related}" does not resolve to a known page`);
    }
    lintSources(at, guide.sources, problems);
    if (guide.audience !== 'clients' && /חוזה|הסכם|זכויות/.test(JSON.stringify(guide.sections)) && !guide.disclaimer) problems.push(`${at}: legal topics need a disclaimer ("לא ייעוץ משפטי")`);
  }
  const slugs = guides.map((guide) => guide.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'guide slugs must be unique');
  assert.deepEqual(problems, []);
});

test('glossary entries are complete', () => {
  const problems = [];
  const seen = new Set();
  for (const [index, entry] of glossary.entries()) {
    const at = `glossary[${index}] ${entry.term ?? '?'}`;
    if (!entry.term) problems.push(`${at}: missing term`);
    if (seen.has(entry.term)) problems.push(`${at}: duplicate term`);
    seen.add(entry.term);
    if (!entry.definition || entry.definition.length < 25 || entry.definition.length > 220) problems.push(`${at}: definition must be 25-220 chars (is ${entry.definition?.length})`);
    if (!entry.practical || entry.practical.length < 25 || entry.practical.length > 260) problems.push(`${at}: practical sentence must be 25-260 chars (is ${entry.practical?.length})`);
  }
  assert.deepEqual(problems, []);
});

test('all editorial text passes the honesty and typography lint', () => {
  const problems = [];
  for (const skill of skills) for (const [where, text] of strings(skill, `skill ${skill.slug}`)) lintText(where, text, problems);
  for (const guide of guides) for (const [where, text] of strings(guide, `guide ${guide.slug}`)) lintText(where, text, problems);
  for (const [index, entry] of glossary.entries()) for (const [where, text] of strings(entry, `glossary[${index}]`)) lintText(where, text, problems);
  assert.deepEqual(problems, []);
});

test('every external fact in a guide or skill is sourced with a check date', () => {
  const problems = [];
  for (const item of [...skills, ...guides]) {
    for (const source of item.sources ?? []) if (!isDate(source.checked)) problems.push(`${item.slug}: source "${source.name}" has no valid check date`);
  }
  assert.deepEqual(problems, []);
});

test('info page content satisfies the contract in both billing states', () => {
  const problems = [];
  const skillSlugs = new Set(skills.map((skill) => skill.slug));
  for (const { name, content, kind } of info) {
    if (hasPlaceholder(content)) { if (STRICT) problems.push(`${name}: placeholder content`); continue; }
    const at = `info ${name}`;
    if (!content.h1) problems.push(`${at}: missing h1`);
    if (!content.summary || content.summary.length < 40 || content.summary.length > 320) problems.push(`${at}: summary must be 40-320 chars (is ${content.summary?.length})`);
    if (!Array.isArray(content.related) || content.related.length < 3 || content.related.length > 6) problems.push(`${at}: related needs 3-6 paths`);
    problems.push(...relatedProblems(at, content.related, undefined, skillSlugs));
    if (kind === 'page') {
      if (!Array.isArray(content.sections) || content.sections.length < 3) problems.push(`${at}: needs at least 3 sections`);
      const ids = new Set();
      for (const [index, section] of (content.sections ?? []).entries()) {
        const sectionAt = `${at}.sections[${index}]`;
        if (!isSlug(section.id) || ids.has(section.id)) problems.push(`${sectionAt}: id must be unique ASCII kebab-case`);
        ids.add(section.id);
        if (!section.heading) problems.push(`${sectionAt}: missing heading`);
        if (!section.answer || section.answer.length < 30 || section.answer.length > 320) problems.push(`${sectionAt}: answer must be 30-320 chars (is ${section.answer?.length})`);
        if (!section.paragraphs?.length && !section.list?.items?.length && !section.table?.rows?.length) problems.push(`${sectionAt}: needs paragraphs, a list or a table beyond the answer`);
      }
      if (!Array.isArray(content.faq) || content.faq.length < 3) problems.push(`${at}: needs at least 3 FAQ entries`);
      for (const [index, item] of (content.faq ?? []).entries()) {
        if (!item.question?.endsWith('?')) problems.push(`${at}.faq[${index}].question must end with "?"`);
        if (!item.answer || item.answer.length < 40 || item.answer.length > 400) problems.push(`${at}.faq[${index}].answer must be 40-400 chars (is ${item.answer?.length})`);
      }
    } else {
      const items = (content.groups ?? []).flatMap((group) => group.items);
      if ((content.groups ?? []).length < 4) problems.push(`${at}: needs at least 4 groups`);
      if (items.length < 15 || items.length > 30) problems.push(`${at}: needs 15-30 questions (has ${items.length})`);
      for (const [index, item] of items.entries()) {
        if (!item.question?.endsWith('?')) problems.push(`${at}.items[${index}].question must end with "?"`);
        if (!item.answer || item.answer.length < 40 || item.answer.length > 400) problems.push(`${at}.items[${index}].answer must be 40-400 chars (is ${item.answer?.length})`);
      }
      const asked = items.map((item) => item.question);
      if (new Set(asked).size !== asked.length) problems.push(`${at}: duplicate questions`);
    }
    for (const [where, text] of strings(content, at)) lintText(where, text, problems);
  }
  assert.deepEqual(problems, []);
});

test('category questions and the glossary intro are complete and pass the lint', () => {
  const problems = [];
  for (const [slug, items] of Object.entries(categoryFaq)) {
    if (!CATEGORY_SLUGS.includes(slug)) problems.push(`category-faq: unknown category ${slug}`);
    if (items.length < 3) problems.push(`category-faq ${slug}: needs at least 3 questions`);
    for (const [index, item] of items.entries()) {
      if (!item.question?.endsWith('?')) problems.push(`category-faq ${slug}[${index}]: question must end with "?"`);
      if (!item.answer || item.answer.length < 40 || item.answer.length > 400) problems.push(`category-faq ${slug}[${index}]: answer must be 40-400 chars (is ${item.answer?.length})`);
      for (const [where, text] of strings(item, `category-faq ${slug}[${index}]`)) lintText(where, text, problems);
    }
  }
  if (intro && !hasPlaceholder(intro)) {
    if (!intro.h1) problems.push('glossary intro: missing h1');
    if (!intro.summary || intro.summary.length < 40 || intro.summary.length > 320) problems.push(`glossary intro: summary must be 40-320 chars (is ${intro.summary?.length})`);
    for (const [where, text] of strings(intro, 'glossary intro')) lintText(where, text, problems);
  }
  assert.deepEqual(problems, []);
});

test('the planned catalogue is complete (SEO_CONTENT_COMPLETE=1)', { skip: !STRICT && 'set SEO_CONTENT_COMPLETE=1 to require the full catalogue' }, () => {
  const problems = [];
  if (skills.length < 20) problems.push(`needs at least 20 skills (has ${skills.length})`);
  for (const category of CATEGORY_SLUGS) if (!skills.some((skill) => skill.category === category)) problems.push(`no skill in category ${category}`);
  const required = PLANNED_GUIDE_SLUGS.filter((slug) => slug !== 'project-brief');
  for (const slug of required) if (!guides.some((guide) => guide.slug === slug)) problems.push(`missing guide ${slug}`);
  if (glossary.length < 18) problems.push(`glossary needs at least 18 terms (has ${glossary.length})`);
  if (intro && hasPlaceholder(intro)) problems.push('glossary intro is still a placeholder');
  for (const category of CATEGORY_SLUGS) if ((categoryFaq[category] ?? []).length < 3) problems.push(`category-faq ${category}: needs at least 3 questions`);
  for (const item of info) if (hasPlaceholder(item.content)) problems.push(`info ${item.name}: placeholder content`);
  for (const skill of skills) for (const slug of skill.related ?? []) if (!skills.some((other) => other.slug === slug)) problems.push(`${skill.slug}: related "${slug}" is not a skill`);
  assert.deepEqual(problems, []);
});
