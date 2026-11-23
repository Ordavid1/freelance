import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPolicy } from './helpers/policy.mjs';

const ORIGIN = 'https://freelance-place.com';
const user = { uid: 'uid-1', email: 'a@example.com', name: 'A', picture: null };

// A policy adapter whose collaborators record the order in which they were consulted.
function harness({ signedIn = user, sameOrigin = true, accountDenied = null, membershipDenied = null, humanEnabled = false, humanDenied = null,
  actionLimited = null, anonymousLimited = null, budgetLimited = null, moderator = 'mod-1', scheduler, env = { NEXT_PUBLIC_SITE_URL: ORIGIN } } = {}) {
  const order = [];
  const note = (label, value) => async (...args) => { order.push(label); calls[label] = args; return value; };
  const calls = {};
  const policy = loadPolicy({
    '@/lib/auth/session': {
      getCurrentUser: async () => { order.push('auth'); return signedIn; },
      isSameOrigin: () => { order.push('origin'); return sameOrigin; },
      publicAppOrigin: () => ORIGIN,
    },
    '@/lib/security/marketplace-policy': { accountWriteDenied: note('account', accountDenied) },
    '@/lib/membership/access': { requireMarketplaceAccess: note('membership', membershipDenied) },
    '@/lib/security/human-check': {
      humanCheckEnabled: action => { order.push('humanEnabled'); calls.humanEnabled = [action]; return humanEnabled; },
      verifyHumanCheck: note('human', humanDenied),
    },
    '@/lib/security/rate-limit': {
      enforceActionLimit: note('limit', actionLimited), enforceAnonymousLimit: note('anonymous', anonymousLimited), enforceGlobalBudget: note('budget', budgetLimited),
    },
    '@/lib/security/moderator': { moderatorUid: async () => { order.push('moderator'); return moderator; } },
    'google-auth-library': { OAuth2Client: class { async verifyIdToken(options) { order.push('oidc'); calls.oidc = [options]; if (scheduler instanceof Error) throw scheduler; return { getPayload: () => scheduler }; } } },
  }, env);
  return { policy, order, calls };
}
const post = (body = {}, init = {}) => new Request(`${ORIGIN}/api/x`, { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body: JSON.stringify(body), ...init });
const get = (init = {}) => new Request(`${ORIGIN}/api/x`, init);
const handlerSpy = (response = Response.json({ ok: true })) => { const seen = []; return { seen, handler: ctx => { seen.push(ctx); return response; } }; };

test('a request passes every check in the documented order before the handler runs', async () => {
  const { policy, order, calls } = harness({ humanEnabled: true });
  const { seen, handler } = handlerSpy();
  const POST = policy.route('ai.profile', { gate: () => { order.push('gate'); return { ok: true }; }, body: { type: 'json', maxBytes: 1000 } }, handler);
  const response = await POST(post({ a: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(order, ['gate', 'origin', 'auth', 'account', 'humanEnabled', 'human', 'limit', 'budget']);
  assert.deepEqual(calls.limit, ['uid-1', 'ai.profile']);
  assert.deepEqual(calls.budget, ['ai.profile']);
  assert.deepEqual(calls.humanEnabled, ['ai_profile']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].user.uid, 'uid-1');
  assert.equal(seen[0].body.a, 1);
  assert.equal(seen[0].operation, 'ai.profile');
});

test('membership runs between account state and the budgets', async () => {
  const { policy, order } = harness();
  const { handler } = handlerSpy();
  await policy.route('proposal.create', {}, handler)(post());
  assert.deepEqual(order, ['origin', 'auth', 'account', 'membership', 'limit']);
});

test('each stage that refuses stops the request: later stages and the handler never run', async () => {
  const deny = (status, code) => Response.json({ code }, { status });
  const cases = [
    ['origin', { sameOrigin: false }, 403, ['origin']],
    ['unauthenticated', { signedIn: null }, 401, ['origin', 'auth']],
    ['account', { accountDenied: deny(403, 'ACCOUNT_RESTRICTED') }, 403, ['origin', 'auth', 'account']],
    ['membership', { membershipDenied: deny(402, 'MEMBERSHIP_REQUIRED') }, 402, ['origin', 'auth', 'account', 'membership']],
    ['limit', { actionLimited: deny(429, 'RATE_LIMITED') }, 429, ['origin', 'auth', 'account', 'membership', 'limit']],
  ];
  for (const [name, options, status, order] of cases) {
    const h = harness(options);
    const { seen, handler } = handlerSpy();
    const response = await h.policy.route('proposal.create', { body: { type: 'json', maxBytes: 1000 } }, handler)(post());
    assert.equal(response.status, status, name);
    assert.deepEqual(h.order, order, name);
    assert.equal(seen.length, 0, name);
  }
});

test('a human-check failure is returned before any budget is spent', async () => {
  const h = harness({ humanEnabled: true, humanDenied: Response.json({ code: 'HUMAN_CHECK_FAILED' }, { status: 403 }) });
  const { seen, handler } = handlerSpy();
  const response = await h.policy.route('ai.projectBrief', {}, handler)(post());
  assert.equal(response.status, 403);
  assert.equal(h.order.includes('limit') || h.order.includes('budget'), false);
  assert.equal(seen.length, 0);
});

test('the human check is not asked for when no provider is configured', async () => {
  const h = harness({ humanEnabled: false });
  await h.policy.route('ai.projectBrief', {}, handlerSpy().handler)(post());
  assert.deepEqual(h.calls.humanEnabled, ['ai_project_brief']);
  assert.equal(h.order.includes('human'), false);
});

test('an exhausted site-wide budget answers last, after the per-account limit', async () => {
  const h = harness({ budgetLimited: Response.json({ code: 'FEATURE_BUDGET_EXHAUSTED' }, { status: 503 }) });
  const { seen, handler } = handlerSpy();
  const response = await h.policy.route('ai.projectBrief', { body: { type: 'json', maxBytes: 1000 } }, handler)(post());
  assert.equal(response.status, 503);
  assert.deepEqual(h.order.slice(-2), ['limit', 'budget']);
  assert.equal(seen.length, 0);
});

test('operations without a budget never touch the limiter module', async () => {
  const h = harness();
  await h.policy.route('project.close', {}, handlerSpy().handler)(post());
  assert.deepEqual(h.order, ['origin', 'auth']);
});

test('GET and HEAD need no same-origin proof; every other method does', async () => {
  const h = harness({ sameOrigin: false });
  const { handler } = handlerSpy();
  const read = h.policy.route('profile.read', {}, handler);
  assert.equal((await read(get())).status, 200);
  assert.equal((await read(get({ method: 'HEAD' }))).status, 200);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await read(new Request(`${ORIGIN}/api/x`, { method }))).status, 403, method);
});

test('denials use the registry bodies the clients already rely on', async () => {
  const unauth = await harness({ signedIn: null }).policy.route('project.create', {}, handlerSpy().handler)(post());
  assert.equal(unauth.status, 401);
  assert.deepEqual(await unauth.json(), { error: 'יש להתחבר כדי לפרסם פרויקט.' });
  const origin = await harness({ sameOrigin: false }).policy.route('billing.checkout', {}, handlerSpy().handler)(post());
  assert.deepEqual(await origin.json(), { error: 'INVALID_ORIGIN' });
  const billingUnauth = await harness({ signedIn: null }).policy.route('billing.status', {}, handlerSpy().handler)(get());
  assert.deepEqual(await billingUnauth.json(), { error: 'SIGN_IN_REQUIRED' });
  const defaultOrigin = await harness({ sameOrigin: false }).policy.route('project.create', {}, handlerSpy().handler)(post());
  assert.deepEqual(await defaultOrigin.json(), { error: 'הבקשה נדחתה.' });
  assert.equal(defaultOrigin.headers.get('cache-control'), 'no-store');
});

test('bodies are read with a hard byte cap, after the checks, in three shapes', async () => {
  const h = harness();
  const json = handlerSpy();
  assert.equal((await h.policy.route('project.create', { body: { type: 'json', maxBytes: 20 } }, json.handler)(post({ a: 'x'.repeat(50) }))).status, 413);
  assert.equal(json.seen.length, 0);
  const understated = new Request(`${ORIGIN}/api/x`, { method: 'POST', body: 'x'.repeat(100), headers: { 'content-length': '5' } });
  assert.equal((await h.policy.route('project.create', { body: { type: 'raw', maxBytes: 20 } }, json.handler)(understated)).status, 413, 'an understated Content-Length does not widen the cap');
  assert.equal((await h.policy.route('project.create', { body: { type: 'json', maxBytes: 1000 } }, json.handler)(new Request(`${ORIGIN}/api/x`, { method: 'POST', body: '{broken' }))).status, 400);
  assert.equal((await h.policy.route('project.create', { body: { type: 'json', maxBytes: 1000 } }, json.handler)(new Request(`${ORIGIN}/api/x`, { method: 'POST', body: '[1]' }))).status, 400);

  const form = handlerSpy();
  const data = new FormData();
  data.set('name', 'value');
  await h.policy.route('upload.create', { body: { type: 'form', maxBytes: 10_000 } }, form.handler)(new Request(`${ORIGIN}/api/x`, { method: 'POST', body: data }));
  assert.equal(form.seen[0].body.get('name'), 'value');

  const raw = handlerSpy();
  await h.policy.route('support.slack.events', { sameOrigin: false, body: { type: 'raw', maxBytes: 100 } }, raw.handler)(new Request(`${ORIGIN}/api/x`, { method: 'POST', body: 'signed-bytes' }));
  assert.equal(new TextDecoder().decode(raw.seen[0].body), 'signed-bytes');
});

test('an operation can shape its own body errors (billing clients read error codes)', async () => {
  const h = harness();
  const { handler } = handlerSpy();
  const tooLarge = await h.policy.route('billing.checkout', { body: { type: 'json', maxBytes: 5 } }, handler)(post({ big: 'x'.repeat(50) }));
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: 'BODY_TOO_LARGE' });
  const invalid = await h.policy.route('billing.checkout', { body: { type: 'json', maxBytes: 500 } }, handler)(new Request(`${ORIGIN}/api/x`, { method: 'POST', body: 'nope' }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'INVALID_BODY' });
});

test('a signed-in caller of an optional-account operation uses the per-account limit; an anonymous one the per-address limit', async () => {
  const signed = harness();
  await signed.policy.route('support.message', {}, handlerSpy().handler)(post());
  assert.deepEqual(signed.calls.limit, ['uid-1', 'support.message']);
  assert.equal(signed.order.includes('anonymous'), false);

  const anonymous = harness({ signedIn: null });
  const { seen, handler } = handlerSpy();
  const request = post({}, { headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.7, 130.211.0.5' } });
  await anonymous.policy.route('support.message', {}, handler)(request);
  assert.deepEqual(anonymous.calls.anonymous, ['203.0.113.7', 'support.message']);
  assert.equal(anonymous.order.includes('limit'), false);
  assert.equal(seen[0].user, null);
  assert.equal(seen[0].ip, '203.0.113.7', 'the spoofed prefix is not the client');
});

test('an exhausted anonymous budget stops the request before the handler', async () => {
  const h = harness({ signedIn: null, anonymousLimited: Response.json({ code: 'RATE_LIMITED' }, { status: 429 }) });
  const { seen, handler } = handlerSpy();
  assert.equal((await h.policy.route('support.message', {}, handler)(post())).status, 429);
  assert.equal(seen.length, 0);
});

test('public operations skip authentication; only they may opt out of the origin check', async () => {
  const h = harness({ signedIn: null, sameOrigin: false });
  const { seen, handler } = handlerSpy();
  const hook = h.policy.route('billing.webhook', { sameOrigin: false }, handler);
  assert.equal((await hook(post())).status, 200);
  assert.equal(seen[0].user, null);
  assert.equal(h.order.includes('auth'), false);
  assert.throws(() => h.policy.route('project.create', { sameOrigin: false }, handler), /only public operations/);
  assert.throws(() => h.policy.route('moderation.account.queue', { sameOrigin: false }, handler), /only public operations/);
  assert.throws(() => h.policy.route('billing.renew', { sameOrigin: false }, handler), /only public operations/);
  assert.throws(() => h.policy.route('no.such.operation', {}, handler), /Unknown operation/);
});

test('a public operation with the origin check on still refuses a cross-origin mutation', async () => {
  const h = harness({ sameOrigin: false });
  assert.equal((await h.policy.route('auth.session.create', {}, handlerSpy().handler)(post())).status, 403);
});

test('a gate answers before origin and authentication, and hands its value to the handler', async () => {
  const h = harness({ sameOrigin: false, signedIn: null });
  const closed = h.policy.route('headhunter.read', { gate: () => ({ ok: false, response: Response.json({ error: 'NOT_FOUND' }, { status: 404 }) }) }, handlerSpy().handler);
  assert.equal((await closed(post())).status, 404);
  assert.deepEqual(h.order, []);
  const open = harness();
  const { seen, handler } = handlerSpy();
  await open.policy.route('headhunter.read', { gate: async () => ({ ok: true, config: { applicationsOpen: true } }) }, handler)(get());
  assert.equal(seen[0].gate.config.applicationsOpen, true);
});

test('onUnauthenticated replaces the JSON 401 for browser navigations', async () => {
  const h = harness({ signedIn: null });
  const route = h.policy.route('dribbble.connect', { onUnauthenticated: request => Response.redirect(`${new URL(request.url).origin}/signin`, 302) }, handlerSpy().handler);
  const response = await route(get());
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `${ORIGIN}/signin`);
});

test('moderator operations need a moderator session and receive its uid', async () => {
  const denied = harness({ moderator: null });
  const response = await denied.policy.route('moderation.headhunter.queue', {}, handlerSpy().handler)(get());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'RECENT_MFA_MODERATOR_REQUIRED' });
  const allowed = harness();
  const { seen, handler } = handlerSpy();
  await allowed.policy.route('moderation.headhunter.queue', {}, handler)(get());
  assert.equal(seen[0].user.uid, 'mod-1');
  const crossOrigin = await harness({ sameOrigin: false }).policy.route('moderation.headhunter.decide', {}, handlerSpy().handler)(post());
  assert.deepEqual(await crossOrigin.json(), { error: 'INVALID_ORIGIN' });
});

test('scheduler operations verify an OIDC token for the expected service account and public audience', async () => {
  const env = { NEXT_PUBLIC_SITE_URL: ORIGIN, MAINTENANCE_SCHEDULER_EMAIL: 'job@project.iam.gserviceaccount.com' };
  const request = () => new Request(`${ORIGIN}/api/maintenance/uploads`, { method: 'POST', headers: { authorization: 'Bearer token-1' } });
  const ok = harness({ env, scheduler: { email: 'job@project.iam.gserviceaccount.com', email_verified: true }, sameOrigin: false });
  const { seen, handler } = handlerSpy();
  assert.equal((await ok.policy.route('maintenance.uploads', {}, handler)(request())).status, 200);
  assert.equal(ok.calls.oidc.length, 1);
  assert.equal(ok.calls.oidc[0].idToken, 'token-1');
  assert.equal(ok.calls.oidc[0].audience, `${ORIGIN}/api/maintenance/uploads`);
  assert.equal(seen.length, 1);
  assert.equal(ok.order.includes('origin'), false, 'a scheduler call has no browser origin');

  for (const payload of [{ email: 'other@x.com', email_verified: true }, { email: 'job@project.iam.gserviceaccount.com', email_verified: false }, undefined, new Error('bad signature')]) {
    const h = harness({ env, scheduler: payload });
    const spy = handlerSpy();
    const response = await h.policy.route('maintenance.uploads', {}, spy.handler)(request());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'UNAUTHORIZED' });
    assert.equal(spy.seen.length, 0);
  }
  const noToken = harness({ env, scheduler: new Error('missing token') });
  const refused = await noToken.policy.route('maintenance.uploads', {}, handlerSpy().handler)(new Request(`${ORIGIN}/api/maintenance/uploads`, { method: 'POST' }));
  assert.equal(refused.status, 401);
  assert.equal(noToken.calls.oidc, undefined, 'a call without a bearer token is refused before any verification');
});

test('a scheduler operation without its configured service account is unavailable, with the operation\'s own body', async () => {
  const uploads = harness({ env: { NEXT_PUBLIC_SITE_URL: ORIGIN } });
  const spy = handlerSpy();
  const response = await uploads.policy.route('maintenance.uploads', {}, spy.handler)(new Request(`${ORIGIN}/x`, { method: 'POST' }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'MAINTENANCE_NOT_CONFIGURED' });
  assert.equal(uploads.order.includes('oidc'), false);
  const billing = await harness().policy.route('billing.renew', {}, spy.handler)(new Request(`${ORIGIN}/x`, { method: 'POST' }));
  assert.deepEqual(await billing.json(), { error: 'SCHEDULER_UNAVAILABLE' });
  const generic = await harness().policy.route('notifications.dispatch', {}, spy.handler)(new Request(`${ORIGIN}/x`, { method: 'POST' }));
  assert.deepEqual(await generic.json(), { error: 'NOT_CONFIGURED' });
  assert.equal(spy.seen.length, 0);
});

test('deferred budgets are spent only when the handler asks, and only once', async () => {
  const h = harness();
  const route = h.policy.route('import.xplace.project', { deferBudgets: true }, async ({ charge }) => {
    const first = await charge();
    const second = await charge();
    return Response.json({ first: first === null, second: second === null });
  });
  const response = await route(post());
  assert.deepEqual(await response.json(), { first: true, second: true });
  assert.deepEqual(h.order.filter(step => step === 'limit' || step === 'budget'), ['limit', 'budget']);

  const early = harness();
  await early.policy.route('import.xplace.project', { deferBudgets: true }, () => Response.json({ error: 'invalid' }, { status: 400 }))(post());
  assert.equal(early.order.includes('limit') || early.order.includes('budget'), false, 'a request rejected as invalid spends nothing');

  const limited = harness({ actionLimited: Response.json({ code: 'RATE_LIMITED' }, { status: 429 }) });
  const result = await limited.policy.route('import.xplace.project', { deferBudgets: true }, async ({ charge }) => (await charge()) ?? Response.json({ ok: true }))(post());
  assert.equal(result.status, 429);

  const plain = harness();
  await plain.policy.route('project.create', {}, async ({ charge }) => { await charge(); return Response.json({}); })(post());
  assert.equal(plain.order.filter(step => step === 'limit').length, 1, 'without deferral the budgets were spent up front and charge() is a no-op');
});

test('a handler may be called without a request (unit tests call GET() directly)', async () => {
  const h = harness();
  assert.equal((await h.policy.route('profile.read', {}, handlerSpy().handler)()).status, 200);
});
