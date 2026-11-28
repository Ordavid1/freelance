import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './helpers/load-ts.mjs';
const conversation='a'.repeat(64);
function fixture({uid='one',records={},moderator='moderator',revokeFails=false}={}) {
 const revoked=[];
 const data=new Map(Object.entries(records));let sequence=0;const writes=[];
 const doc=(collection,id)=>{const key=`${collection}/${id ?? ++sequence}`;return {id:key.split('/')[1],key,get:async()=>snapshot(key)};};
 const snapshot=key=>({exists:data.has(key),data:()=>data.get(key),get:field=>data.get(key)?.[field]});
 const db={collection:name=>({doc:id=>doc(name,id),add:async value=>{const key=`${name}/${++sequence}`;data.set(key,value);writes.push([key,value]);}}),runTransaction:async fn=>{
  const pending=[];
  const value=await fn({get:async ref=>snapshot(ref.key),set:(ref,value)=>pending.push([ref.key,value]),create:(ref,value)=>pending.push([ref.key,value]),update:(ref,value)=>pending.push([ref.key,{...data.get(ref.key),...value}])});
  pending.forEach(([key,value])=>{data.set(key,value);writes.push([key,value]);});return value;
 }};
 const common={'node:crypto':{createHash},'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=>1}},'@/lib/db/firestore':{firestore:()=>db},'@/lib/auth/session':{getCurrentUser:async()=>uid?{uid}:null,isSameOrigin:()=>true},'@/lib/security/rate-limit':{enforceActionLimit:async()=>null},'@/lib/security/moderator':{moderatorUid:async()=>moderator},'@/lib/auth/firebase-admin':{adminAuth:()=>({revokeRefreshTokens:async uid=>{if(revokeFails)throw new Error('auth down');revoked.push(uid);}})}};
 return {data,writes,revoked,load:route=>loadModule(`src/app/api/${route}/route.ts`,{stubs:common})};
}
const request=value=>new Request('https://example.test/api',{method:'POST',body:JSON.stringify(value)});
test('a stranger cannot block contacts; either participant can remove only their own block',async()=>{
 const records={[`conversations/${conversation}`]:{clientUid:'one',freelancerUid:'two'}};
 const stranger=fixture({uid:'stranger',records});assert.equal((await stranger.load('marketplace/safety').POST(request({conversationId:conversation,blocked:true}))).status,404);assert.equal(stranger.writes.length,0);
 const one=fixture({records});const api=one.load('marketplace/safety');
 assert.equal((await api.POST(request({conversationId:conversation,blocked:true}))).status,200);
 const blockKey=[...one.data.keys()].find(k=>k.startsWith('userBlocks/'));
 one.data.set(blockKey,{blockedBy:['one','two']});
 await api.POST(request({conversationId:conversation,blocked:false}));
 assert.deepEqual(Array.from(one.data.get(blockKey).blockedBy),['two']);
});
test('appeals are bound to my current restriction version and preserve the first submission',async()=>{
 const f=fixture({records:{'accountSecurity/one':{state:'restricted',version:4}}});const api=f.load('marketplace/appeals');
 const first=await api.POST(request({message:'Please review this restriction.'}));assert.equal(first.status,200);const id=(await first.json()).id;
 await api.POST(request({message:'A different repeated request.'}));assert.equal(f.data.get(`accountAppeals/${id}`).message,'Please review this restriction.');
 const active=fixture();assert.equal((await active.load('marketplace/appeals').POST(request({message:'Please review this restriction.'}))).status,409);
});
test('moderator decisions reject missing authority, self changes and unrelated or stale appeals',async()=>{
 const denied=fixture({moderator:null});assert.equal((await denied.load('moderation/accounts').POST(request({uid:'one',state:'restricted',reason:'abuse'}))).status,403);assert.equal(denied.writes.length,0);
 const f=fixture({records:{'accountSecurity/one':{state:'restricted',version:4},[`accountAppeals/${'b'.repeat(64)}`]:{ownerUid:'other',restrictionVersion:4,status:'pending'}}});
 assert.equal((await f.load('moderation/accounts').POST(request({uid:'one',state:'active',reason:'review_complete',appealId:'b'.repeat(64)}))).status,409);assert.equal(f.writes.length,0);
 assert.equal((await f.load('moderation/accounts').POST(request({uid:'moderator',state:'active',reason:'review_complete'}))).status,400);
});
test('moderator claims require verified session, MFA and recent authentication',async()=>{
 for(const [overrides,expected] of [[{},'mod'],[{moderator:false},null],[{auth_time:0},null],[{firebase:{}},null]]){
  const token={uid:'mod',moderator:true,auth_time:Date.now()/1000,firebase:{sign_in_second_factor:'totp'},...overrides};
  const sessionStubs={'next/headers':{cookies:async()=>({get:()=>({value:'verified-by-stub'})})},'@/lib/auth/firebase-admin':{adminAuth:()=>({verifySessionCookie:async(_value,revoked)=>{assert.equal(revoked,true);return token;}})},'@/lib/auth/session-revocation':{isSessionRevoked:async()=>false}};
  sessionStubs['./firebase-admin']=sessionStubs['@/lib/auth/firebase-admin'];sessionStubs['./session-revocation']=sessionStubs['@/lib/auth/session-revocation'];
  const module=loadModule('src/lib/security/moderator.ts',{stubs:{'@/lib/auth/session':loadModule('src/lib/auth/session.ts',{stubs:sessionStubs})}});
  assert.equal(await module.moderatorUid(),expected);
 }
});
test('a valid moderator decision resolves the matching appeal and appends an audit record atomically',async()=>{
 const id='c'.repeat(64);const f=fixture({records:{'accountSecurity/one':{state:'restricted',version:4},[`accountAppeals/${id}`]:{ownerUid:'one',restrictionVersion:4,status:'pending'}}});
 const response=await f.load('moderation/accounts').POST(request({uid:'one',state:'active',reason:'review_complete',appealId:id}));
 assert.equal(response.status,200);assert.equal(f.data.get('accountSecurity/one').state,'active');assert.equal(f.data.get('accountSecurity/one').version,5);
 assert.equal(f.data.get(`accountAppeals/${id}`).status,'resolved');assert.equal(f.writes.filter(([key])=>key.startsWith('securityAuditEvents/')).length,1);
});

const decision=(extra={})=>request({uid:'one',state:'restricted',reason:'abuse',...extra});
test('a decision revokes the account sessions only when asked, and always for account_security',async()=>{
 const plain=fixture();const plainResponse=await plain.load('moderation/accounts').POST(decision());
 assert.equal((await plainResponse.json()).sessionsRevoked,false);assert.deepEqual(plain.revoked,[]);
 const asked=fixture();const askedResponse=await asked.load('moderation/accounts').POST(decision({revokeSessions:true}));
 assert.equal((await askedResponse.json()).sessionsRevoked,true);assert.deepEqual(asked.revoked,['one']);
 const forced=fixture();const forcedResponse=await forced.load('moderation/accounts').POST(decision({reason:'account_security',revokeSessions:false}));
 assert.equal((await forcedResponse.json()).sessionsRevoked,true);assert.deepEqual(forced.revoked,['one']);
 assert.ok(forced.writes.some(([key,value])=>key.startsWith('securityAuditEvents/')&&value.action==='account.sessions.revoked'));
});
test('a failed session revocation never blocks the decision: it is audited and reported as sessionsRevoked false',async()=>{
 const f=fixture({revokeFails:true});const response=await f.load('moderation/accounts').POST(decision({reason:'account_security'}));
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,true);assert.equal(body.sessionsRevoked,false);
 assert.equal(f.data.get('accountSecurity/one').state,'restricted');
 const actions=f.writes.map(([,value])=>value.action).filter(Boolean);assert.ok(actions.includes('account.sessions.revoke_failed'));assert.ok(!actions.includes('account.sessions.revoked'));
});
test('revokeSessions must be a boolean',async()=>{
 const f=fixture();assert.equal((await f.load('moderation/accounts').POST(decision({revokeSessions:'yes'}))).status,400);assert.equal(f.writes.length,0);
});
