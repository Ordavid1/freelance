import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const handoffCss = readFileSync(new URL('../src/components/xplace-handoff.module.css', import.meta.url), 'utf8');
const studioCss = readFileSync(new URL('../src/app/studio.css', import.meta.url), 'utf8');

function rules(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
}

test('hand-off notice buttons stay visible inside the workspace side panel', () => {
  // The notices render inside `.personal`, and studio.css resets every button there. That reset (specificity 0,1,1) beats a
  // single-class rule (0,1,0), which left white button text on a light notice on /projects/new.
  assert.match(studioCss, /\.personal button\{[^}]*background:none/, 'the workspace reset this test guards against has moved; revisit the rule below');
  const buttonRules = rules(handoffCss).filter((rule) => /\.(button|link)\b/.test(rule.selector) && /background\s*:/.test(rule.body));
  assert.ok(buttonRules.length > 0, 'the button background rule is missing');
  for (const rule of buttonRules) {
    for (const selector of rule.selector.split(',')) {
      const classes = selector.match(/\.[A-Za-z_][\w-]*/g) ?? [];
      assert.ok(classes.length >= 2, `"${selector.trim()}" has one class and loses to ".personal button"; scope it under .notice`);
    }
  }
});
