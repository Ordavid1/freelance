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

  function globalValue(text, name) {
    const re = new RegExp(`\\b${name}\\b\\s*[=:]\\s*(?:'([^'\\n]*)'|"([^"\\n]*)"|([A-Za-z0-9_.-]+))`);
    const m = re.exec(text);
    return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
  }

  function boolGlobal(text, name) {
    const v = globalValue(text, name);
    return v === 'true' ? true : v === 'false' ? false : null;
  }

  /** Session facts from inline scripts: logged in, own slug, account base. Never reads name globals. */
  function parseSessionFacts(scriptTexts) {
    const texts = Array.isArray(scriptTexts) ? scriptTexts : [String(scriptTexts || '')];
    let id = null; let slug = null; let base = null;
    for (const t of texts) {
      if (id === null && t.includes('GLOBAL_JS_THIS_COMPANY_ID')) id = globalValue(t, 'GLOBAL_JS_THIS_COMPANY_ID');
      if (slug === null && t.includes('GLOBAL_JS_THIS_COMPANY_USER_NAME')) slug = globalValue(t, 'GLOBAL_JS_THIS_COMPANY_USER_NAME');
      if (base === null && t.includes('GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE')) base = globalValue(t, 'GLOBAL_JS_THIS_COMPANY_ACC_TYPE_BASE');
    }
    const loggedIn = id !== null && !['', '0', 'null', 'undefined', 'false'].includes(id.trim());
    const ownSlug = loggedIn && slug && PROFILE_SLUG.test(slug.trim()) ? slug.trim() : '';
    const baseValue = base ? base.trim().toUpperCase() : '';
    return {
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

  /** The embedded project JSON whose id equals `projectId`, or null. */
  function findFlightProject(source, projectId) {
    const text = flightText(source);
    const marker = '"project":{';
    for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + marker.length)) {
      const raw = balancedObject(text, at + marker.length - 1);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw);
        if (rec && typeof rec === 'object' && !Array.isArray(rec) && String(rec.projectId) === String(projectId)) return rec;
      } catch (e) { /* try the next occurrence */ }
    }
    return null;
  }

  /** XPlace's own ownership flag for the current page: true, false or null when it cannot be read. */
  function readOwnership(page, scriptTexts) {
    const texts = Array.isArray(scriptTexts) ? scriptTexts : [String(scriptTexts || '')];
    if (page.kind === 'profile') {
      for (const t of texts) { if (t.includes('PROFILE_SPA_CURRENT_USER_OWNER')) { const v = boolGlobal(t, 'PROFILE_SPA_CURRENT_USER_OWNER'); if (v !== null) return v; } }
      return null;
    }
    if (page.kind === 'project') {
      for (const t of texts) { if (t.includes('PROJECT_PAGE_IS_THIS_COMPANY_OWNER')) { const v = boolGlobal(t, 'PROJECT_PAGE_IS_THIS_COMPANY_OWNER'); if (v !== null) return v; } }
      const record = findFlightProject(texts.join('\n'), page.projectId);
      if (record && typeof record.isProjectOwner === 'boolean') return record.isProjectOwner;
      return null;
    }
    return null;
  }

  /** Everything the invitation may know before a click: URL kind, session facts, ownership flag. */
  function describeContext(doc, href) {
    const page = parsePage(href);
    if (!page) return null;
    const texts = inlineScriptText(doc);
    const session = parseSessionFacts(texts);
    let ownerSignal = readOwnership(page, texts);
    let isOwn = ownerSignal === true;
    if (page.kind === 'profile' && ownerSignal === null && session.ownSlug) {
      isOwn = session.ownSlug.toLowerCase() === page.slug.toLowerCase();
    }
    let variant = 'freelancer';
    if (page.kind === 'project' && isOwn) variant = 'own-project';
    else if (session.accountType === 'publisher') variant = 'publisher';
    return { page, session, ownerSignal, isOwn, variant, href: String(href) };
  }

  FPX.pages = { parsePage, parseSessionFacts, readOwnership, describeContext, inlineScriptText, flightText, balancedObject, findFlightProject, PROFILE_SLUG, PROJECT_ID };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.pages;
})(globalThis);
