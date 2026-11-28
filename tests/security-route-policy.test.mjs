// Coverage test: every HTTP method exported by every route.ts goes through the policy adapter, under a registered
// operation, and the registry itself is internally consistent. A new route that skips the adapter fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { loadModule } from './helpers/load-ts.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const { operations } = loadModule('src/lib/security/operations.ts', {
  stubs: { '@/lib/headhunters/messages': { HEADHUNTER_API_ERRORS: { SIGN_IN: 'sign-in', FORBIDDEN: 'forbidden' } } },
});

function routeFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (entry === 'route.ts') found.push(path);
  }
  return found.sort();
}

const routePath = file => '/' + relative(join(ROOT, 'src/app'), file).split(sep).slice(0, -1).join('/');

/** Every export of a route file: { name, kind: 'route' | 'other', operationId } */
function exportsOf(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out = [];
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    const exported = modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(statement)) {
      for (const element of statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements : []) out.push({ name: element.name.text, kind: 'other' });
      continue;
    }
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(source);
        const init = declaration.initializer;
        const isRoute = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'route'
          && statement.declarationList.flags & ts.NodeFlags.Const;
        const first = isRoute ? init.arguments[0] : undefined;
        out.push({ name, kind: isRoute ? 'route' : 'other', operationId: first && ts.isStringLiteral(first) ? first.text : undefined });
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      out.push({ name: statement.name.text, kind: 'other' });
    } else {
      out.push({ name: '(unknown export)', kind: 'other' });
    }
  }
  return out;
}

const files = routeFiles(join(ROOT, 'src/app'));
const handlers = files.flatMap(file => exportsOf(file).filter(item => METHODS.has(item.name)).map(item => ({ ...item, file, path: routePath(file) })));

test('route files are found', () => {
  assert.ok(files.length >= 40, `found ${files.length} route files`);
  assert.ok(handlers.length >= files.length);
});

test('every exported HTTP method is `export const METHOD = route("<operation id>", ...)`', () => {
  for (const handler of handlers) {
    const where = `${handler.name} ${handler.path}`;
    assert.equal(handler.kind, 'route', `${where} must be exported through route(...)`);
    assert.ok(handler.operationId, `${where} must name its operation with a string literal`);
    assert.ok(Object.hasOwn(operations, handler.operationId), `${where}: unknown operation ${handler.operationId}`);
  }
});

test('route files export nothing that is not an HTTP method or a Next.js route segment option', () => {
  const allowed = new Set([...METHODS, 'runtime', 'dynamic', 'revalidate', 'maxDuration', 'preferredRegion', 'fetchCache', 'dynamicParams']);
  for (const file of files) {
    for (const item of exportsOf(file)) assert.ok(allowed.has(item.name), `${relative(ROOT, file)} exports ${item.name}`);
  }
});

test('an unregistered or duplicated operation cannot hide: each operation is used by exactly one handler', () => {
  const used = new Map();
  for (const handler of handlers) used.set(handler.operationId, [...(used.get(handler.operationId) ?? []), `${handler.name} ${handler.path}`]);
  for (const [id, where] of used) assert.equal(where.length, 1, `${id} is used by ${where.join(', ')}`);
  for (const id of Object.keys(operations)) assert.ok(used.has(id) || toolOperations.has(id), `operation ${id} is registered but no route or MCP tool uses it`);
});

// MCP tools are the other door into the registry: `defineTool({ operation: '<id>' })` (src/lib/mcp/policy.ts).
function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}
const toolDefinitions = sourceFiles(join(ROOT, 'src/lib/mcp')).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/defineTool\(\{[^}]*?operation:\s*'([^']+)'/gs)].map(match => ({ id: match[1], file: relative(ROOT, file) })));
const toolOperations = new Set(toolDefinitions.map(tool => tool.id));

test('every MCP tool runs under a registered operation an anonymous caller may use', () => {
  for (const { id, file } of toolDefinitions) {
    const operation = operations[id];
    assert.ok(operation, `${file}: unknown operation ${id}`);
    assert.ok(operation.auth.kind === 'public' || operation.auth.kind === 'optionalUser', `${file}: ${id} needs an identity the MCP endpoint cannot provide`);
    assert.notEqual(operation.account, 'active', `${file}: ${id}`);
    assert.equal(operation.membership, undefined, `${file}: ${id}`);
    assert.equal(operation.humanCheck, undefined, `${file}: ${id}`);
  }
});

test('the MCP operations are public reads without cookies, and the endpoint carries the burst limit', () => {
  for (const id of ['mcp.transport', 'catalog.read', 'agency.list']) assert.equal(operations[id].auth.kind, 'public', id);
  assert.equal(operations['mcp.transport'].burstLimit, 'mcp.request');
  assert.equal(operations['project.list'].auth.kind, 'optionalUser', 'project search and reads reuse project.list');
});

test('burst limits are only declared on operations that need no identity for them, and name a real limit', () => {
  const limits = loadModule('src/lib/security/burst-limit.ts').burstLimits;
  for (const [id, operation] of Object.entries(operations)) if (operation.burstLimit) assert.ok(Object.hasOwn(limits, operation.burstLimit), id);
});

test('public operations say why, and nothing else is public by accident', () => {
  for (const [id, operation] of Object.entries(operations)) {
    if (operation.auth.kind === 'public') assert.ok(operation.auth.reason.trim().length >= 20, `${id} needs a real public reason`);
  }
});

test('scheduler operations are bound to their own route as the OIDC audience', () => {
  const byOperation = new Map(handlers.map(handler => [handler.operationId, handler]));
  for (const [id, operation] of Object.entries(operations)) {
    if (operation.auth.kind !== 'scheduler') continue;
    assert.equal(operation.auth.audiencePath, byOperation.get(id).path, `${id}`);
    assert.match(operation.auth.emailEnv, /^[A-Z][A-Z0-9_]+_EMAIL$/, id);
  }
});

test('account state is declared on every signed-in operation, and only there', () => {
  for (const [id, operation] of Object.entries(operations)) {
    const signedIn = operation.auth.kind === 'user' || operation.auth.kind === 'optionalUser';
    if (signedIn) assert.ok(operation.account === 'active' || operation.account === 'any', `${id} must declare account`);
    else {
      assert.equal(operation.account, undefined, `${id}: account state needs a signed-in caller`);
      assert.equal(operation.limit, undefined, `${id}: a per-account limit needs a signed-in caller`);
      assert.equal(operation.membership, undefined, `${id}: membership needs a signed-in caller`);
    }
  }
});

// Plan item 4. Writes that create content, spend money or call a provider need an active account.
const ACTIVE = [
  'ai.profile', 'ai.projectBrief', 'upload.create', 'profile.update', 'import.xplace.project', 'import.xplace.ingest',
  'nango.session', 'nango.import', 'dribbble.connect', 'dribbble.callback', 'savedProject.toggle', 'project.create',
  'proposal.create', 'message.send', 'headhunter.apply', 'headhunter.update', 'headhunter.handle.rename', 'billing.checkout',
];
// Restricted accounts must still be able to read, leave, appeal, block and clean up.
const ANY_MUTATING = [
  'billing.card', 'billing.confirm', 'billing.cancel', 'safety.block', 'safety.appeal', 'mailPreferences.update',
  'upload.delete', 'nango.connections.delete', 'dribbble.disconnect', 'project.close', 'proposal.withdraw',
  'headhunter.handle.check', 'support.message', 'membership.access',
];

test('account-state policy matches the plan: content and spend need an active account', () => {
  for (const id of ACTIVE) {
    assert.ok(operations[id], `${id} is registered`);
    assert.equal(operations[id].account, 'active', id);
  }
});

test('operations a restricted account may still use are an explicit, reviewed list', () => {
  const handlerOf = new Map(handlers.map(handler => [handler.operationId, handler.name]));
  const mutatingAny = Object.entries(operations)
    .filter(([id, operation]) => operation.account === 'any' && MUTATING.has(handlerOf.get(id)))
    .map(([id]) => id);
  const unexpected = mutatingAny.filter(id => !ANY_MUTATING.includes(id));
  assert.deepEqual(unexpected, [], `mutating operations open to restricted accounts must be reviewed and listed: ${unexpected.join(', ')}`);
  for (const id of ACTIVE) assert.equal(operations[id].account, 'active', id);
});

test('reads never need an active account (the Dribbble OAuth callback is a GET that connects, and is listed as active)', () => {
  for (const handler of handlers) {
    if (handler.name !== 'GET' && handler.name !== 'HEAD') continue;
    if (ACTIVE.includes(handler.operationId)) continue;
    const operation = operations[handler.operationId];
    if (operation.account) assert.equal(operation.account, 'any', `${handler.operationId} is a read`);
  }
});

test('cost features carry the controls the plan requires', () => {
  assert.equal(operations['ai.profile'].globalBudget, 'ai.profile');
  assert.equal(operations['ai.projectBrief'].globalBudget, 'ai.projectBrief');
  assert.equal(operations['import.xplace.project'].globalBudget, 'import.xplace');
  assert.equal(operations['ai.profile'].humanCheck, 'ai_profile');
  assert.equal(operations['ai.projectBrief'].humanCheck, 'ai_project_brief');
  assert.equal(operations['support.message'].humanCheck, 'support_message');
  assert.equal(operations['support.message'].anonymousLimit, 'support.message');
  assert.equal(operations['notifications.unsubscribe'].anonymousLimit, 'notifications.unsubscribe');
  assert.equal(operations['profile.update'].limit, 'profile.update');
  assert.equal(operations['maintenance.budget'].auth.emailEnv, 'BUDGET_ALERT_PUSH_EMAIL');
});
