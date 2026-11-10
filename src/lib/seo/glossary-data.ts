// Glossary for the /glossary page: working terms of freelance projects, each with a one-sentence
// definition and one practical sentence. Neutral and general; no legal, tax or accounting advice.
export type GlossaryTerm = {
  term: string;          // Hebrew term, optionally followed by the Latin acronym in parentheses
  definition: string;    // one sentence: what it is
  practical: string;     // one sentence: what to do with it in a freelance project
};

export const glossaryIntro = {
  h1: 'PLACEHOLDER מילון מונחים',
  summary: 'PLACEHOLDER',
};

export const glossaryTerms: GlossaryTerm[] = [];
