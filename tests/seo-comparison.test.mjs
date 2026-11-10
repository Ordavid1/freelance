import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

// The XPlace comparison is built from dated, sourced data (src/lib/seo/comparison.ts) and the
// membership facts. These tests pin the properties that keep it honest: every number has a source and a
// date, a claim disappears when its data stops supporting it, and nothing is claimed without a number.

const ORIGIN = 'https://freelance-place.com';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN };
const billingOn = { ...env, BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '1', CARDCOM_API_NAME: 'x' };
const plain = (value) => JSON.parse(JSON.stringify(value));
// A fresh module per call, so a test can change the data without touching any other test.
const fresh = () => loadModule('src/lib/seo/comparison.ts', { env });
const comparison = fresh();
const factsModule = loadModule('src/lib/seo/facts.ts', { env });
const factsOn = factsModule.membershipFacts(billingOn);
const factsOff = factsModule.membershipFacts(env);
const withPrice = (facts, priceIls) => ({ ...facts, priceIls, priceLabel: `₪${priceIls.toFixed(2)}` });
const everyText = (facts, module = comparison) => {
  const texts = [
    module.homeComparisonAnswer(facts), module.homeTeaser(facts), module.comparisonLead(facts), module.speedWeightNote(), module.speedMethod(),
    ...module.comparisonRows(facts).flatMap((row) => [row.label, row.freelancePlace, row.xplace]),
    ...module.speedRows().flatMap((row) => [row.label, row.freelancePlace, row.xplace]),
    ...module.comparisonQuestions(facts).map((item) => item.answer),
    ...module.llmsComparisonLines(facts),
  ];
  assert.ok(texts.every((text) => typeof text === 'string'));
  return texts;
};

test('the savings are computed from the price facts and XPlace prices, not typed', () => {
  const { XPLACE } = comparison;
  const derived = comparison.derive(factsOn);
  assert.equal(derived.monthlySaving, Math.round((1 - factsOn.priceIls / XPLACE.plans.monthly.perMonth) * 100));
  assert.equal(derived.annualSaving, Math.round((1 - factsOn.priceIls / XPLACE.plans.annual.perMonth) * 100));
  assert.equal(derived.monthlySaving, 80);
  assert.equal(derived.annualSaving, 71);
  const answer = comparison.homeComparisonAnswer(factsOn);
  assert.match(answer, /כ־80% פחות מהמסלול החודשי של XPlace \(₪99 לפני מע״מ\)/);
  assert.match(answer, /כ־71% פחות מהמסלול השנתי שלה \(₪69 לחודש, ₪828 בתשלום אחד מראש\)/);
  // Another price flows straight through to the sentence.
  const cheaper = comparison.homeComparisonAnswer(withPrice(factsOn, 9.99));
  assert.match(cheaper, /₪9\.99 לחודש/);
  assert.match(cheaper, /כ־90% פחות/);
  assert.doesNotMatch(cheaper, /19\.99/);
  // Without an available paid offer there is no price comparison at all.
  assert.equal(comparison.derive(factsOff).monthlySaving, undefined);
});

test('the home answer leads with the verdict, names every verified aspect and stays short', () => {
  const answer = comparison.homeComparisonAnswer(factsOn);
  assert.match(answer, /^בעלות, בגמישות ובמהירות, ואפשר לבדוק כל מספר\./);
  assert.match(answer, /60 ימי ניסיון להגשת הצעות, בלי כרטיס אשראי/);
  assert.match(answer, /כ־0\.3 MB ומקבל 89–95 בבדיקת Google Lighthouse במובייל, לעומת כ־20 MB ו־50–52 ב־XPlace/);
  assert.match(answer, /ציון הנגישות שלו 100 לעומת 93/);
  assert.match(answer, /לא שולח בקשות לצדדים שלישיים, לעומת 65 ב־XPlace/);
  assert.match(answer, /המחירים והמדידה מ־10 בנובמבר 2026; המקורות בעמוד ההשוואה\.$/);
  assert.ok(answer.length <= 700, `answer length ${answer.length}`);
  assert.equal(comparison.homeComparisonQuestion(factsOn).question, 'במה Freelance Place טוב יותר מ־XPlace.com?');
  assert.equal(comparison.homeComparisonQuestion(factsOn).answer, answer);
  const off = comparison.homeComparisonAnswer(factsOff);
  assert.match(off, /^במהירות, ואפשר לבדוק כל מספר\./, 'without a paid offer only the measured aspects are named');
  assert.match(off, /התשלום עדיין אינו זמין ולא מופעל חיוב\./);
  assert.doesNotMatch(off, /₪|פחות מהמסלול/, 'no price comparison while payment is unavailable');
  assert.match(off, /המדידה מ־10 בנובמבר 2026/);
});

test('a claim disappears when its price data stops supporting it', () => {
  // Priced above XPlace's monthly plan: no price claim, no "cost" aspect.
  const dear = comparison.homeComparisonAnswer(withPrice(factsOn, 120));
  assert.doesNotMatch(dear, /%|בעלות|בגמישות|פחות מהמסלול/);
  assert.match(dear, /^במהירות, ואפשר לבדוק כל מספר\./);
  assert.equal(comparison.homeTeaser(withPrice(factsOn, 120)).includes('₪99'), false);
  assert.equal(comparison.comparisonLead(withPrice(factsOn, 120)).includes('פחות ממסלול'), false);
  // Between XPlace's monthly and annual per-month price: cheaper than the monthly plan only, so no "flexibility" and no annual comparison.
  const middle = comparison.homeComparisonAnswer(withPrice(factsOn, 80));
  assert.match(middle, /כ־19% פחות מהמסלול החודשי/);
  assert.doesNotMatch(middle, /השנתי|בגמישות/);
  assert.match(middle, /^בעלות ובמהירות, ואפשר לבדוק כל מספר\./);
  // XPlace changes its prices: the sentences follow the new numbers.
  const changed = fresh();
  changed.XPLACE.plans.monthly.perMonth = 29;
  changed.XPLACE.plans.annual.perMonth = 25;
  const answer = changed.homeComparisonAnswer(factsOn);
  assert.match(answer, /₪29 לפני מע״מ/);
  assert.match(answer, /כ־31% פחות מהמסלול החודשי/);
  assert.match(answer, /כ־20% פחות מהמסלול השנתי/);
  changed.XPLACE.plans.monthly.perMonth = 15;
  changed.XPLACE.plans.annual.perMonth = 12;
  const gone = changed.homeComparisonAnswer(factsOn);
  assert.doesNotMatch(gone, /בעלות|בגמישות|פחות מהמסלול/);
  assert.equal(changed.llmsComparisonLines(factsOn).some((line) => /ILS \d+ per month/.test(line)), false);
});

test('a claim disappears when the measurement stops supporting it, and with no data left the answer claims no edge', () => {
  const slow = fresh();
  slow.SPEED_TEST.freelancePlace.mobileScore = [48, 55];
  assert.equal(slow.derive(factsOn).faster, false, 'overlapping score ranges are not an advantage');
  const noSpeed = slow.homeComparisonAnswer(factsOn);
  assert.doesNotMatch(noSpeed, /Lighthouse במובייל|במהירות/);
  assert.match(noSpeed, /^בעלות ובגמישות, ואפשר לבדוק כל מספר\./);
  assert.equal(slow.llmsComparisonLines(factsOn).some((line) => /Speed/.test(line)), false);
  assert.doesNotMatch(slow.comparisonLead(factsOn), /נטען מהר יותר/);
  assert.doesNotMatch(slow.comparisonQuestions(factsOn)[0].answer, /אתר מהיר|Lighthouse/);

  const heavy = fresh();
  heavy.SPEED_TEST.freelancePlace.kilobytes = 30_000;
  assert.equal(heavy.derive(factsOn).faster, false, 'a lighter score with a heavier page is not claimed as faster');

  const tracking = fresh();
  tracking.SPEED_TEST.freelancePlace.thirdPartyRequests = 70;
  assert.equal(tracking.derive(factsOn).cleaner, false);
  assert.doesNotMatch(tracking.homeComparisonAnswer(factsOn), /ציון הנגישות|צדדים שלישיים/);
  assert.equal(tracking.llmsComparisonLines(factsOn).some((line) => /accessibility/.test(line)), false);

  // Nothing measurable left: the answer says so instead of inventing an edge.
  const none = fresh();
  none.XPLACE.plans.monthly.perMonth = 15;
  none.XPLACE.plans.annual.perMonth = 12;
  none.SPEED_TEST.freelancePlace.mobileScore = [10, 20];
  none.SPEED_TEST.freelancePlace.accessibility = 50;
  const quiet = none.homeComparisonAnswer(factsOn);
  assert.match(quiet, /^הנתונים שנבדקו אינם מראים כרגע יתרון מדיד, ולכן איננו טוענים לכזה\./);
  assert.doesNotMatch(quiet, /undefined|NaN|%|המחירים והמדידה/);
  assert.doesNotMatch(quiet, /בעלות|בגמישות|במהירות/);
  for (const text of everyText(factsOn, none)) assert.doesNotMatch(text, /undefined|NaN/);
  const best = none.comparisonQuestions(factsOn)[0].answer;
  assert.doesNotMatch(best, /מחיר נמוך|גמישות|אתר מהיר|Lighthouse|undefined/);
  assert.match(best, /התחילו בניסיון והשוו בעצמכם\./, 'an available paid offer is not described as unavailable');
});

test('every number has a source and a date: prices, totals and the measurement are internally consistent', () => {
  const { XPLACE, SPEED_TEST } = comparison;
  for (const date of [XPLACE.checked, SPEED_TEST.checked]) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(Date.parse(`${date}T00:00:00Z`)), date);
  }
  assert.ok(Object.keys(XPLACE.sources).length >= 3);
  for (const source of Object.values(XPLACE.sources)) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:', source.url);
    assert.match(url.hostname, /(^|\.)xplace\.com$/, source.url);
    assert.ok(source.label.length > 0);
  }
  const plans = Object.values(XPLACE.plans);
  for (const plan of plans) assert.equal(plan.total, plan.perMonth * plan.months, `${plan.months}-month plan total`);
  assert.deepEqual(plan3(XPLACE).map((plan) => plan.months), [1, 3, 12]);
  assert.ok(XPLACE.plans.monthly.perMonth > XPLACE.plans.quarterly.perMonth && XPLACE.plans.quarterly.perMonth > XPLACE.plans.annual.perMonth, 'longer plans cost less per month');
  for (const side of [SPEED_TEST.freelancePlace, SPEED_TEST.xplace]) {
    assert.ok(side.mobileScore[0] <= side.mobileScore[1] && side.desktopScore[0] <= side.desktopScore[1]);
    for (const score of [...side.mobileScore, ...side.desktopScore, side.accessibility, side.bestPractices]) assert.ok(score >= 0 && score <= 100);
    assert.ok(side.requests > 0 && side.kilobytes > 0 && side.lcpSeconds > 0);
  }
  assert.ok(SPEED_TEST.runs >= 3, 'a single run is not a measurement');
  assert.match(SPEED_TEST.tool, /Lighthouse/);
  const sources = comparison.comparisonSources();
  assert.equal(sources.checked, XPLACE.checked);
  assert.equal(sources.checkedText, '10 בנובמבר 2026');
  assert.deepEqual(plain(sources.links.map((link) => link.url)), Object.values(XPLACE.sources).map((source) => source.url));
});
const plan3 = (xplace) => [xplace.plans.monthly, xplace.plans.quarterly, xplace.plans.annual];

test('no price, total or score is typed into the copy: it all comes from the data module', () => {
  const files = ['src/lib/seo/content.ts', 'src/lib/seo/facts.ts', 'src/lib/seo/llms.ts', 'src/lib/seo/registry.ts', 'src/app/alternatives/xplace/page.tsx', 'src/app/page.tsx'];
  for (const file of files) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(source, /₪\s?\d|\bILS\s?\d/, `${file} hard-codes a price`);
    assert.doesNotMatch(source, /\b(?:99|89|69|267|828)\b/, `${file} hard-codes an XPlace figure`);
    assert.doesNotMatch(source, /\b\d{1,3}%/, `${file} hard-codes a percentage`);
    assert.doesNotMatch(source, /Lighthouse|MB\b/, `${file} hard-codes a measurement`);
  }
});

// Words that promise more than a measurement can show. The comparison states numbers, never superlatives.
// JavaScript's \b ignores Hebrew letters, so whole Hebrew words are matched with explicit lookarounds.
const word = (text) => new RegExp(`(?<![\\u0590-\\u05FF])${text}(?![\\u0590-\\u05FF])`);
const BANNED = [
  [/הכי טוב/, 'אנחנו הכי טובים'], [/מס׳ 1/, 'האתר מס׳ 1'], [/מספר 1/, 'אתר מספר 1'], [/מוביל/, 'האתר המוביל'], [/מובטח/, 'חיסכון מובטח'], [/מבטיחים/, 'אנחנו מבטיחים'],
  [/100%/, 'חיסכון של 100%'], [/ללא סיכון/, 'ללא סיכון'], [/אחריות מלאה/, 'אחריות מלאה'], [word('כולם'), 'כולם בוחרים בנו'], [word('תמיד'), 'תמיד זול יותר'],
  [/הזול ביותר/, 'המחיר הזול ביותר'], [/היחיד/, 'האתר היחיד'], [/בלעדי/, 'יתרון בלעדי'], [/הטוב ביותר ל/, 'הטוב ביותר לפרילנסרים'],
  [/\bbest\b/i, 'the best site'], [/guarantee/i, 'we guarantee'], [/number one/i, 'number one'], [/\bleading\b/i, 'the leading site'], [/cheapest/i, 'the cheapest'],
];

test('the banned-wording list really matches the phrases it names', () => {
  for (const [pattern, sample] of BANNED) assert.match(sample, pattern, String(pattern));
});

test('no superlative, guarantee or absolute wording in any generated comparison text, in either billing state', () => {
  for (const facts of [factsOn, factsOff, withPrice(factsOn, 120), withPrice(factsOn, 80)]) {
    for (const text of everyText(facts)) {
      for (const [banned] of BANNED) assert.doesNotMatch(text, banned, `${banned} in: ${text.slice(0, 90)}`);
    }
  }
  // The questions people search for may contain "best"; their answers still state numbers only.
  assert.equal(comparison.comparisonQuestions(factsOn)[0].question, 'מהי האלטרנטיבה הטובה ביותר ל־XPlace.com?');
});

test('no comparison text states a feature or a result that was not verified', () => {
  for (const facts of [factsOn, factsOff]) {
    const text = everyText(facts).join('\n');
    assert.doesNotMatch(text, /יותר פרויקטים|יותר לקוחות|יותר פרילנסרים|יותר הזדמנויות|מאגר גדול|תוצאות טובות יותר|שיעור הצלחה|מתאים יותר|עיצוב יפה|עיצוב טוב|חוויית משתמש טובה/, 'no inventory, matching, outcome or taste claim');
    assert.doesNotMatch(text, /עמלה|ללא עמלות|בלי עמלות|commission/i, 'commission is not a differentiator: neither site takes one');
    assert.match(text, /מחוץ לאתר|מחוץ למערכת/, 'payment outside the platform is stated as shared');
    assert.match(text, /נאמנות \(escrow\)/, 'no escrow is stated');
  }
});

test('the comparison page renders both tables with the date, the method and every source, in both billing states', () => {
  const stubs = { 'next/image': { __esModule: true, default: () => null }, 'next/link': { __esModule: true, default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children) } };
  const render = (variant) => renderToStaticMarkup(loadModule('src/app/alternatives/xplace/page.tsx', { env: variant, stubs }).default());
  const on = render(billingOn);
  const off = render(env);
  for (const html of [on, off]) {
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.equal((html.match(/<table>/g) ?? []).length, 2, 'the offer table and the speed table');
    assert.equal((html.match(/<caption>/g) ?? []).length, 2, 'every table has a caption');
    assert.ok(html.includes('<time dateTime="2026-11-10">10 בנובמבר 2026</time>'), 'the check date is machine readable');
    for (const url of Object.values(comparison.XPLACE.sources).map((source) => source.url)) assert.ok(html.includes(`href="${url}"`), url);
    assert.ok(html.includes('Google Lighthouse 12.8.2'), 'the method names its tool');
    assert.ok(html.includes('89–95') && html.includes('50–52'));
    assert.ok(html.includes('PageSpeed Insights'), 'the visitor can repeat the test');
    assert.match(html, /נתון לא מעודכן\? כתבו אל/, 'a way to report a stale number');
    assert.match(html, /אינו קשור ל־XPlace/, 'the independence statement');
    assert.doesNotMatch(html, /סוכן AI|AI agent|פרויקט הדגמה/);
    // Structured data: breadcrumb, FAQ and a WebPage that cites the XPlace pages it relies on.
    const nodes = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
    const types = nodes.map((node) => node['@type']).sort();
    assert.deepEqual(types, ['BreadcrumbList', 'FAQPage', 'WebPage']);
    assert.deepEqual(plain(nodes.find((node) => node['@type'] === 'WebPage').citation), Object.values(comparison.XPLACE.sources).map((source) => source.url));
    const faq = nodes.find((node) => node['@type'] === 'FAQPage');
    assert.equal(faq.mainEntity.length, 6);
  }
  assert.ok(on.includes('₪19.99 לחודש כולל מע״מ ככל שחל') && on.includes('כ־80% פחות'), 'billing available: the price comparison is stated');
  assert.ok(on.includes('₪99 לחודש במסלול חודשי'));
  assert.equal(off.includes('פחות ממסלול'), false, 'billing unavailable: no saving is claimed');
  assert.ok(off.includes('מחיר מתוכנן: ₪19.99 לחודש. התשלום עדיין אינו זמין ולא מופעל חיוב.'));
});

test('the home page teases the comparison from the same data and links to it', () => {
  const page = readFileSync(`${projectRoot}/src/app/page.tsx`, 'utf8');
  assert.match(page, /homeTeaser\(/);
  assert.match(page, /href="\/alternatives\/xplace"/);
  const teaser = comparison.homeTeaser(factsOn);
  assert.match(teaser, /60 ימי ניסיון בלי כרטיס אשראי, ואחר כך ₪19\.99 לחודש כולל מע״מ ככל שחל, במקום ₪99 לחודש לפני מע״מ ב־XPlace\./);
  assert.doesNotMatch(comparison.homeTeaser(factsOff), /₪/);
});
