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

export function metaValues(page: ProjectHtml, attr: string, name: string): string[] {
  return page.elements.filter((node) => node.tagName === 'meta' && attribute(node, attr) === name)
    .flatMap((node) => {
      // Re-escape the parsed value for the existing single-decode text cleaner.
      // Serialize a text node rather than decoding entities a second time here.
      const value = attribute(node, 'content');
      return value === undefined ? [] : [serialize({ nodeName: '#document-fragment', childNodes: [
        { nodeName: '#text', value, parentNode: null },
      ] })];
    });
}
