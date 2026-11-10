// Composition rules for the category page content. Pure module.
import type { Question } from './types';

// The visible FAQ of a category page: the category's own question first, then the extra
// questions from category-faq.ts. A missing or empty extra list is fine (the page then shows
// the category's own question only), and a question that is already listed or has no answer
// is skipped, so the FAQPage markup built from this list never repeats or omits anything.
export function categoryFaqItems(category: Question, extra: readonly Question[] | undefined): Question[] {
  const items: Question[] = [];
  const seen = new Set<string>();
  for (const item of [{ question: category.question, answer: category.answer }, ...(extra ?? [])]) {
    const question = item?.question?.trim();
    const answer = item?.answer?.trim();
    if (!question || !answer || seen.has(question)) continue;
    seen.add(question);
    items.push({ question, answer });
  }
  return items;
}
