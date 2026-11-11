// One text-cleaning helper for everything read from XPlace pages. Fetched content is
// untrusted data: it is only ever turned into plain text, never evaluated.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lrm: '', rlm: '', shy: '', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (match, dec, hex, name) => {
    if (name) return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match;
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
    return String.fromCodePoint(code);
  });
}

function stripMarkup(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<\/?[a-zA-Z!][^>]*>/g, ' ');
}

function capText(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  // Do not leave half a surrogate pair at the end.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trim();
}

/**
 * Turns an HTML fragment or attribute value into plain text: tags and entities removed
 * (entity-encoded tags too), control characters stripped, whitespace collapsed, length capped.
 * With `paragraphs`, block-level breaks survive as `\n` and blank lines as `\n\n`.
 */
export function cleanText(value: unknown, max: number, options: { paragraphs?: boolean } = {}): string {
  if (typeof value !== 'string') return '';
  let text = value;
  if (options.paragraphs) text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n\n');
  // Strip, decode once, strip again: `&lt;script&gt;` must not come back as markup.
  text = stripMarkup(decodeEntities(stripMarkup(text)));
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, '');
  if (options.paragraphs) {
    text = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }
  return capText(text.trim(), max);
}

/** Values copied from unrendered AngularJS templates or the generic site title are not content. */
export function isUsableText(value: string): boolean {
  if (!value || value.includes('{{') || value.includes('}}')) return false;
  return !/^(www\.)?xplace(\.com)?$/i.test(value.trim());
}

/** HTML without script and style blocks, so text inside scripts can never pose as page markup. */
export function withoutScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
}

/** Every `content` of `<meta {attr}="{name}">` in document order (raw attribute text, still entity-encoded). */
export function metaValues(html: string, attr: 'name' | 'property' | 'itemprop', name: string): string[] {
  const out: string[] = [];
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? '';
    if (attrs[attr] === name && typeof attrs.content === 'string') out.push(attrs.content);
  }
  return out;
}

/** Raw text of the `<title>` element, when present. */
export function titleTag(html: string): string {
  return /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? '';
}
