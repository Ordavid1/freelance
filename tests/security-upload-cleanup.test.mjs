import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/load-ts.mjs';
const id='11111111-1111-4111-a111-111111111111', path=`users/owner/profileSources/${id}`,now=10*86_400_000;
function fixture({status='uploading',mismatch=false,generationRace=false}={}) {
 const row={status,ownerUid:'owner',objectName:`users/owner/profile-sources/${id}`,createdAt:{toMillis:()=>1}};
 let record=row;const calls=[],writes=[];
 const ref={path,id};const snapshot=()=>({data:()=>record,get:key=>record?.[key]});
 const db={collectionGroup:()=>({where(){return this},orderBy(){return this},limit(){return this},get:async()=>({size:1,docs:[{ref}]})}),collection:()=>({doc:()=>({audit:true})}),runTransaction:async fn=>fn({get:async()=>snapshot(),update:(_ref,value)=>{record={...record,...value};writes.push(value)},delete:()=>{record=undefined},create:()=>{}})};
 const bucket={file:()=>({getMetadata:async()=>[{generation:'123',timeCreated:'1970-01-01T00:00:01Z',metadata:{ownerUid:mismatch?'other':'owner',sourceId:id}}],delete:async options=>{calls.push(options);if(generationRace)throw Object.assign(new Error(),{code:412});}})};
 const module=loadModule('src/lib/security/upload-cleanup.ts',{stubs:{'node:crypto':{randomUUID:()=> 'lease'},'firebase-admin/firestore':{Timestamp:{fromMillis:x=>x},FieldValue:{serverTimestamp:()=>now}},'@/lib/db/firestore':{firestore:()=>db},'@/lib/db/storage':{userUploadsBucket:()=>bucket}}});
 return {module,calls,writes,record:()=>record};
}
test('stale uploads are deleted only with generation preconditions and matching ownership',async()=>{
 const f=fixture();const result=await f.module.cleanupStaleUploads(now);
 assert.equal(result.deleted,1);assert.equal(f.calls[0].ifGenerationMatch,'123');assert.equal(f.record(),undefined);
});
test('ready sources are never deleted',async()=>{
 const f=fixture({status:'ready'});await f.module.cleanupStaleUploads(now);
 assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);assert.equal(f.record().status,'ready');
});
test('ownership mismatch and changed generations are quarantined for review',async()=>{
 for(const options of [{mismatch:true},{generationRace:true}]){
  const f=fixture(options);const result=await f.module.cleanupStaleUploads(now);
  assert.equal(result.deleted,0);assert.equal(result.review,1);assert.equal(f.record().status,'cleanup_review');
 }
});
