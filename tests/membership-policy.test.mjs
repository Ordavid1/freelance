import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier, context, next) {
  if(specifier === 'server-only') return {url:'data:text/javascript,export{}',shortCircuit:true};
  if(specifier === 'next/server') return next('next/server.js',context);
  if(specifier.startsWith('@/')) return next(new URL('../src/'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  return next(specifier,context);
}});
await mock.module('../src/lib/security/rate-limit.ts',{namedExports:{enforceActionLimit:async()=>null}});
await mock.module('../src/lib/security/marketplace-policy.ts',{namedExports:{accountWriteDenied:async()=>null,assertContactAllowed:async()=>{},ContactUnavailable:class extends Error {}}});
let gates=0, created=0, closed=0;
const user={uid:'expired-freelancer',name:'Test',email:'test@example.com'};
await mock.module('../src/lib/auth/session.ts',{namedExports:{getCurrentUser:async()=>user,isSameOrigin:()=>true}});
await mock.module('../src/lib/membership/access.ts',{namedExports:{requireMarketplaceAccess:async()=>{gates++;return Response.json({code:'MEMBERSHIP_REQUIRED'},{status:402});}}});
const query={where:()=>query,limit:()=>query,get:async()=>({docs:[]}),doc:()=>({create:async()=>{created++;}})};
await mock.module('../src/lib/db/firestore.ts',{namedExports:{firestore:()=>({collection:()=>query,runTransaction:async fn=>fn({get:async()=>({exists:true,get:field=>({ownerUid:user.uid,status:'open'})[field],data:()=>({ownerUid:user.uid,status:'open'})}),update:()=>{closed++;}})})}});
await mock.module('../src/lib/db/projects.ts',{namedExports:{listOpenProjects:async()=>[],listFeedProjects:async()=>[],toPublicProject:(slug,data)=>({slug,title:data.title})}});
// The lifecycle hooks need Next's request scope (revalidateTag, after); tests/seo-indexnow.test.mjs covers them and the route wiring.
await mock.module('../src/lib/projects/events.ts',{namedExports:{onProjectPublished:()=>{},onProjectClosed:()=>{}}});
const projects=await import('../src/app/api/marketplace/projects/route.ts');
const proposals=await import('../src/app/api/marketplace/proposals/route.ts');
const conversations=await import('../src/app/api/marketplace/conversations/route.ts');
test('expired freelancer can publish and manage projects and read proposals/conversations for free',async()=>{
 const request=new Request('https://example.com/api/marketplace/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'A new project',description:'A sufficiently detailed project brief for a freelancer.',category:'Web',budget:'1000',deadline:'Next week',skills:['React']})});
 assert.equal((await projects.POST(request)).status,201);assert.equal(created,1);
 assert.equal((await projects.GET(new Request('https://example.com/api/marketplace/projects?mine=1'))).status,200);
 assert.equal((await proposals.GET(new Request('https://example.com/api/marketplace/proposals'))).status,200);
 assert.equal((await conversations.GET(new Request('https://example.com/api/marketplace/conversations'))).status,200);
 assert.equal((await projects.PATCH(new Request('https://example.com/api/marketplace/projects',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:'own-project',status:'closed'})}))).status,200);
 assert.equal(closed,1);
 assert.equal(gates,0);
});
test('expired freelancer is still blocked from submitting new proposals',async()=>{
 assert.equal((await proposals.POST(new Request('https://example.com/api/marketplace/proposals',{method:'POST'}))).status,402);
 assert.equal(gates,1);
});
