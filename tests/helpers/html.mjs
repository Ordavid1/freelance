import { JSDOM } from 'jsdom';

// Fragment parsing never executes scripts or loads external resources. Use a
// browser DOM implementation as an oracle independent of production extraction.
export const documentFor = (html) => JSDOM.fragment(html);

export function visibleDocument(html) {
  const document = documentFor(html);
  for (const node of document.querySelectorAll('script, style, template, noscript')) node.remove();
  return document;
}

export function visibleText(html) {
  const pending = [...visibleDocument(html).childNodes].reverse();
  const parts = [];
  while (pending.length) {
    const node = pending.pop();
    if (node.nodeType === 3) parts.push(node.nodeValue);
    for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export const jsonLdTexts = (html) => [...documentFor(html).querySelectorAll('script[type="application/ld+json"]')].map((node) => node.textContent);
