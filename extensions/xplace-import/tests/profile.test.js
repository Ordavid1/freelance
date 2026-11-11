'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FPX, dom, fixture } = require('./helpers/load');

function capture(html) {
  const doc = dom(html).window.document;
  return FPX.profile.extractProfile(doc, { url: 'https://www.xplace.com/il/u/dana-design', ownerSignal: true });
}

test('profile extraction follows the DOM map exactly', () => {
  const p = capture(fixture('profile-own.html'));
  assert.equal(p.kind, 'profile');
  assert.equal(p.ownerSignal, true);
  assert.equal(p.headline, 'מעצבת מוצר ו־UX');
  assert.equal(p.slogan, 'עיצוב שעובד');
  assert.equal(p.location, 'חיפה, ישראל');
  assert.equal(p.about, 'אני מעצבת עם 8 שנות ניסיון.\nעבדתי עם סטארטאפים & חברות גדולות.');
  assert.deepEqual(p.languages, [{ name: 'עברית', level: 'שפת אם' }, { name: 'אנגלית', level: 'רמה גבוהה' }]);
  assert.deepEqual(p.expertise, [
    { industry: 'עיצוב', name: 'עיצוב UX, Figma, מחקר משתמשים', description: 'אפיון וניסוי.' },
    { industry: 'עיצוב', name: 'עיצוב אתרים', description: '' },
    { industry: 'שיווק', name: 'ניהול מוצר', description: 'תיאור תחום' },
  ]);
  assert.equal(p.employment.length, 2);
  assert.deepEqual(p.employment[0], { period: 'אוגוסט 2025 - היום', position: 'מעצבת בכירה'.replace('בכירה', 'מוצר בכירה'), company: 'חברת דוגמה', description: 'הובלת מערכת עיצוב\nניהול צוות של 3' });
  assert.equal(p.employment[1].period, 'ינואר 2022 - דצמבר 2024');
  assert.deepEqual(p.education, [{ period: '2018 - 2020', degree: 'תואר ראשון בעיצוב', institution: 'הטכניון', description: 'סיום בהצטיינות' }]);
  assert.deepEqual(p.otherSections, [
    { section: 'courses', entries: ['קורס נגישות'] },
    { section: 'volunteering', entries: ['מנטורית בעמותה'] },
    { section: 'military', entries: ['מדריכה'] },
    { section: 'articles', entries: ['על עיצוב מערכות'] },
  ]);
  assert.deepEqual(p.links, [{ url: 'https://dana.example/portfolio', title: 'תיק עבודות', description: 'עבודות נבחרות' }]);
});

test('canaries inside never-read blocks never reach the payload', () => {
  const p = capture(fixture('profile-own.html'));
  const json = JSON.stringify(p);
  for (const canary of ['CANARY_PHONE', '050-123', 'CANARY_VIEWER', 'CANARY_COMPLETION', 'CANARY_REVIEW', 'CANARY_RATE', 'CANARY_BID', 'CANARY_GITHUB', 'CANARY_SO', 'CANARY_TWITTER', 'CANARY_CODEPEN', 'CANARY_PORTFOLIO', 'מי צפה', 'שלחו הודעה']) {
    assert.ok(!json.includes(canary), `${canary} leaked`);
  }
  // also when the sensitive nodes sit inside an allowlisted block
  const html = fixture('profile-own.html').replace('<div class="text">', '<div class="text"><a class="callme">CANARY_PHONE_INSIDE</a><div class="industry_rate">CANARY_RATE_INSIDE</div>');
  assert.ok(!JSON.stringify(capture(html)).includes('CANARY'));
});

test('unrendered angular templates and empty profiles', () => {
  const p = capture('<h1 id="profile_header_name">{{profile.name}}</h1><div id="profile_about_block"><div class="title">אודות</div></div>');
  assert.equal(p.headline, ''); assert.equal(p.about, '');
  assert.equal(FPX.payload.validateCapturedPayload(p).code, 'empty');
});

test('isProfileRendered waits for header and about text', () => {
  const doc = dom('<h1 id="profile_header_name"></h1><div id="profile_about_block"><div class="title">אודות</div></div>').window.document;
  assert.equal(FPX.profile.isProfileRendered(doc), false);
  doc.querySelector('#profile_header_name').textContent = 'שם';
  assert.equal(FPX.profile.isProfileRendered(doc), false);
  doc.querySelector('#profile_about_block').appendChild(doc.createTextNode('טקסט'));
  assert.equal(FPX.profile.isProfileRendered(doc), true);
});

test('caps and markup stripping', () => {
  const html = fixture('profile-own.html').replace('מעצבת מוצר ו־UX', 'x'.repeat(500) + '<img src=x onerror=alert(1)>');
  const p = capture(html);
  assert.equal(p.headline.length <= 140, true);
  assert.ok(!p.headline.includes('<'));
});

test('regression: location sits beside an h1 that wraps the name span (real DOM)', () => {
  assert.equal(capture(fixture('profile-own.html')).location, 'חיפה, ישראל');
  const bare = '<div class="name"><h1><span id="profile_header_name">שם</span></h1><div class="solo">פרילנסר</div><div>תל אביב, ישראל</div><a class="callme">CANARY_PHONE</a></div>';
  assert.equal(capture(bare).location, '', 'no guessing without div.location');
  const phone = '<div class="name"><h1><span id="profile_header_name">שם</span></h1><div class="location">050-123-4567 0501234567</div></div>';
  assert.equal(capture(phone).location, '');
});

test('regression: period strings read every text node once (ng-switch nesting)', () => {
  const p = capture(fixture('profile-own.html'));
  assert.equal(p.employment[0].period, 'אוגוסט 2025 - היום');
  assert.equal(p.employment[1].period, 'ינואר 2022 - דצמבר 2024');
  assert.equal(p.education[0].period, '2018 - 2020');
});
