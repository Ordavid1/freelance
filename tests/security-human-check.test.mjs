import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';

// The module under test calls the global fetch of its vm context, which is bound when the context is created.
let provider = async () => Response.json({});
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return provider(String(url), options); };
test.after(() => { globalThis.fetch = realFetch; });

const baseEnv = { RECAPTCHA_SITE_KEY: 'site-key-1', GOOGLE_CLOUD_PROJECT: 'demo-project', NEXT_PUBLIC_SITE_URL: 'https://freelance-place.com', NODE_ENV: 'production' };
let tokenFails = false;
const load = (env = baseEnv) => loadModule('src/lib/security/human-check.ts', { env, stubs: { 'google-auth-library': { GoogleAuth: class { async getAccessToken() { if (tokenFails) throw new Error('no adc'); return 'adc-token'; } } } } });
const post = (headers = { 'x-human-token': 'tok' }) => new Request('https://freelance-place.com/api/support', { method: 'POST', headers });
const assessment = (patch = {}) => ({ tokenProperties: { valid: true, action: 'support_message', hostname: 'freelance-place.com', ...patch.tokenProperties }, riskAnalysis: { score: 0.9, ...patch.riskAnalysis } });
const answer = (body, status = 200) => { provider = async () => Response.json(body, { status }); calls.length = 0; };
const code = async (response) => (await response.json()).code;

test('disabled unless both RECAPTCHA_SITE_KEY and GOOGLE_CLOUD_PROJECT are set: everything passes and nothing is called', async () => {
  for (const env of [{}, { RECAPTCHA_SITE_KEY: 'k' }, { GOOGLE_CLOUD_PROJECT: 'p' }, { RECAPTCHA_SITE_KEY: '  ', GOOGLE_CLOUD_PROJECT: 'p' }]) {
    const m = load(env);
    calls.length = 0;
    assert.equal(m.humanCheckEnabled('support_message'), false);
    assert.equal(m.humanCheckSiteKey(), '');
    assert.equal(await m.verifyHumanCheck(post({}), 'support_message'), null);
    assert.equal(calls.length, 0);
  }
  assert.equal(load().humanCheckEnabled('ai_profile'), true);
  assert.equal(load().humanCheckSiteKey(), 'site-key-1');
});

test('a good token for the right action, host and score passes; the assessment request follows the REST contract', async () => {
  answer(assessment());
  assert.equal(await load().verifyHumanCheck(post(), 'support_message'), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://recaptchaenterprise.googleapis.com/v1/projects/demo-project/assessments');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer adc-token');
  assert.deepEqual(JSON.parse(calls[0].options.body).event, { token: 'tok', siteKey: 'site-key-1', expectedAction: 'support_message' });
});

test('a missing or oversized token is refused (403) without calling the provider', async () => {
  answer(assessment());
  for (const headers of [{}, { 'x-human-token': '   ' }, { 'x-human-token': 'x'.repeat(8193) }]) {
    const response = await load().verifyHumanCheck(post(headers), 'ai_profile');
    assert.equal(response.status, 403);
    assert.equal(await code(response), 'HUMAN_CHECK_FAILED');
  }
  assert.equal(calls.length, 0);
});

test('an invalid token, a token for another action, another hostname or a low score is refused with 403', async () => {
  const cases = [
    assessment({ tokenProperties: { valid: false } }),
    assessment({ tokenProperties: { action: 'ai_profile' } }),
    assessment({ tokenProperties: { hostname: 'attacker.example' } }),
    assessment({ tokenProperties: { hostname: 'freelance-place.com.attacker.example' } }),
    assessment({ riskAnalysis: { score: 0.1 } }),
    assessment({ riskAnalysis: { score: 0.49 } }),
  ];
  for (const body of cases) {
    answer(body);
    const response = await load().verifyHumanCheck(post(), 'support_message');
    assert.equal(response.status, 403, JSON.stringify(body));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('the score threshold is RECAPTCHA_MIN_SCORE (default 0.5, invalid values fall back) and the hostname is case-insensitive', async () => {
  answer(assessment({ riskAnalysis: { score: 0.5 }, tokenProperties: { hostname: 'Freelance-Place.com' } }));
  assert.equal(await load().verifyHumanCheck(post(), 'support_message'), null);
  answer(assessment({ riskAnalysis: { score: 0.7 } }));
  assert.equal((await load({ ...baseEnv, RECAPTCHA_MIN_SCORE: '0.8' }).verifyHumanCheck(post(), 'support_message')).status, 403);
  assert.equal(await load({ ...baseEnv, RECAPTCHA_MIN_SCORE: '0.6' }).verifyHumanCheck(post(), 'support_message'), null);
  answer(assessment({ riskAnalysis: { score: 0.3 } }));
  assert.equal((await load({ ...baseEnv, RECAPTCHA_MIN_SCORE: 'nonsense' }).verifyHumanCheck(post(), 'support_message')).status, 403);
});

test('provider errors fail closed (503) for the anonymous support chat and fail open, with a warning, for signed-in AI actions', async () => {
  const warn = console.warn; const logged = []; console.warn = (line) => logged.push(line);
  try {
    for (const make of [() => answer({ error: 'boom' }, 500), () => { provider = async () => { throw new Error('network'); }; }, () => answer({ tokenProperties: {} }), () => answer({ tokenProperties: { valid: true } })]) {
      make();
      const support = await load().verifyHumanCheck(post(), 'support_message');
      assert.equal(support.status, 503);
      assert.equal(await code(support), 'HUMAN_CHECK_UNAVAILABLE');
      make();
      assert.equal(await load().verifyHumanCheck(post(), 'ai_profile'), null);
      make();
      assert.equal(await load().verifyHumanCheck(post(), 'ai_project_brief'), null);
    }
    tokenFails = true; answer(assessment());
    assert.equal((await load().verifyHumanCheck(post(), 'support_message')).status, 503);
    assert.equal(await load().verifyHumanCheck(post(), 'ai_profile'), null);
    assert.equal(calls.length, 0, 'no assessment without credentials');
  } finally { console.warn = warn; tokenFails = false; }
  assert.ok(logged.length >= 8);
  assert.match(logged[0], /human_check_provider_error/);
  assert.ok(!logged.join('').includes('tok"'), 'the token is never logged');
});

test('CSP adds the Google-documented reCAPTCHA hosts only when the check is configured', () => {
  const { contentSecurityPolicy } = loadModule('src/lib/security/csp.ts');
  const off = contentSecurityPolicy('abc');
  assert.doesNotMatch(off, /recaptcha/);
  const on = contentSecurityPolicy('abc', false, '', true);
  assert.match(on, /script-src [^;]*'nonce-abc' 'strict-dynamic' https:\/\/www\.google\.com\/recaptcha\/ https:\/\/www\.gstatic\.com\/recaptcha\//);
  assert.match(on, /frame-src [^;]*https:\/\/www\.google\.com\/recaptcha\/ https:\/\/recaptcha\.google\.com\/recaptcha\//);
  assert.match(on, /connect-src [^;]*https:\/\/www\.google\.com\/recaptcha\//);
  assert.match(on, /script-src-attr 'none'/);
});

test('the proxy enables the reCAPTCHA CSP hosts only with both variables set', async () => {
  const { NextRequest, NextResponse } = await import('next/server.js');
  const policyFor = (env) => loadModule('src/proxy.ts', { stubs: { 'next/server': { NextResponse } }, env: { NODE_ENV: 'production', SITE_INDEXABLE: 'true', ...env } })
    .proxy(new NextRequest('https://freelance-place.com/', { headers: { host: 'freelance-place.com' } })).headers.get('content-security-policy');
  assert.doesNotMatch(policyFor({}), /recaptcha/);
  assert.doesNotMatch(policyFor({ RECAPTCHA_SITE_KEY: 'k' }), /recaptcha/);
  assert.match(policyFor({ RECAPTCHA_SITE_KEY: 'k', GOOGLE_CLOUD_PROJECT: 'p' }), /google\.com\/recaptcha/);
});
