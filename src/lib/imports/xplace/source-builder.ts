// Builds the labelled `sourceText` of a captured profile under a hard character budget.
// Pure and isomorphic: no I/O, so the budget logic is unit-tested on its own.

export const SOURCE_TEXT_MAX = 14_000;

/** One labelled block. `heading` is only emitted when at least one of its lines fits. */
export type SourceSection = { heading?: string; lines: string[] };

function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  const text = value.slice(0, Math.max(0, max));
  return /[\ud800-\udbff]$/.test(text) ? text.slice(0, -1) : text;
}

/**
 * Fills `sections` in the given order (the order IS the priority) under `budget` characters, counting the
 * `\n` joiners. A section keeps its lines in order until the first one that does not fit; later sections
 * still get whatever budget remains. The result never exceeds `budget`. `omitted` is true when anything was dropped.
 */
export function fitSections(sections: SourceSection[], budget: number = SOURCE_TEXT_MAX): { text: string; omitted: boolean } {
  const out: string[] = [];
  let used = 0;
  let omitted = false;
  for (const section of sections) {
    const lines = section.lines.filter(Boolean);
    // The heading and the first line are accepted or refused together.
    let heading = section.heading && lines.length ? section.heading : '';
    for (const line of lines) {
      const items = heading ? [heading, line] : [line];
      const total = items.reduce((sum, item, index) => sum + item.length + (out.length + index > 0 ? 1 : 0), 0);
      if (used + total > budget) {
        if (!out.length) { const head = cut(line, budget); if (head) { out.push(head); used += head.length; } }
        omitted = true;
        break;
      }
      out.push(...items);
      used += total;
      heading = '';
    }
  }
  return { text: out.join('\n'), omitted };
}

/** Cleaned profile facts, already capped by the ingest validation. */
export type ProfileFacts = {
  url: string;
  headline: string; slogan: string; location: string; about: string;
  languages: { name: string; level: string }[];
  expertise: { industry: string; name: string; description: string }[];
  employment: { period: string; position: string; company: string; description: string }[];
  education: { period: string; degree: string; institution: string; description: string }[];
  otherSections: { section: string; entries: string[] }[];
  links: { url: string; title: string; description: string }[];
};

const join = (parts: string[], separator: string) => parts.filter(Boolean).join(separator);

/**
 * Priority order: header and about, employment, education, expertise (industry and name lines first, then
 * their descriptions), languages, links, other sections. English labels, like the Dribbble source.
 */
export function profileSections(f: ProfileFacts): SourceSection[] {
  return [
    { lines: [
      'XPlace profile (captured from the owner\'s own page)',
      `Profile URL: ${f.url}`,
      f.headline && `Headline: ${f.headline}`,
      f.slogan && `Slogan: ${f.slogan}`,
      f.location && `Location: ${f.location}`,
      f.about && `About: ${f.about}`,
    ].filter((line): line is string => Boolean(line)) },
    { heading: 'Employment:', lines: f.employment.map((e) => join([join([e.period, join([e.position, e.company], ', ')], ' · '), e.description], '\n  ')) },
    { heading: 'Education:', lines: f.education.map((e) => join([join([e.period, join([e.degree, e.institution], ', ')], ' · '), e.description], '\n  ')) },
    { heading: 'Expertise:', lines: f.expertise.map((e) => join([e.industry, e.name], ': ')) },
    { heading: 'Expertise details:', lines: f.expertise.filter((e) => e.description).map((e) => `${e.name || e.industry}: ${e.description}`) },
    { heading: 'Languages:', lines: f.languages.map((l) => join([l.name, l.level && `(${l.level})`], ' ')) },
    { heading: 'Links:', lines: f.links.map((l) => join([l.title, l.url, l.description], ' · ')) },
    ...f.otherSections.map((s) => ({ heading: `${s.section}:`, lines: s.entries })),
  ];
}

export function buildProfileSourceText(facts: ProfileFacts, budget: number = SOURCE_TEXT_MAX): { text: string; omitted: boolean } {
  return fitSections(profileSections(facts), budget);
}
