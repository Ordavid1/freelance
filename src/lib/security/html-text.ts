import { convert, type HtmlToTextOptions } from 'html-to-text';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];

/**
 * html-to-text walks the DOM recursively, so a few thousand nested elements overflow the stack
 * (RangeError) and crash the caller. Anything deeper than this is replaced by `ellipsis` below.
 * Real documents and emails nest far less than this; the cost stays linear (100k levels ~1.4 s).
 */
const MAX_DEPTH = 256;

/**
 * Elements nested deeper than this are unwrapped (their children take their place) before
 * conversion, so text under hostile wrappers is kept instead of being cut by `maxDepth`.
 * Kept well below MAX_DEPTH to leave room for the html/body wrappers.
 */
const FLATTEN_DEPTH = 128;

/**
 * Iteratively unwraps every element deeper than FLATTEN_DEPTH. Never recurses, so depth is harmless.
 * Parsed as a full document (not a fragment) so <head> content such as <title> and <style> stays in
 * <head>, where html-to-text's default `baseElements` (body) leaves it out of the text, exactly as
 * it does for the raw input.
 */
function flattenDeepNesting(html: string): string {
  const root = parse(html);
  const pending: [Node & { childNodes: Node[] }, number][] = [[root, 0]];
  while (pending.length) {
    const [parent, depth] = pending.pop()!;
    const kept: Node[] = [];
    const todo = [...parent.childNodes].reverse();
    while (todo.length) {
      const child = todo.pop()!;
      if ('tagName' in child && depth >= FLATTEN_DEPTH) {
        // Skipped-content elements must not leak their text when unwrapped.
        if (!['script', 'style', 'template', 'noscript'].includes(child.tagName)) {
          for (let i = child.childNodes.length - 1; i >= 0; i--) todo.push(child.childNodes[i]);
        }
        continue;
      }
      kept.push(child);
      if ('childNodes' in child) pending.push([child, depth + 1]);
    }
    parent.childNodes = kept;
  }
  return serialize(root);
}

/**
 * Converts HTML from an untrusted source (inbound email, third-party API) to plain text without
 * letting hostile nesting crash the process. Caller options (e.g. `selectors`) are kept; wordwrap
 * is off unless the caller says otherwise. `limits` are merged so a caller can tune but not drop them.
 */
export function untrustedHtmlToText(html: string, options: HtmlToTextOptions = {}): string {
  return convert(flattenDeepNesting(html), {
    wordwrap: false,
    ...options,
    // Empty ellipsis: the library default is '...', which would leak literal dots into the text
    // wherever content is cut. Over-deep content is simply dropped.
    // maxChildNodes is deliberately unset: wide (not deep) documents are iterative and safe, and a
    // cap would silently truncate legitimate long lists and tables.
    limits: { ellipsis: '', ...options.limits, maxDepth: Math.min(options.limits?.maxDepth ?? MAX_DEPTH, MAX_DEPTH) },
  });
}
