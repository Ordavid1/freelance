// Synthetic stored-source load against the actual route, with no cloud/provider calls.
import {createHash,randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server.js';
import {loadModule} from '../helpers/load-ts.mjs';
const sourceIds=['11111111-1111-4111-a111-111111111111','22222222-2222-4222-a222-222222222222','33333333-3333-4333-a333-333333333333'];
const started=performance.now(), priorInfo=console.info;console.info=()=>{};
try {
 const statuses=await Promise.all(Array.from({length:4},async(_,i)=>{
  const uid=`load-user-${i}`;const doc=id=>({id,collection:()=>({doc})});
  const db={collection:()=>({doc}),getAll:async(...refs)=>refs.map(ref=>({exists:true,get:key=>({ownerUid:uid,objectName:`users/${uid}/profile-sources/${ref.id}`,contentType:'text/plain',size:8*1024*1024,status:'ready'})[key]}))};
  const module=loadModule('src/app/api/ai/profile/route.ts',{stubs:{
   'node:crypto':{createHash,randomUUID},'next/server':{NextResponse},
   '@/lib/auth/session':{getCurrentUser:async()=>({uid}),isSameOrigin:()=>true},
   '@/lib/security/rate-limit':{enforceActionLimit:async()=>null},
   '@/lib/db/firestore':{firestore:()=>db},
   '@/lib/db/storage':{userUploadsBucket:()=>({file:()=>({download:async()=>[Buffer.alloc(8*1024*1024,97)]})})},
   '@/lib/ai':{isVertexConfigured:()=>true,safePublicUrl:()=>false,generateWithVertex:async()=>{await new Promise(r=>setTimeout(r,100));return {name:'Load fixture',headline:'Test',bio:'',portfolio:[],experience:[],education:[],skills:[],facts:[]};}},
  }});
  const form=new FormData();form.set('sourceIds',JSON.stringify(sourceIds));
  const response=await module.POST(new Request('http://localhost/api/ai/profile',{method:'POST',body:form}));
  return response.status;
 }));
 if(statuses.some(s=>s!==200))throw new Error('Load fixture request failed');
 console.log(JSON.stringify({requests:4,storedInputMiBPerRequest:24,maxRssMiB:Math.round(process.resourceUsage().maxRSS/1024),durationMs:Math.round(performance.now()-started),cloudCalls:0,statuses}));
}finally{console.info=priorInfo;}
