import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
export type HtmlElement = DefaultTreeAdapterMap['element'];
export type ProjectHtml = { elements: HtmlElement[] };

export function isElement(node: Node): node is HtmlElement {
  return 'tagName' in node;
}

/** Pure HTML parsing: no DOM execution, resource loading, or repeated regex stripping. */
export function parseProjectHtml(html: string): ProjectHtml {
  const document = parse(html);
  const elements: HtmlElement[] = [];
  const pending: Node[] = [document];
  while (pending.length) {
    const node = pending.pop()!;
    if (isElement(node)) elements.push(node);
    if ('childNodes' in node) {
      // Remove these nodes before either traversal or serialization. Their text is
      // never a source of page markup, metadata, or fallback project fields.
      node.childNodes = node.childNodes.filter((child) => child.nodeName !== '#comment'
        && (!isElement(child) || !['script', 'style', 'template', 'noscript'].includes(child.tagName)));
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
  return { elements };
}

export function attribute(node: HtmlElement, name: string): string | undefined {
  return node.attrs.find((attr) => attr.name === name)?.value;
}

/** Serialize only the children of a real parsed element; text stays HTML-escaped. */
export function contents(node: HtmlElement | undefined): string {
  return node ? serialize(node) : '';
}

/** HTML-escape a plain string (via parse5) so the single entity decode in `cleanText` restores it. */
function escapedText(value: string): string {
  return serialize({ nodeName: '#document-fragment', childNodes: [
    { nodeName: '#text', value, parentNode: null },
  ] });
}

/**
 * The first `maxChars` or so of an element's text, collected iteratively in document order, in the
 * same shape `cleanText(contents(node))` sees: text node values plus one ' ' at every element
 * start and end (stripMarkup turns each tag into a space). Collection stops once the raw length
 * exceeds `maxChars` or `maxElements` elements have been entered, so the cost per call is a small
 * constant however large or deeply nested the subtree is, and a scan over every element of a
 * document stays linear. The result is always a prefix of the full text, so a comparison against
 * a short label reads the same leading text it would read from the whole subtree. Use for label
 * comparisons only; keep `contents` for values that are actually extracted. Returned text is
 * escaped like `contents` output.
 */
export function textPreview(node: HtmlElement, maxChars: number, maxElements = 16): string {
  let text = '';
  let elements = 0;
  // Stack entries: a node to visit, or the marker string for "element closed".
  const stack: (Node | 'end')[] = [node];
  while (stack.length && text.length <= maxChars) {
    const item = stack.pop()!;
    if (item === 'end') { text += ' '; continue; }
    if (item.nodeName === '#text') { text += (item as { value: string }).value; continue; }
    if (!isElement(item)) continue;
    if (++elements > maxElements) break;
    text += ' ';
    stack.push('end');
    const children = item.childNodes; // <template> elements are already removed by parseProjectHtml
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return escapedText(text);
}

export function metaValues(page: ProjectHtml, attr: string, name: string): string[] {
  return page.elements.filter((node) => node.tagName === 'meta' && attribute(node, attr) === name)
    .flatMap((node) => {
      // Re-escape the parsed value for the existing single-decode text cleaner.
      // Escape rather than decoding entities a second time here.
      const value = attribute(node, 'content');
      return value === undefined ? [] : [escapedText(value)];
    });
}
