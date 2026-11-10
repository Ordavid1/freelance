import { designSkills } from './skill-data/design';
import { videoAnimationSkills } from './skill-data/video-animation';
import { webDevelopmentSkills } from './skill-data/web-development';
import { writingMarketingSkills } from './skill-data/writing-marketing';
import type { Skill } from './types';

// Curated skill landing pages (each becomes /skills/<slug>). The catalogue is the
// aggregate of the per-category data modules, in category order, so each content
// author owns one file and nothing else has to be edited to add a skill.
export const skills: Skill[] = [
  ...webDevelopmentSkills,
  ...designSkills,
  ...writingMarketingSkills,
  ...videoAnimationSkills,
];

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// Quality gate: a skill page is indexable only when it carries complete, original
// content. Thin pages are kept out of the sitemap and navigation instead of being published.
export function skillCompleteness(skill: Skill) {
  const issues: string[] = [];
  if (skill.definition.trim().length < 80) issues.push('definition is shorter than 80 characters');
  if (skill.deliverables.length < 4) issues.push('needs at least 4 deliverables');
  if (skill.howToChoose.length < 4) issues.push('needs at least 4 selection criteria');
  if (skill.priceDrivers.length < 3) issues.push('needs at least 3 price drivers');
  if (skill.questions.length < 3) issues.push('needs at least 3 questions');
  const wordCount = words([
    skill.definition, skill.whenNeeded, ...skill.deliverables, ...skill.howToChoose, ...skill.priceDrivers,
    ...skill.questions.flatMap(({ question, answer }) => [question, answer]),
  ].join(' '));
  if (wordCount < 250) issues.push(`has ${wordCount} words, at least 250 are required`);
  return { complete: issues.length === 0, issues, wordCount };
}

// The helpers below are pure and take the catalogue as an optional argument, so tests and
// callers can use them on any list without touching the real data.
export function skillBySlug(slug: string, catalogue: readonly Skill[] = skills): Skill | undefined {
  return catalogue.find((skill) => skill.slug === slug);
}

export function skillsByCategory(category: string, catalogue: readonly Skill[] = skills): Skill[] {
  return catalogue.filter((skill) => skill.category === category);
}

// Whether the skill page may be indexed, linked from hubs and listed in the footer.
export function isIndexableSkill(skill: Skill): boolean {
  return skillCompleteness(skill).complete;
}

export function indexableSkills(catalogue: readonly Skill[] = skills): Skill[] {
  return catalogue.filter(isIndexableSkill);
}

// The skill's `related` slugs that can actually be linked: they must exist, be indexable
// and differ from the skill itself. Unknown or thin pages are dropped, never linked.
export function relatedSkills(skill: Skill, catalogue: readonly Skill[] = skills): Skill[] {
  const seen = new Set<string>([skill.slug]);
  const result: Skill[] = [];
  for (const slug of skill.related) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const match = skillBySlug(slug, catalogue);
    if (match && isIndexableSkill(match)) result.push(match);
  }
  return result;
}
