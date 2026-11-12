// Text cleaning, mirroring src/lib/imports/xplace/clean.ts of the website. Page content is data: only ever plain text.
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    lrm: '', rlm: '', shy: '', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  };

  function decodeEntities(value) {
    return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (match, dec, hex, name) => {
      if (name) return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : match;
      const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
      return String.fromCodePoint(code);
    });
  }

  // Finds the next match of `re` at or after a position, in amortised linear time over a scan that only moves
  // forward: the last result is reused while it is still ahead, and "no match from here" is remembered.
  function forwardFinder(text, re) {
    let at = -1; let end = -1; let none = Infinity;
    return (from) => {
      if (from >= none) return null;
      if (at >= from) return { index: at, end };
      re.lastIndex = from;
      const m = re.exec(text);
      if (!m) { none = from; return null; }
      at = m.index; end = m.index + m[0].length;
      return { index: at, end };
    };
  }

  /**
   * Single-pass, linear tag/comment/script/style stripper. A tag or comment that never closes is literal text
   * (the scan continues right after its opening character, never from the start).
   */
  function stripMarkup(value) {
    const n = value.length;
    if (value.indexOf('<') === -1) return value;
    const gt = forwardFinder(value, />/g);
    const commentEnd = forwardFinder(value, /--!?>/g);
    // Locate the closing name and its delimiter separately, so repeated
    // unterminated closing tags cannot make a regex retry an attribute tail.
    const scriptEnd = forwardFinder(value, /<\/script(?=[\t\n\f\r />])/gi);
    const styleEnd = forwardFinder(value, /<\/style(?=[\t\n\f\r />])/gi);
    let out = '';
    let i = 0;
    let lit = 0; // start of the pending literal run
    const flush = (upTo) => { if (upTo > lit) out += value.slice(lit, upTo); };
    while (i < n) {
      const lt = value.indexOf('<', i);
      if (lt === -1) break;
      i = lt;
      const c = value[i + 1];
      if (value.startsWith('<!--', i)) {
        const e = commentEnd(i + 4);
        if (e) { flush(i); i = e.end; lit = i; continue; }
        i += 1; continue;
      }
      const head = value.slice(i + 1, i + 7).toLowerCase();
      const block = head.startsWith('script') && !/[\w]/.test(value[i + 7] || ' ') ? scriptEnd
        : head.startsWith('style') ? (!/[\w]/.test(value[i + 6] || ' ') ? styleEnd : null) : null;
      if (block) {
        const open = gt(i);
        const closingName = open && block(open.end);
        const close = closingName && gt(closingName.end);
        if (open && close) { flush(i); out += ' '; i = close.end; lit = i; continue; }
      }
      const shaped = c !== undefined && (/[a-zA-Z!]/.test(c) || (c === '/' && /[a-zA-Z!]/.test(value[i + 2] || '')));
      if (shaped) {
        const close = gt(i + 1);
        if (close) { flush(i); out += ' '; i = close.end; lit = i; continue; }
      }
      i += 1;
    }
    flush(n);
    return out;
  }

  function capText(value, max) {
    if (value.length <= max) return value;
    let cut = value.slice(0, max);
    if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
    return cut.trim();
  }

  /** Plain text: tags and entities removed, control characters stripped, whitespace collapsed, capped. */
  function cleanText(value, max, options) {
    if (typeof value !== 'string') return '';
    const paragraphs = Boolean(options && options.paragraphs);
    let text = value;
    if (paragraphs) text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n\n');
    text = stripMarkup(decodeEntities(stripMarkup(text)));
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, '');
    if (paragraphs) {
      text = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim()).join('\n')
        .replace(/\n{3,}/g, '\n\n');
    } else {
      text = text.replace(/\s+/g, ' ');
    }
    return capText(text.trim(), max);
  }

  /** Values copied from unrendered AngularJS templates or the generic site title are not content. */
  function isUsableText(value) {
    if (!value || value.includes('{{') || value.includes('}}')) return false;
    return !/^(www\.)?xplace(\.com)?$/i.test(value.trim());
  }

  FPX.clean = { cleanText, isUsableText, capText };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.clean;
})(globalThis);
