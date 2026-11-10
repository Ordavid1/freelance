// Page content for the informational pages (/pricing, /about, /how-it-works, /faq). Every statement about
// price, trial or billing is built from MembershipFacts (facts.ts), never typed by hand.
import type { MembershipFacts } from './facts';
import type { GuideSection, Question } from './types';

export type InfoContent = {
  h1: string;
  summary: string;            // "בקיצור": the direct answer, <= 320 chars
  sections: GuideSection[];   // >= 3, same shape as guide sections
  faq: Question[];            // >= 3, rendered and emitted as FAQPage with identical text
  related: string[];          // registry paths, 3-6
  disclaimer?: string;
};
export type FaqGroup = { id: string; heading: string; items: Question[] };
export type FaqContent = { h1: string; summary: string; groups: FaqGroup[]; related: string[] };

const placeholder: InfoContent = {
  h1: 'PLACEHOLDER',
  summary: 'PLACEHOLDER',
  sections: [{ id: 'placeholder', heading: 'PLACEHOLDER', answer: 'PLACEHOLDER', paragraphs: ['PLACEHOLDER'] }],
  faq: [{ question: 'PLACEHOLDER?', answer: 'PLACEHOLDER' }],
  related: ['/', '/guides', '/faq'],
};

export function pricingContent(_facts: MembershipFacts): InfoContent { return placeholder; }
export function aboutContent(): InfoContent { return placeholder; }
export function howItWorksContent(): InfoContent { return placeholder; }
export function faqContent(_facts: MembershipFacts): FaqContent {
  return { h1: 'PLACEHOLDER', summary: 'PLACEHOLDER', groups: [{ id: 'placeholder', heading: 'PLACEHOLDER', items: [{ question: 'PLACEHOLDER?', answer: 'PLACEHOLDER' }] }], related: ['/', '/guides', '/pricing'] };
}
