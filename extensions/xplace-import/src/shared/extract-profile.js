// Profile capture from the real XPlace DOM (plan 9.2). Strict allowlist: only the blocks named here are ever
// queried. Phone links, rates, reviews, viewers, bids, other social blocks and portfolio images are never read.
(function (root) {
  'use strict';
  const FPX = (root.FPX = root.FPX || {});

  const CAPS = {
    headline: 140, slogan: 140, location: 80, about: 1500,
    languages: 8, languageName: 60, languageLevel: 60,
    expertise: 40, industry: 80, expertiseName: 120, expertiseDescription: 300,
    employment: 15, position: 160, company: 120, period: 40, employmentDescription: 700,
    education: 10, degree: 160, institution: 120, educationDescription: 700,
    sections: 5, entries: 10, entry: 300,
    links: 10, linkUrl: 300, linkTitle: 120, linkDescription: 300,
  };

  const OTHER_SECTIONS = [
    ['courses', '#profile_courses_block'],
    ['volunteering', '#profile_volunteering_block'],
    ['military', '#profile_military_exprs_block'],
    ['patents', '#profile_patent_block'],
    ['articles', '#profile_company_articles_block'],
  ];

  // Anything matching this is skipped even when it sits inside an allowlisted block.
  const NEVER = [
    'a.callme', '.industry_rate', 'script', 'style', 'img', 'svg', 'button', 'input', 'textarea', 'select',
    '#profile_reviews_block', '#profile_github_block', '#profile_stackoverflow_block', '#profile_twitter_block',
    '#profile_codepen_new_block', '[id*="profile_views"]', '[class*="profile_views"]', '[id*="completion"]', '[class*="completion"]',
    '[id^="project_bid_block"]',
  ].join(',');

  const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'SECTION', 'ARTICLE']);

  function clean() { return FPX.clean; }

  /** Text of a node with newlines at block boundaries, skipping never-read parts and `extraSkip`. */
  function readText(node, extraSkip) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.matches(NEVER) || (extraSkip && n.matches(extraSkip))) return;
      if (n.tagName === 'BR') { out += '\n'; return; }
      const block = BLOCK_TAGS.has(n.tagName);
      if (block) out += '\n';
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block) out += '\n';
    };
    walk(node);
    return out;
  }

  function dropAddLinks(text) {
    return text.split('\n').filter((line) => !/^\s*\+\s*הוסף/.test(line)).join('\n');
  }

  function line(node, max, extraSkip) {
    if (!node) return '';
    const text = clean().cleanText(dropAddLinks(readText(node, extraSkip)), max);
    return clean().isUsableText(text) ? text : '';
  }

  function paragraphs(node, max, extraSkip) {
    if (!node) return '';
    const text = clean().cleanText(dropAddLinks(readText(node, extraSkip)), max, { paragraphs: true });
    return clean().isUsableText(text) ? text : '';
  }

  const PHONE = /\+?\d[\d\s\-().]{7,}\d/;

  function readHeader(doc) {
    // Real DOM: #profile_header_name is a span inside the h1; the location is a sibling of the h1.
    const nameEl = doc.querySelector('#profile_header_name');
    const headline = line(nameEl, CAPS.headline);
    const slogan = line(doc.querySelector('#profile_header_slogan') || doc.querySelector('h2.slogan'), CAPS.slogan);
    let location = '';
    const heading = nameEl && (nameEl.closest('h1') || nameEl);
    const container = heading && heading.parentElement;
    if (container) {
      const accept = (node) => {
        const text = line(node, CAPS.location);
        return text && text.length <= CAPS.location && !PHONE.test(text) ? text : '';
      };
      // The real markup has an explicit div.location; there is deliberately no guessing from other siblings.
      const explicit = Array.from(container.children).find((c) => c.tagName === 'DIV' && c.matches('.location'));
      if (explicit) location = accept(explicit);
    }
    return { headline, slogan, location };
  }

  function readAbout(doc) {
    const block = doc.querySelector('#profile_about_block');
    if (!block) return '';
    let text = '';
    for (let c = block.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.matches('div.title')) continue;
      text += c.nodeType === 3 ? c.nodeValue : c.nodeType === 1 ? readText(c) : '';
      if (c.nodeType === 1) text += '\n';
    }
    return cleanRaw(text, CAPS.about);
  }

  function cleanRaw(text, max) {
    const t = clean().cleanText(dropAddLinks(text), max, { paragraphs: true });
    return clean().isUsableText(t) ? t : '';
  }

  function readLanguages(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('#profile_languages_block div.inner.languages')) {
      const name = line(el.querySelector('div.name'), CAPS.languageName);
      if (!name) continue;
      out.push({ name, level: line(el.querySelector('div.level'), CAPS.languageLevel) });
      if (out.length >= CAPS.languages) break;
    }
    return out;
  }

  function readExpertise(doc) {
    const out = [];
    let industry = '';
    for (const el of doc.querySelectorAll('#profile_company_cats_block div.inner.industry_title span.industry, #profile_company_cats_block div.inner.category_entry')) {
      if (el.tagName === 'SPAN') { industry = line(el, CAPS.industry, '.industry_rate'); continue; }
      const nameEl = Array.from(el.querySelectorAll('span')).find((s) => !s.closest('.status, .industry_rate'));
      const name = line(nameEl, CAPS.expertiseName, '.status, .industry_rate');
      if (!name) continue;
      out.push({ industry, name, description: paragraphs(el.querySelector('div.category_description'), CAPS.expertiseDescription, '.status, .industry_rate') });
      if (out.length >= CAPS.expertise) break;
    }
    return out;
  }

  function readPeriod(entry) {
    // Every text node exactly once (ng-switch nests spans), then tidy spacing around the dash.
    const date = entry.querySelector('div.date');
    if (!date) return '';
    const raw = line(date, 120);
    return clean().cleanText(raw.replace(/\s*-\s*/g, ' - ').replace(/^ - | - $/g, ''), CAPS.period);
  }

  function readBullets(el, max) {
    if (!el) return '';
    const items = Array.from(el.querySelectorAll('li')).map((li) => line(li, max)).filter(Boolean);
    return items.length ? clean().cleanText(items.join('\n'), max, { paragraphs: true }) : paragraphs(el, max);
  }

  function readEmployment(doc) {
    const out = [];
    for (const e of doc.querySelectorAll('#profile_employments_block .employment_entry')) {
      const position = line(e.querySelector('h3.position'), CAPS.position);
      const company = line(e.querySelector('a.company'), CAPS.company);
      const description = readBullets(e.querySelector('div.description'), CAPS.employmentDescription);
      const period = readPeriod(e);
      if (!position && !company && !description) continue;
      out.push({ period, position, company, description });
      if (out.length >= CAPS.employment) break;
    }
    return out;
  }

  function readEducation(doc) {
    const out = [];
    for (const e of doc.querySelectorAll('#profile_educations_block .education_entry')) {
      const degree = line(e.querySelector('h3.degree'), CAPS.degree);
      const institution = line(e.querySelector('span.university'), CAPS.institution);
      const description = readBullets(e.querySelector('div.description'), CAPS.educationDescription);
      const period = readPeriod(e);
      if (!degree && !institution && !description) continue;
      out.push({ period, degree, institution, description });
      if (out.length >= CAPS.education) break;
    }
    return out;
  }

  function readOtherSections(doc) {
    const out = [];
    for (const [section, selector] of OTHER_SECTIONS) {
      const block = doc.querySelector(selector);
      if (!block) continue;
      let items = Array.from(block.querySelectorAll('[id]')).filter((el) => /^profile_[a-z_]+_\d+$/.test(el.id));
      if (!items.length) items = Array.from(block.querySelectorAll('li'));
      if (!items.length) items = Array.from(block.children).filter((el) => !el.matches('div.title'));
      items = items.filter((el) => !items.some((other) => other !== el && other.contains(el)));
      const entries = [];
      for (const el of items) {
        const text = line(el, CAPS.entry, 'div.title');
        if (text) entries.push(text);
        if (entries.length >= CAPS.entries) break;
      }
      if (entries.length) out.push({ section, entries });
      if (out.length >= CAPS.sections) break;
    }
    return out;
  }

  function safeUrl(value, doc) {
    if (!value) return '';
    try {
      const u = new URL(value, (doc.location && doc.location.href) || 'https://www.xplace.com/');
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href.slice(0, CAPS.linkUrl) : '';
    } catch (e) { return ''; }
  }

  function readLinks(doc) {
    const out = [];
    for (const e of doc.querySelectorAll('#profile_links_block .link_entry')) {
      const a = e.querySelector('a.links_url');
      const url = a ? safeUrl(a.getAttribute('href') || a.textContent.trim(), doc) : '';
      if (!url) continue;
      out.push({ url, title: line(e.querySelector('div.links_title'), CAPS.linkTitle), description: paragraphs(e.querySelector('div.links_desc'), CAPS.linkDescription) });
      if (out.length >= CAPS.links) break;
    }
    return out;
  }

  /** True once the two Angular blocks the capture needs have text (or are absent in a tiny profile after the wait). */
  function isProfileRendered(doc) {
    const name = doc.querySelector('#profile_header_name');
    const about = doc.querySelector('#profile_about_block');
    return Boolean(name && line(name, CAPS.headline) && about && readAbout(doc));
  }

  /** XPlaceCapturedProfile from the live document. */
  function extractProfile(doc, options) {
    const o = options || {};
    const header = readHeader(doc);
    return {
      kind: 'profile',
      url: String(o.url || ''),
      ownerSignal: typeof o.ownerSignal === 'boolean' ? o.ownerSignal : null,
      headline: header.headline,
      slogan: header.slogan,
      location: header.location,
      about: readAbout(doc),
      languages: readLanguages(doc),
      expertise: readExpertise(doc),
      employment: readEmployment(doc),
      education: readEducation(doc),
      otherSections: readOtherSections(doc),
      links: readLinks(doc),
    };
  }

  FPX.profile = { extractProfile, isProfileRendered, CAPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = FPX.profile;
})(globalThis);
