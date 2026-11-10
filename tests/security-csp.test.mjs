import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest,NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';
const {proxy}=loadModule('src/proxy.ts',{stubs:{'next/server':{NextResponse}},env:{NODE_ENV:'production',SITE_INDEXABLE:'true'}});
test('CSP uses fresh server nonces and overwrites caller-provided policy and nonce',()=>{
 const request=()=>new NextRequest('https://freelance-place.com/messages',{headers:{host:'freelance-place.com','x-nonce':'attacker-controlled','content-security-policy':"script-src 'unsafe-inline'"}});
 const a=proxy(request()),b=proxy(request());
 const policy=a.headers.get('content-security-policy');
 assert.match(policy,/'nonce-[0-9a-f]{32}'/);assert.match(policy,/'strict-dynamic'/);
 assert.doesNotMatch(policy,/attacker-controlled|unsafe-eval/);
 assert.notEqual(policy,b.headers.get('content-security-policy'));
 assert.equal(a.headers.get('x-middleware-request-content-security-policy'),policy);
 assert.match(policy,/script-src-attr 'none'/);
});
