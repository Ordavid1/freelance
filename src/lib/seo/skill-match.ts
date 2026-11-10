// Matches published projects to skill pages. One rule serves the skill pages (open
// projects for a skill), the project index and the project page (skill tags that link
// to a skill page), so the three can never disagree. Pure module.
//
// A project matches a skill when
//   1. one of the project's own `skills` equals one of the skill's aliases (case-insensitive), or
//   2. an alias with at least three Latin letters appears as a whole word or phrase in the
//      project's title.
// The project's category alone never makes a match, and Hebrew aliases match only through
// the project's `skills`: Hebrew words inside titles are too ambiguous to infer a skill from.
import type { Skill } from './types';

type MatchableProject = { title: string; skills: readonly string[] };

const MIN_LATIN_LETTERS = 3;

const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const latinLetters = (value: string) => (value.match(/[A-Za-z]/g) ?? []).length;
const hasHebrew = (value: string) => /[֐-׿]/.test(value);
const isWordCharacter = (char: string | undefined) => char !== undefined && /[A-Za-z0-9_]/.test(char);

// Aliases that may be looked up inside a title: product and tool names written in Latin
// letters (WordPress, Figma, SEO). Short abbreviations (WP, UX) and anything with Hebrew
// letters are excluded, they only match through the project's `skills`. Digits and
// punctuation do not count towards the minimum.
export function isTitleAlias(alias: string): boolean {
  return !hasHebrew(alias) && latinLetters(alias) >= MIN_LATIN_LETTERS;
}

// True when `term` occurs in `text` bounded by anything other than a Latin letter, digit or
// underscore (Hebrew letters and punctuation count as boundaries, so "ב־WordPress" matches
// and "WordPressify" does not). Both arguments must already be normalised.
export function containsWholeWord(text: string, term: string): boolean {
  if (!term) return false;
  let from = 0;
  while (from <= text.length - term.length) {
    const at = text.indexOf(term, from);
    if (at === -1) return false;
    if (!isWordCharacter(text[at - 1]) && !isWordCharacter(text[at + term.length])) return true;
    from = at + 1;
  }
  return false;
}

export function skillMatchesProject(skill: Skill, project: MatchableProject): boolean {
  const aliases = skill.aliases.map(normalize).filter(Boolean);
  if (aliases.length === 0) return false;
  const tags = new Set(project.skills.map(normalize));
  if (aliases.some((alias) => tags.has(alias))) return true;
  const title = normalize(project.title);
  return skill.aliases.filter(isTitleAlias).map(normalize).some((alias) => containsWholeWord(title, alias));
}

// Projects that match the skill, in the order given (callers pass them newest first).
export function projectsForSkill<T extends MatchableProject>(skill: Skill, projects: readonly T[]): T[] {
  return projects.filter((project) => skillMatchesProject(skill, project));
}

// The skills (from `catalogue`) a project matches, in catalogue order.
export function skillsForProject(project: MatchableProject, catalogue: readonly Skill[]): Skill[] {
  return catalogue.filter((skill) => skillMatchesProject(skill, project));
}

// The skill page a single tag points to: the first skill with an alias equal to the tag.
export function skillForTag(tag: string, catalogue: readonly Skill[]): Skill | undefined {
  const wanted = normalize(tag);
  if (!wanted) return undefined;
  return catalogue.find((skill) => skill.aliases.some((alias) => normalize(alias) === wanted));
}

export type ProjectSkillTag = { tag: string; skill?: Skill };

// A project's skill tags in their original order, without duplicates. A tag carries the
// skill page it belongs to when it equals an alias of one of `catalogue` (pass the indexable
// skills): such a tag is exactly why `projectsForSkill` would list the project for that skill.
export function projectSkillTags(project: { skills: readonly string[] }, catalogue: readonly Skill[]): ProjectSkillTag[] {
  const seen = new Set<string>();
  const tags: ProjectSkillTag[] = [];
  for (const tag of project.skills) {
    const key = normalize(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const skill = skillForTag(tag, catalogue);
    tags.push(skill ? { tag, skill } : { tag });
  }
  return tags;
}
