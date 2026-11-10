import type { Skill } from './types';

// Curated skill landing pages (each becomes /skills/<slug>).
export const skills: Skill[] = [];

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
