// Project capture: reads only the allowlisted fields of the embedded project JSON (plan 9.1/9.4).
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const CAPS = { title: 200, description: 5000, category: 200, categories: 20, publisher: 200 };
  const MAX_FETCH_CHARS = 4000000;

  function realDate(y, m, d) {
    const date = new Date(Date.UTC(y, m - 1, d));
    return y >= 1990 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  function isoDate(value) {
    const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
    return m && realDate(Number(m[1]), Number(m[2]), Number(m[3])) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  function amountOf(value) {
    const v = typeof value === 'string' && /^\d[\d,]*(\.\d+)?$/.test(value.trim()) ? Number(value.replace(/,/g, '')) : value;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e12 ? v : null;
  }

  function rec(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

  /**
   * Data minimisation: the ONLY place project JSON is read. Allowlist: projectId, isProjectOwner, title,
   * description, amount, projectDueDate, projectCategories[].nameHe|nameEn, companyDto.companyNameHe|companyNameEn.
   * userDto, contact details, logos, bids and expiry dates are never touched.
   */
  function capturedFromRecord(project, url, pageOwnerSignal) {
    const { cleanText, isUsableText } = FPX.clean;
    const title = cleanText(project.title, CAPS.title);
    const description = cleanText(project.description, CAPS.description, { paragraphs: true });
    if (!isUsableText(title) || !isUsableText(description)) return null;
    const categories = [];
    const seen = new Set();
    for (const item of Array.isArray(project.projectCategories) ? project.projectCategories : []) {
      const c = rec(item);
      if (!c) continue;
      const name = cleanText(c.nameHe, CAPS.category) || cleanText(c.nameEn, CAPS.category);
      if (!name || !isUsableText(name) || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      categories.push(name);
      if (categories.length >= CAPS.categories) break;
    }
    const company = rec(project.companyDto);
    const publisherName = company ? (cleanText(company.companyNameHe, CAPS.publisher) || cleanText(company.companyNameEn, CAPS.publisher)) : '';
    const owner = typeof project.isProjectOwner === 'boolean' ? project.isProjectOwner
      : typeof pageOwnerSignal === 'boolean' ? pageOwnerSignal : null;
    return {
      kind: 'project',
      url: String(url || ''),
      ownerSignal: owner,
      projectId: String(project.projectId),
      title,
      description,
      amount: amountOf(project.amount),
      dueDate: isoDate(project.projectDueDate),
      categories,
      publisherName: isUsableText(publisherName) ? publisherName : '',
    };
  }

  /** From the page's own inline scripts (new page format). Null when the project JSON is not there. */
  function extractProjectFromDocument(doc, options) {
    const o = options || {};
    const source = FPX.pages.inlineScriptText(doc).join('\n');
    const record = FPX.pages.findFlightProject(source, o.projectId);
    return record ? capturedFromRecord(record, o.url, o.ownerSignal) : null;
  }

  /** From a fetched HTML response of `/project?id=<id>`. */
  function extractProjectFromHtml(html, options) {
    const o = options || {};
    const record = FPX.pages.findFlightProject(String(html || '').slice(0, MAX_FETCH_CHARS), o.projectId);
    return record ? capturedFromRecord(record, o.url, o.ownerSignal) : null;
  }

  /**
   * Legacy page: exactly ONE same-origin GET at click time. `fetchImpl` is injectable for tests.
   * Returns the captured project or null; throws only on network failure (caller shows "could not read").
   */
  async function fetchLegacyProject(options) {
    const o = options || {};
    const f = o.fetchImpl || root.fetch.bind(root);
    const response = await f(`/project?id=${encodeURIComponent(o.projectId)}`, { credentials: 'same-origin' });
    if (!response || !response.ok) return null;
    return extractProjectFromHtml(await response.text(), o);
  }

  FPX.project = { extractProjectFromDocument, extractProjectFromHtml, fetchLegacyProject, capturedFromRecord, CAPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.project;
})(globalThis);
