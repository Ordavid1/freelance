import { loadModule } from './helpers/load-ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const requireFromHere = createRequire(import.meta.url);

function proposalRoute({ proposals = [], demos = [], projects = {}, user = { uid: 'freelancer-1', name: 'Test Freelancer' } } = {}) {
  const records = { proposals: new Map(proposals.map((record) => [record.id, record.data])), 'demo-proposals': new Map(demos.map((record) => [record.id, record.data])) };
  const collections = new Map();
  const database = {
    collection(name) {
      if (!collections.has(name)) collections.set(name, {
        where(field, _operator, value) {
          let max = Infinity;
          const query = {
            limit(count) { max = count; return query; },
            async get() {
              const docs = [...(records[name] || new Map()).entries()]
                .filter(([, data]) => data[field] === value)
                .slice(0, max)
                .map(([id, data]) => ({ id, data: () => data }));
              return { docs };
            },
          };
          return query;
        },
        doc(id) {
          return {
            async get() {
              const data = projects[id];
              return { exists: Boolean(data), get: (field) => data?.[field] };
            },
            async create(data) {
              if (!records[name]) records[name] = new Map();
              if (records[name].has(id)) throw new Error('already exists');
              records[name].set(id, data);
            },
            async set(data) {
              if (!records[name]) records[name] = new Map();
              records[name].set(id, data);
            },
          };
        },
      });
      return collections.get(name);
    },
  };
  const stubs = {
    '@/lib/security/request-body': loadModule('src/lib/security/request-body.ts'),
    '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 1_000, increment: (amount) => amount } },
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers || {} }) } },
    '@/lib/auth/session': { getCurrentUser: async () => user, isSameOrigin: () => true },
    '@/lib/db/firestore': { firestore: () => database },
    '@/lib/membership/access': { requireMarketplaceAccess: async () => null },
    '@/lib/data': { getProject: (slug) => projects[`sample:${slug}`] },
  };
  const module = { exports: {} };
  const source = readFileSync(new URL('../src/app/api/marketplace/proposals/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, Request, process, console,
    require(name) { if (name in stubs) return stubs[name]; return requireFromHere(name); },
  }, { filename: 'src/app/api/marketplace/proposals/route.ts' });
  return { ...module.exports, records };
}

test('proposal inputs reject document paths and non-string pricing types before any project lookup', async () => {
  const valid = { projectSlug: 'project-one', message: 'A detailed proposal message with scope.', delivery: 'Two weeks', amount: 1500, pricingType: 'fixed' };
  for (const overrides of [{ projectSlug: '' }, { projectSlug: 'a/b/c' }, { projectSlug: '..' }, { pricingType: ['fixed'] }]) {
    const route = proposalRoute();
    const response = await route.POST(new Request('https://local.test/api/marketplace/proposals', {
      method: 'POST', body: JSON.stringify({ ...valid, ...overrides }),
    }));
    assert.equal(response.status, 400);
    assert.equal(route.records.proposals.size, 0);
  }
});

test('a demo application is saved only in the private demo collection', async () => {
  const { POST, records } = proposalRoute({ projects: { 'sample:sample-project': { slug: 'sample-project', title: 'Sample project', sample: true } } });
  const request = (message, amount) => new Request('https://local.test/api/marketplace/proposals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectSlug: 'sample-project', message, amount, delivery: 'Two weeks', pricingType: 'fixed' }),
  });
  const response = await POST(request('I would approach the project in clear milestones.', 1200));
  assert.equal(response.status, 201);
  assert.equal(response.body.demo, true);
  assert.equal(records['demo-proposals'].size, 1);
  assert.equal(records.proposals.size, 0);
  const updatedResponse = await POST(request('I would refine the same project with weekly reviews.', 1500));
  assert.equal(updatedResponse.status, 201);
  assert.equal(records['demo-proposals'].size, 1);
  const saved = [...records['demo-proposals'].values()][0];
  assert.equal(saved.status, 'test');
  assert.equal(saved.isDemo, true);
  assert.equal(saved.freelancerUid, 'freelancer-1');
  assert.equal(saved.amount, 1500);
});

test('proposal history combines the user\'s submitted and demo messages and handles legacy text records', async () => {
  const { GET } = proposalRoute({
    proposals: [
      { id: 'live-1', data: { freelancerUid: 'freelancer-1', message: 'A live proposal', projectTitle: 'Live project', createdAt: 200, clientUid: 'private-client' } },
      { id: 'legacy-1', data: { freelancerUid: 'freelancer-1', text: 'A legacy message', createdAt: 100 } },
      { id: 'other-user', data: { freelancerUid: 'someone-else', message: 'Do not show this', createdAt: 500 } },
    ],
    demos: [{ id: 'demo-1', data: { freelancerUid: 'freelancer-1', message: 'A test proposal', projectTitle: 'Sample project', amount: 1200, currency: 'ILS', pricingType: 'fixed', delivery: 'Two weeks', status: 'test', isDemo: true, createdAt: 300 } }],
  });
  const response = await GET(new Request('https://local.test/api/marketplace/proposals'));
  assert.equal(response.status, 200);
  assert.deepEqual(Array.from(response.body.proposals, (item) => item.id), ['demo-1', 'live-1', 'legacy-1']);
  assert.equal(response.body.proposals[0].isDemo, true);
  assert.equal(response.body.proposals[0].amount, 1200);
  assert.equal(response.body.proposals[0].status, 'test');
  assert.equal(response.body.proposals[0].conversationId, '');
  assert.equal(response.body.proposals[0].delivery, 'Two weeks');
  assert.equal(response.body.proposals[2].message, 'A legacy message');
  assert.equal(response.body.proposals[1].conversationId, 'live-1');
  assert.equal('clientUid' in response.body.proposals[1], false);
});

test('a Firestore sample project is routed to the private practice collection and never creates a conversation', async () => {
  const { POST, records } = proposalRoute({ projects: { 'seed-sample-one': { title: 'Stored sample', sample: true, status: 'open', ownerUid: 'agent' } } });
  const response = await POST(new Request('https://local.test/api/marketplace/proposals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectSlug: 'seed-sample-one', message: 'I would approach the project in clear milestones.', amount: 900, delivery: 'Two weeks', pricingType: 'fixed' }),
  }));
  assert.equal(response.status, 201);
  assert.equal(response.body.demo, true);
  assert.equal(records.proposals.size, 0);
  assert.equal([...records['demo-proposals'].values()][0].projectTitle, 'Stored sample');
});
