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

/**
 * Removes comments, script/style blocks and tags in ONE linear pass (hostile input such as '<a' repeated must
 * not cost quadratic time). A tag or comment that has no closing `>` / `-->` anywhere after it is plain text:
 * the `<` stays and scanning continues right after it. Once a closer is known not to exist, it is never searched again.
 */
function stripMarkup(value: string): string {
  let out = '';
  let i = 0;
  let noGt = false;
  let noCommentEnd = false;
  let noScriptEnd = false;
  let noStyleEnd = false;
  const closers = { script: /<\/script\s*>/gi, style: /<\/style\s*>/gi };
  while (i < value.length) {
    const lt = value.indexOf('<', i);
    if (lt === -1) { out += value.slice(i); break; }
    out += value.slice(i, lt);
    i = lt + 1;
    if (value.startsWith('!--', i)) {
      const end = noCommentEnd ? -1 : value.indexOf('-->', i + 3);
      if (end === -1) { noCommentEnd = true; out += '<'; continue; }
      i = end + 3;
      continue;
    }
    let j = i;
    if (value[j] === '/') j += 1;
    if (!/[a-zA-Z!]/.test(value[j] ?? '')) { out += '<'; continue; }
    const gt = noGt ? -1 : value.indexOf('>', j);
    if (gt === -1) { noGt = true; out += '<'; continue; }
    i = gt + 1;
    const name = /^(script|style)(?![A-Za-z0-9_])/i.exec(value.slice(j, gt))?.[1]?.toLowerCase();
    if (name && value[lt + 1] !== '/') {
      const key = name as 'script' | 'style';
      const done = key === 'script' ? noScriptEnd : noStyleEnd;
      let end = -1;
      if (!done) {
        closers[key].lastIndex = i;
        const found = closers[key].exec(value);
        end = found ? found.index + found[0].length : -1;
      }
      if (end === -1) { if (key === 'script') noScriptEnd = true; else noStyleEnd = true; out += ' '; continue; }
      i = end;
    }
    out += ' ';
  }
  return out;
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
