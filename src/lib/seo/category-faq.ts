import type { Question } from './types';

// Extra answer-first questions per category slug (rendered on /categories/<slug>, in addition to the
// category's own question in categories.ts). Each category needs at least 3 here.
export const categoryQuestions: Record<string, Question[]> = {};
