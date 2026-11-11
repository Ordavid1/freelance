// Shape and size validation before anything leaves the content script. Rebuilds the payload from the allowed keys
// only, so unexpected properties can never travel.
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const SECTIONS = ['courses', 'volunteering', 'military', 'patents', 'articles'];

  function plain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function arr(v, n) { return Array.isArray(v) ? v.slice(0, n) : []; }
  function s(v, max, paragraphs) { return FPX.clean.cleanText(v, max, paragraphs ? { paragraphs: true } : undefined); }
  function url(v) {
    try { const u = new URL(String(v)); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 300) : ''; } catch (e) { return ''; }
  }

  function profile(p) {
    return {
      kind: 'profile',
      url: s(p.url, 500),
      ownerSignal: typeof p.ownerSignal === 'boolean' ? p.ownerSignal : null,
      headline: s(p.headline, 140),
      slogan: s(p.slogan, 140),
      location: s(p.location, 80),
      about: s(p.about, 1500, true),
      languages: arr(p.languages, 8).filter(plain).map((x) => ({ name: s(x.name, 60), level: s(x.level, 60) })).filter((x) => x.name),
      expertise: arr(p.expertise, 40).filter(plain).map((x) => ({ industry: s(x.industry, 80), name: s(x.name, 120), description: s(x.description, 300, true) })).filter((x) => x.name),
      employment: arr(p.employment, 15).filter(plain).map((x) => ({ period: s(x.period, 40), position: s(x.position, 160), company: s(x.company, 120), description: s(x.description, 700, true) })).filter((x) => x.position || x.company || x.description),
      education: arr(p.education, 10).filter(plain).map((x) => ({ period: s(x.period, 40), degree: s(x.degree, 160), institution: s(x.institution, 120), description: s(x.description, 700, true) })).filter((x) => x.degree || x.institution || x.description),
      otherSections: arr(p.otherSections, 5).filter((x) => plain(x) && SECTIONS.includes(x.section))
        .map((x) => ({ section: x.section, entries: arr(x.entries, 10).map((e) => s(e, 300)).filter(Boolean) })).filter((x) => x.entries.length),
      links: arr(p.links, 10).filter(plain).map((x) => ({ url: url(x.url), title: s(x.title, 120), description: s(x.description, 300, true) })).filter((x) => x.url),
    };
  }

  function project(p) {
    const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount > 0 && p.amount < 1e12 ? p.amount : null;
    return {
      kind: 'project',
      url: s(p.url, 500),
      ownerSignal: typeof p.ownerSignal === 'boolean' ? p.ownerSignal : null,
      projectId: /^[1-9]\d{3,9}$/.test(String(p.projectId)) ? String(p.projectId) : '',
      title: s(p.title, 200),
      description: s(p.description, 5000, true),
      amount,
      dueDate: typeof p.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p.dueDate : null,
      categories: arr(p.categories, 20).map((c) => s(c, 200)).filter(Boolean),
      publisherName: s(p.publisherName, 200),
    };
  }

  function byteLength(text) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length * 3;
  }

  /** { ok: true, payload } or { ok: false, code: 'invalid' | 'empty' | 'too-large' }. */
  function validateCapturedPayload(input, options) {
    const maxBytes = (options && options.maxBytes) || FPX.config.MAX_PAYLOAD_BYTES;
    if (!plain(input) || (input.kind !== 'profile' && input.kind !== 'project')) return { ok: false, code: 'invalid' };
    const payload = input.kind === 'profile' ? profile(input) : project(input);
    if (!payload.url) return { ok: false, code: 'invalid' };
    if (payload.kind === 'profile') {
      const has = payload.headline || payload.slogan || payload.about || payload.languages.length || payload.expertise.length
        || payload.employment.length || payload.education.length || payload.otherSections.length || payload.links.length;
      if (!has) return { ok: false, code: 'empty' };
    } else if (!payload.projectId || !payload.title || !payload.description) {
      return { ok: false, code: 'empty' };
    }
    if (byteLength(JSON.stringify(payload)) > maxBytes) return { ok: false, code: 'too-large' };
    return { ok: true, payload };
  }

  FPX.payload = { validateCapturedPayload, byteLength };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.payload;
})(globalThis);
