import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-ts.mjs';
import { loadPolicy } from './helpers/policy.mjs';
import { createFakeFirestore } from './helpers/fake-firestore.mjs';

const ORIGIN = 'https://freelance-place.com';
const PUSH_EMAIL = 'budget-push@project.iam.gserviceaccount.com';

function fixture({ env = {}, payload = { email: PUSH_EMAIL, email_verified: true }, seed = {}, failing = false } = {}) {
  const db = createFakeFirestore(seed);
  if (failing) db.runTransaction = () => Promise.reject(new Error('firestore down'));
  const allEnv = { NEXT_PUBLIC_SITE_URL: ORIGIN, BUDGET_ALERT_PUSH_EMAIL: PUSH_EMAIL, ...env };
  const audiences = [];
  const policy = loadPolicy({
    '@/lib/auth/session': { getCurrentUser: async () => null, isSameOrigin: () => false, publicAppOrigin: () => ORIGIN },
    'google-auth-library': { OAuth2Client: class { async verifyIdToken(options) {
      audiences.push(options.audience);
      if (payload instanceof Error) throw payload;
      return { getPayload: () => payload };
    } } },
  }, allEnv);
  const switches = loadModule('src/lib/security/runtime-switch.ts', { env: allEnv, stubs: {
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'now' } },
    '@/lib/db/firestore': { firestore: () => db },
  } });
  const logs = [];
  const route = loadModule('src/app/api/maintenance/budget/route.ts', { env: allEnv, stubs: {
    '@/lib/security/policy': policy,
    '@/lib/security/runtime-switch': switches,
  }, globals: { console: { warn: v => logs.push(String(v)), error: v => logs.push(String(v)), log: () => {} } } });
  return { route, db, switches, logs, audiences };
}
const envelope = alert => ({ message: { data: Buffer.from(JSON.stringify(alert)).toString('base64'), messageId: '1' }, subscription: 'projects/p/subscriptions/s' });
const push = (body, headers = { authorization: 'Bearer token' }) => new Request(`${ORIGIN}/api/maintenance/budget`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('only the Pub/Sub push service account can call it, with the endpoint as the audience', async () => {
  const ok = fixture();
  assert.equal((await ok.route.POST(push(envelope({ alertThresholdExceeded: 0.5 })))).status, 200);
  assert.equal(ok.audiences.length, 1);
  assert.equal(ok.audiences[0], `${ORIGIN}/api/maintenance/budget`);
  assert.equal((await ok.route.POST(push(envelope({}), {}))).status, 401, 'no bearer token');
  for (const payload of [{ email: 'attacker@x.com', email_verified: true }, { email: PUSH_EMAIL, email_verified: false }, null, new Error('bad token')]) {
    const bad = fixture({ payload });
    const response = await bad.route.POST(push(envelope({ alertThresholdExceeded: 1 })));
    assert.equal(response.status, 401);
    assert.equal(bad.db.docs('runtimeSwitches').ai, undefined, 'nothing is switched off by an unauthenticated call');
  }
});

test('without BUDGET_ALERT_PUSH_EMAIL the endpoint is unavailable rather than open', async () => {
  const { route, db } = fixture({ env: { BUDGET_ALERT_PUSH_EMAIL: '' } });
  const response = await route.POST(push(envelope({ alertThresholdExceeded: 1 })));
  assert.ok(response.status === 503 || response.status === 401);
  assert.equal(db.docs('runtimeSwitches').ai, undefined);
});

test('below the cut-off nothing changes; routine spend updates carry no threshold', async () => {
  const { route, db } = fixture();
  for (const alert of [{ alertThresholdExceeded: 0.5 }, { alertThresholdExceeded: 0.9 }, { costAmount: 10, budgetAmount: 100 }]) {
    const response = await route.POST(push(envelope(alert)));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).action, 'none');
  }
  assert.equal(db.docs('runtimeSwitches').ai, undefined);
});

test('crossing 100% switches AI off, audits it once and logs a structured critical line', async () => {
  const { route, db, switches, logs } = fixture();
  const response = await route.POST(push(envelope({ alertThresholdExceeded: 1, budgetDisplayName: 'Monthly' })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.action, 'ai_disabled');
  assert.equal(body.changed, true);
  const stored = db.docs('runtimeSwitches').ai;
  assert.equal(stored.enabled, false);
  assert.equal(stored.reason, 'budget');
  assert.equal(stored.threshold, 1);
  assert.equal(Object.keys(db.docs('securityAuditEvents')).length, 1);
  assert.ok(logs.some(line => line.startsWith('{') && JSON.parse(line).event === 'budget_kill_switch' && JSON.parse(line).severity === 'CRITICAL'));
  assert.equal(await switches.featureEnabled('ai'), false);
  // Pub/Sub redelivers and Billing repeats notifications: no second write, no second audit event.
  const again = await (await route.POST(push(envelope({ alertThresholdExceeded: 1.2 })))).json();
  assert.equal(again.changed, false);
  assert.equal(Object.keys(db.docs('securityAuditEvents')).length, 1);
});

test('BUDGET_AI_CUTOFF moves the cut-off; invalid values keep the default of 1.0', async () => {
  const early = fixture({ env: { BUDGET_AI_CUTOFF: '0.9' } });
  assert.equal((await (await early.route.POST(push(envelope({ alertThresholdExceeded: 0.9 })))).json()).action, 'ai_disabled');
  for (const bad of ['0', '-1', 'x']) {
    const f = fixture({ env: { BUDGET_AI_CUTOFF: bad } });
    assert.equal((await (await f.route.POST(push(envelope({ alertThresholdExceeded: 0.9 })))).json()).action, 'none', bad);
    assert.equal((await (await f.route.POST(push(envelope({ alertThresholdExceeded: 1 })))).json()).action, 'ai_disabled', bad);
  }
});

test('a notification that can never be parsed is acknowledged, not redelivered forever', async () => {
  const { route, db } = fixture();
  for (const body of [{}, { message: {} }, { message: { data: '!!!' } }, { message: { data: Buffer.from('[1]').toString('base64') } }, { message: { data: Buffer.from('not json').toString('base64') } }]) {
    const response = await route.POST(push(body));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ignored, true);
  }
  assert.equal(db.docs('runtimeSwitches').ai, undefined);
});

test('a failed switch write is a retryable 503, never a silent success', async () => {
  const { route } = fixture({ failing: true });
  const response = await route.POST(push(envelope({ alertThresholdExceeded: 1 })));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'SWITCH_UNAVAILABLE');
});

test('the budget alert parser reads only what it needs', () => {
  const { parseBudgetAlert, exceedsAiCutoff } = loadModule('src/lib/security/budget-alert.ts');
  const parsed = parseBudgetAlert(envelope({ alertThresholdExceeded: 0.9, budgetDisplayName: 'x'.repeat(500), costAmount: 1 }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.alert.threshold, 0.9);
  assert.equal(parsed.alert.budgetName.length, 100);
  assert.equal(exceedsAiCutoff({ budgetName: '', threshold: null }), false);
  assert.equal(exceedsAiCutoff({ budgetName: '', threshold: 1 }), true);
  assert.equal(parseBudgetAlert(envelope({ alertThresholdExceeded: 'high' })).alert.threshold, null);
});
