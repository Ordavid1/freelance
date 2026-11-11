// Page kinds, session facts and ownership flags. Reads only inline script text (never page content).
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const HOSTS = ['www.xplace.com', 'xplace.com'];
  const PROFILE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{1,79}$/u;
  const PROJECT_ID = /^[1-9]\d{3,9}$/;

  function decodeSegment(s) { try { return decodeURIComponent(s); } catch (e) { return null; } }

  /**
   * Page kind for a URL. Profile: /il/u/<slug>, /u/<slug>, /il/en/u/<slug>.
   * Project: /il/job-bids/<id>, /job-bids/<id>, /project?id=<id> (the last one is the "legacy" page).
   * Returns null for non-XPlace addresses, { kind: 'other' } for any other XPlace page.
   */
  function parsePage(href) {
    let url;
    try { url = new URL(String(href)); } catch (e) { return null; }
    if (url.protocol !== 'https:' || !HOSTS.includes(url.hostname) || url.port || url.username || url.password) return null;
    const decoded = url.pathname.split('/').filter(Boolean).map(decodeSegment);
    if (decoded.some((s) => s === null)) return { kind: 'other' };
    let seg = decoded;
    if (seg[0] === 'il') seg = seg.slice(1);
    if (seg[0] === 'en') seg = seg.slice(1);
    if (seg.length === 2 && seg[0] === 'u' && PROFILE_SLUG.test(seg[1])) return { kind: 'profile', slug: seg[1] };
    if (seg.length === 2 && seg[0] === 'job-bids' && PROJECT_ID.test(seg[1])) return { kind: 'project', projectId: seg[1], legacy: false };
    if (seg.length === 1 && seg[0] === 'project') {
      const id = url.searchParams.get('id') || '';
      if (PROJECT_ID.test(id)) return { kind: 'project', projectId: id, legacy: true };
    }
    return { kind: 'other' };
  }

  function inlineScriptText(doc) {
    const parts = [];
    const scripts = doc.scripts || doc.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i += 1) {
      if (scripts[i].getAttribute && scripts[i].getAttribute('src')) continue;
      const text = scripts[i].textContent;
      if (text) parts.push(text);
    }
    return parts;
  }

  const GLOBAL_NAMES = [
    'GLOBAL_JS_THIS_COMPANY_ID', 'GLOBAL_JS_THIS_COMPANY_USER_NAME', 'GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE',
    'PROFILE_SPA_CURRENT_USER_OWNER', 'PROJECT_PAGE_IS_THIS_COMPANY_OWNER',
  ];
  const ASSIGNMENT = new RegExp(
    `\\s*(?:(?:var|let|const)\\s+|window\\.)?(${GLOBAL_NAMES.join('|')})\\s*=\\s*(?:'([^'\\\\\\n]*)'|"([^"\\\\\\n]*)"|([A-Za-z0-9_$.+-]+))\\s*(?=[;,\\n}]|$)`, 'y');

  /**
   * Statement-level `NAME = value` assignments of the known globals, found by a small scanner that skips string
   * literals (', ", `) and comments, so text inside a string or JSON can never pose as a declaration.
   */
  function scanAssignments(text, into) {
    const n = text.length;
    let i = 0;
    let stmt = true;
    while (i < n) {
      const c = text[i];
      if (stmt) {
        ASSIGNMENT.lastIndex = i;
        const m = ASSIGNMENT.exec(text);
        if (m) {
          const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
          (into[m[1]] = into[m[1]] || new Set()).add(value);
          i = ASSIGNMENT.lastIndex;
          continue;
        }
        if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }
        stmt = false;
      }
      if (c === '"' || c === "'" || c === '`') {
        i += 1;
        while (i < n && text[i] !== c) { if (text[i] === '\\') i += 1; i += 1; }
        i += 1; continue;
      }
      if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e === -1 ? n : e; continue; }
      if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
      if (c === ';' || c === '{' || c === '}' || c === '\n') stmt = true;
      i += 1;
    }
  }

  /** Scripts that carry page content (the Next.js flight payload) are never scanned for globals. */
  function isContentScript(text) { return text.includes('__next_f'); }

  /** name -> value, or null when absent or declared with conflicting values across (or within) scripts. */
  function collectGlobals(scriptTexts) {
    const texts = Array.isArray(scriptTexts) ? scriptTexts : [String(scriptTexts || '')];
    const found = {};
    for (const t of texts) {
      if (typeof t !== 'string' || isContentScript(t)) continue;
      if (!/GLOBAL_JS_|PROFILE_SPA_|PROJECT_PAGE_/.test(t)) continue;
      scanAssignments(t, found);
    }
    const out = {};
    for (const name of GLOBAL_NAMES) out[name] = found[name] && found[name].size === 1 ? [...found[name]][0] : null;
    return out;
  }

  const toBool = (v) => (v === 'true' ? true : v === 'false' ? false : null);

  /** Session facts from inline scripts: logged in, own slug, account base. Never reads name globals. */
  function parseSessionFacts(scriptTexts) {
    const g = collectGlobals(scriptTexts);
    const id = g.GLOBAL_JS_THIS_COMPANY_ID;
    const slug = g.GLOBAL_JS_THIS_COMPANY_USER_NAME;
    const base = g.GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE;
    const loggedIn = id !== null && !['', '0', 'null', 'undefined', 'false'].includes(id.trim());
    const ownSlug = loggedIn && slug && PROFILE_SLUG.test(slug.trim()) ? slug.trim() : '';
    const baseValue = base ? base.trim().toUpperCase() : '';
    return {
      hasGlobals: id !== null,
      loggedIn,
      ownSlug,
      accountBase: loggedIn ? baseValue : '',
      accountType: !loggedIn || !baseValue ? 'unknown' : baseValue === 'PROVIDER' ? 'freelancer' : 'publisher',
    };
  }

  /** Decoded text of every `self.__next_f.push([1,"..."])` literal. */
  function flightText(source) {
    let text = '';
    const re = /self\.__next_f\.push\(\[\s*\d+\s*,\s*("(?:[^"\\]|\\[\s\S])*")\s*\]\)/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      try { const chunk = JSON.parse(m[1]); if (typeof chunk === 'string') text += chunk; } catch (e) { /* skip */ }
    }
    return text;
  }

  /** The balanced {...} starting at `start`, honouring JSON strings and escapes. */
  function balancedObject(text, start) {
    let depth = 0; let inString = false;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if (inString) { if (c === '\\') i += 1; else if (c === '"') inString = false; }
      else if (c === '"') inString = true;
      else if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
  }

  /**
   * Start index of the object that directly contains position `at`, found by a string-aware forward scan from the
   * start of the flight row (rows are separated by raw newlines; newlines inside strings are escaped).
   */
  function enclosingObjectStart(text, at) {
    const stack = [];
    for (let i = text.lastIndexOf('\n', at) + 1; i < at; i += 1) {
      const c = text[i];
      if (c === '"') { i += 1; while (i < at && text[i] !== '"') { if (text[i] === '\\') i += 1; i += 1; } }
      else if (c === '{' || c === '[') stack.push([c, i]);
      else if (c === '}' || c === ']') stack.pop();
    }
    const top = stack[stack.length - 1];
    return top && top[0] === '{' ? top[1] : -1;
  }

  /**
   * The embedded project record whose id equals `projectId`, plus the props object that directly contains it
   * (where XPlace puts the viewer state). Structured JSON only.
   */
  function findFlightContext(source, projectId) {
    const text = flightText(source);
    const marker = '"project":{';
    for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + marker.length)) {
      const raw = balancedObject(text, at + marker.length - 1);
      if (!raw) continue;
      let record;
      try { record = JSON.parse(raw); } catch (e) { continue; }
      if (!record || typeof record !== 'object' || Array.isArray(record) || String(record.projectId) !== String(projectId)) continue;
      let props = null;
      const start = enclosingObjectStart(text, at);
      if (start !== -1) {
        const rawProps = balancedObject(text, start);
        try {
          const parsed = rawProps ? JSON.parse(rawProps) : null;
          if (parsed && typeof parsed === 'object' && parsed.project && String(parsed.project.projectId) === String(projectId)) props = parsed;
        } catch (e) { props = null; }
      }
      return { record, props };
    }
    return null;
  }

  /** The embedded project JSON whose id equals `projectId`, or null. */
  function findFlightProject(source, projectId) {
    const found = findFlightContext(source, projectId);
    return found ? found.record : null;
  }

  /**
   * Session facts for new-format project pages, which have no legacy globals: the viewer booleans of the props object
   * that directly contains this project's record. Missing or conflicting values are unknown.
   */
  function sessionFromFlight(scriptTexts, projectId) {
    const none = { hasGlobals: false, loggedIn: false, ownSlug: '', accountBase: '', accountType: 'unknown' };
    const texts = Array.isArray(scriptTexts) ? scriptTexts : [String(scriptTexts || '')];
    if (!texts.some((t) => typeof t === 'string' && isContentScript(t))) return none;
    const found = findFlightContext(texts.join('\n'), projectId);
    const props = found && found.props;
    if (!props || props.isAuthenticatedViewer !== true) return none;
    const buyer = props.isBuyer === true;
    const freelancer = props.isFreelancer === true;
    const accountType = buyer && !freelancer ? 'publisher' : freelancer && !buyer ? 'freelancer' : 'unknown';
    return { hasGlobals: false, loggedIn: true, ownSlug: '', accountBase: accountType === 'publisher' ? 'BUYER' : accountType === 'freelancer' ? 'PROVIDER' : '', accountType };
  }

  /**
   * XPlace's own ownership flag for the current page: true, false or null when it cannot be read.
   * New project pages: only the structured `isProjectOwner` of the parsed project record counts (a description
   * string cannot forge it). The legacy global is used only when the page has no flight record at all.
   */
  function readOwnership(page, scriptTexts) {
    const texts = Array.isArray(scriptTexts) ? scriptTexts : [String(scriptTexts || '')];
    if (page.kind === 'profile') return toBool(collectGlobals(texts).PROFILE_SPA_CURRENT_USER_OWNER);
    if (page.kind === 'project') {
      if (texts.some((t) => typeof t === 'string' && isContentScript(t))) {
        const record = findFlightProject(texts.join('\n'), page.projectId);
        if (record) return typeof record.isProjectOwner === 'boolean' ? record.isProjectOwner : null;
      }
      return toBool(collectGlobals(texts).PROJECT_PAGE_IS_THIS_COMPANY_OWNER);
    }
    return null;
  }

  /** Everything the invitation may know before a click: URL kind, session facts, ownership flag. */
  function describeContext(doc, href) {
    const page = parsePage(href);
    if (!page) return null;
    const texts = inlineScriptText(doc);
    let session = parseSessionFacts(texts);
    if (page.kind === 'project' && !session.hasGlobals) session = sessionFromFlight(texts, page.projectId);
    let ownerSignal = readOwnership(page, texts);
    let isOwn = ownerSignal === true;
    if (page.kind === 'profile') {
      const slugKnown = Boolean(session.ownSlug);
      const slugMatches = slugKnown && session.ownSlug.toLowerCase() === page.slug.toLowerCase();
      // A true flag next to a different known own slug is not "own"; with the flag unknown the slug decides.
      if (ownerSignal === true) isOwn = !slugKnown || slugMatches;
      else if (ownerSignal === null) isOwn = slugMatches;
    }
    let variant = 'freelancer';
    if (page.kind === 'project' && isOwn) variant = 'own-project';
    else if (session.accountType === 'publisher') variant = 'publisher';
    return { page, session, ownerSignal, isOwn, variant, href: String(href) };
  }

  FPX.pages = { parsePage, parseSessionFacts, readOwnership, describeContext, inlineScriptText, flightText, balancedObject, findFlightProject, findFlightContext, sessionFromFlight, PROFILE_SLUG, PROJECT_ID };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.pages;
})(globalThis);
