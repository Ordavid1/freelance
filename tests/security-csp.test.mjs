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
test('Firebase auth helper pages are proxied from the site host with same-origin framing, other methods and paths are not',()=>{
 const env={NODE_ENV:'production',SITE_INDEXABLE:'true',GOOGLE_CLOUD_PROJECT:'demo-project',FIREBASE_AUTH_DOMAIN:'freelance-place.com'};
 const {proxy:p}=loadModule('src/proxy.ts',{stubs:{'next/server':{NextResponse}},env});
 const req=(path,method='GET')=>new NextRequest(`https://freelance-place.com${path}`,{method,headers:{host:'freelance-place.com'}});
 const ok=p(req('/__/auth/handler?apiKey=x'));
 assert.equal(ok.headers.get('x-middleware-rewrite'),'https://demo-project.firebaseapp.com/__/auth/handler?apiKey=x');
 assert.equal(ok.headers.get('x-frame-options'),'SAMEORIGIN');
 assert.match(ok.headers.get('content-security-policy'),/frame-ancestors 'self'/);
 assert.equal(p(req('/__/auth/handler','POST')).status,404);
 assert.equal(p(req('/__/auth/../secret')).headers.get('x-middleware-rewrite'),null);
 const page=p(req('/messages'));
 assert.match(page.headers.get('content-security-policy'),/frame-src 'self' https:\/\/freelance-place\.com https:\/\/connect\.nango\.dev/);
});
