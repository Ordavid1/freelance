import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from './helpers/load-ts.mjs';
function fixture(records = {}) {
 const reads=[];
 const ref=(collection,id)=>({id,key:`${collection}/${id}`,get:async()=>({get:field=>records[`${collection}/${id}`]?.[field]})});
 const db={collection:name=>({doc:id=>ref(name,id)})};
 const policy=loadModule('src/lib/security/marketplace-policy.ts',{stubs:{'node:crypto':{createHash},'@/lib/db/firestore':{firestore:()=>db}}});
 const tx={get:async reference=>{reads.push(reference.key);return {get:field=>records[reference.key]?.[field]};}};
 return {policy,tx,reads,records};
}
test('a relationship key is symmetric and blocks both directions inside the write transaction',async()=>{
 const f=fixture(); const key=f.policy.contactRef('one','two').key;
 assert.equal(key,f.policy.contactRef('two','one').key);
 f.records[key]={blockedBy:['one']};
 for(const [a,b] of [['one','two'],['two','one']])await assert.rejects(f.policy.assertContactAllowed(f.tx,a,b),f.policy.ContactUnavailable);
 assert.ok(f.reads.includes('accountSecurity/one'));assert.ok(f.reads.includes('accountSecurity/two'));assert.ok(f.reads.includes(key));
});
test('either restricted participant prevents contact; normal accounts can contact',async()=>{
 const f=fixture();await f.policy.assertContactAllowed(f.tx,'one','two');
 f.records['accountSecurity/two']={state:'restricted'};
 await assert.rejects(f.policy.assertContactAllowed(f.tx,'one','two'),f.policy.ContactUnavailable);
 f.records['accountSecurity/two']={state:'unexpected'};
 await assert.rejects(f.policy.assertContactAllowed(f.tx,'one','two'),f.policy.ContactUnavailable);
});
test('restriction denies writes without invalidating identity or billing access',async()=>{
 const f=fixture({'accountSecurity/one':{state:'suspended'}});
 const response=await f.policy.accountWriteDenied('one');assert.equal(response.status,403);
 assert.equal((await response.json()).code,'ACCOUNT_RESTRICTED');
 assert.equal(await f.policy.accountWriteDenied('normal'),null);
});
test('relationship status reveals only my block and contact availability',async()=>{
 const f=fixture();f.records[f.policy.contactRef('one','two').key]={blockedBy:['two']};
 const value=await f.policy.contactStatus('one','two');
 assert.equal(value.blockedByMe,false);assert.equal(value.canContact,false);
 assert.deepEqual(Object.keys(value).sort(),['blockedByMe','canContact']);
});
