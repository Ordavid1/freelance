import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Timestamp } from 'firebase-admin/firestore';
registerHooks({resolve(specifier, context, next) {
  if(specifier === 'server-only') return {url:'data:text/javascript,export{}',shortCircuit:true};
  if(specifier.startsWith('@/')) return next(new URL('../src/'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  if(specifier === './cardcom') return next(new URL('../src/lib/billing/cardcom.ts',import.meta.url).href,context);
  return next(specifier,context);
}});
const adapter = await import('../src/lib/billing/cardcom.ts');
const {cardcomConfig, checkoutPayload, verifyPayment, nextMonth, hostedUrl, verifyRenewal} = adapter;
const config = { terminal: 123, apiName: 'fake', apiPassword: 'fake', siteUrl: 'https://example.com' };
const id = '11111111-1111-4111-8111-111111111111';
const lp = '22222222-2222-4222-8222-222222222222';
function result() { return { ResponseCode:0, Operation:'ChargeAndCreateToken', ReturnValue:id, LowProfileId:lp, TerminalNumber:123, TranzactionId:45, TokenInfo:{Token:'test-token',TokenExDateMonth:1,TokenExDateYear:2030}, TranzactionInfo:{ResponseCode:0,TerminalNumber:123,Amount:19.99,CoinId:1,TranzactionId:45,Last4CardDigitsString:'0008'},DocumentInfo:{ResponseCode:0,DocumentNumber:90} }; }
test('configuration fails closed and checkout price/recurring operation is server-owned', () => {
 assert.throws(()=>cardcomConfig({BILLING_ENABLED:'false'}));
 assert.throws(()=>cardcomConfig({BILLING_ENABLED:'true',CARDCOM_TERMINAL_NUMBER:'1'}));
 assert.equal(cardcomConfig({BILLING_ENABLED:'true',CARDCOM_TERMINAL_NUMBER:'1',CARDCOM_API_NAME:'a',NEXT_PUBLIC_SITE_URL:'https://example.com'}).terminal,1);
 const payload=checkoutPayload(config,id,'Test','test@example.com');
 assert.equal(payload.Amount,19.99); assert.equal(payload.Operation,'ChargeAndCreateToken'); assert.equal(payload.ReturnValue,id);
 assert.equal(payload.Document.Products[0].UnitCost,19.99);
 assert.throws(()=>hostedUrl('https://secure.cardcom.solutions.evil.com/pay'));
 assert.throws(()=>hostedUrl('javascript:alert(1)'));
});
test('verification rejects spoofed identity, amounts, currency, token-only, failed and refund transactions', () => {
 const order={id,lowProfileId:lp,terminal:123,amountAgorot:1999};
 assert.equal(verifyPayment(result(),order).last4,'0008');
 for(const patch of [{ReturnValue:'other'},{TerminalNumber:999},{LowProfileId:'other'},{Operation:'CreateTokenOnly'},{ResponseCode:5119},{TranzactionId:0}]) assert.throws(()=>verifyPayment({...result(),...patch},order));
 for(const patch of [{Amount:19.989},{Amount:'19.99'},{CoinId:2},{ResponseCode:700},{TranzactionId:99},{IsRefund:true}]) assert.throws(()=>verifyPayment({...result(),TranzactionInfo:{...result().TranzactionInfo,...patch}},order));
 assert.throws(()=>verifyRenewal({ResponseCode:608},123));
});
test('calendar month clamps leap years and retains UTC time',()=>{
 assert.equal(new Date(nextMonth(Date.parse('2028-01-31T12:34:00Z'))).toISOString(),'2028-02-29T12:34:00.000Z');
 assert.equal(new Date(nextMonth(Date.parse('2027-01-31T12:34:00Z'))).toISOString(),'2027-02-28T12:34:00.000Z');
});
// Transaction double serializes commits, stages writes and rejects reads after writes.
const rows = new Map(); let tail=Promise.resolve();
let historyRequests=0, historyError=null;
function historyQuery(filters=[]) {
 return {where:(key,op,value)=>historyQuery([...filters,[key,value]]),orderBy:()=>historyQuery(filters),limit:()=>historyQuery(filters),get:async()=>{
  historyRequests++;if(historyError)throw historyError;
  return {docs:[...rows.keys()].filter(key=>key.startsWith('billingOrders/')&&filters.every(([field,value])=>rows.get(key)[field]===value)).map(key=>snapshot(key))};
 }};
}
const snapshot=(key)=>({exists:rows.has(key),data:()=>rows.get(key),id:key.split('/')[1]});
const ref=(key)=>({key,id:key.split('/')[1],get:async()=>snapshot(key),update:async value=>rows.set(key,{...rows.get(key),...value})});
const db={collection:name=>({doc:id=>ref(`${name}/${id}`),where:(key,op,value)=>historyQuery([[key,value]])}),runTransaction:fn=>{
 const run=tail.then(async()=>{const writes=[];const tx={get:async r=>{assert.equal(writes.length,0,'Firestore requires reads before writes');return snapshot(r.key);},create:(r,v)=>writes.push(()=>{assert.ok(!rows.has(r.key));rows.set(r.key,v);}),set:(r,v,options)=>writes.push(()=>rows.set(r.key,options?.merge?{...rows.get(r.key),...v}:v)),update:(r,v)=>writes.push(()=>rows.set(r.key,{...rows.get(r.key),...v}))};const value=await fn(tx);for(const write of writes)write();return value;});tail=run.catch(()=>{});return run;
}};
await mock.module('../src/lib/db/firestore.ts',{namedExports:{firestore:()=>db}});
await mock.module('../src/lib/membership/access.ts',{namedExports:{getMembershipAccess:async()=>({state:'expired'})}});
const service=await import('../src/lib/billing/service.ts');
function setup(){ rows.clear();historyRequests=0;historyError=null; Object.assign(process.env,{BILLING_ENABLED:'true',CARDCOM_TERMINAL_NUMBER:'123',CARDCOM_API_NAME:'fake',CARDCOM_API_PASSWORD:'fake',NEXT_PUBLIC_SITE_URL:'https://example.com'}); }
const fakeFetch=fn=>mock.method(globalThis,'fetch',async(_url,options)=>Response.json(await fn(JSON.parse(options.body),_url)));
test('duplicate confirmation/webhook grants exactly one month and rejects another user',async()=>{
 setup(); rows.set(`billingOrders/${id}`,{uid:'u',status:'pending',lowProfileId:lp,terminal:123,amountAgorot:1999,name:'Test',email:'test@example.com'});rows.set('billingSubscriptions/u',{pendingOrderId:id});
 const transport=fakeFetch(()=>result());
 await assert.rejects(()=>service.confirmPayment(id,'other'),{code:'ORDER_NOT_FOUND'});
 await Promise.all([service.confirmPayment(id,'u'),service.confirmPayment(id)]);
 assert.equal(rows.get(`billingOrders/${id}`).status,'paid');
 const paid=rows.get('memberships/u').paidUntil.toMillis();
 await service.confirmPayment(id,'u');assert.equal(rows.get('memberships/u').paidUntil.toMillis(),paid);
 assert.equal(rows.get('billingSubscriptions/u').expiry,'0130');assert.equal(rows.get('billingSubscriptions/u').autoRenew,true);
 transport.mock.restore();
});
function due(){rows.set('billingSubscriptions/u',{autoRenew:true,status:'active',token:'test-token',expiry:'0130',terminal:123,name:'Test',email:'test@example.com',nextChargeAt:Timestamp.fromMillis(Date.now()-1000)});}
test('unknown renewal outcome retries same gateway key and reconciles 608 without double debit',async()=>{
 setup();due();const keys=[];let requests=0;
 const transport=fakeFetch((body,url)=>{keys.push(body.ExternalUniqTranId);requests++;if(requests===1)throw new Error('timeout');if(url.endsWith('/Transaction'))return {ResponseCode:608};return {...result().TranzactionInfo};});
 await assert.rejects(()=>service.renewSubscription('u'),{code:'GATEWAY_UNAVAILABLE'});
 rows.set('billingSubscriptions/u',{...rows.get('billingSubscriptions/u'),leaseUntil:Timestamp.fromMillis(0)});
 await service.renewSubscription('u');
 assert.equal(new Set(keys).size,1);assert.equal(rows.get('billingSubscriptions/u').renewalPending,false);
 assert.ok(rows.get('memberships/u').paidUntil.toMillis()>Date.now());
 const count=requests;await service.renewSubscription('u');assert.equal(requests,count);
 transport.mock.restore();
});
test('cancellation blocks new charges, including recovery of an unknown in-flight result',async()=>{
 setup();due();await service.cancelSubscription('u');let calls=0;
 let transport=fakeFetch(()=>{calls++;return {};});await service.renewSubscription('u');assert.equal(calls,0);transport.mock.restore();
 rows.set('billingSubscriptions/u',{...rows.get('billingSubscriptions/u'),renewalPending:true});
 transport=fakeFetch((_body,url)=>{assert.ok(url.endsWith('/GetTransactionByExternalUniqTran'));return result().TranzactionInfo;});
 await service.renewSubscription('u');assert.equal(rows.get('billingSubscriptions/u').autoRenew,false);assert.equal(rows.get('billingSubscriptions/u').token,null);assert.equal(rows.get('billingSubscriptions/u').renewalPending,false);
 transport.mock.restore();
});
test('definitive decline stops automatic renewal without granting paid access',async()=>{
 setup();due();const transport=fakeFetch(()=>({ResponseCode:9999}));await service.renewSubscription('u');assert.equal(rows.get('billingSubscriptions/u').status,'past_due');assert.equal(rows.get('billingSubscriptions/u').autoRenew,false);assert.equal(rows.has('memberships/u'),false);transport.mock.restore();
});
test('cancelling pending checkout prevents callback from silently enabling renewal',async()=>{
 setup();rows.set(`billingOrders/${id}`,{uid:'u',status:'pending',lowProfileId:lp,terminal:123,amountAgorot:1999,name:'Test',email:'test@example.com'});rows.set('billingSubscriptions/u',{pendingOrderId:id});
 await service.cancelSubscription('u');const transport=fakeFetch(()=>result());await service.confirmPayment(id,'u');assert.equal(rows.get('billingSubscriptions/u').autoRenew,false);assert.equal(rows.get('billingSubscriptions/u').token,null);assert.ok(rows.has('memberships/u'));transport.mock.restore();
});
test('checkout rejects missing consent and reuses the same pending hosted session',async()=>{
 setup();let count=0;const transport=fakeFetch(()=>{count++;return {ResponseCode:0,LowProfileId:lp,Url:'https://secure.cardcom.solutions/test-checkout'};});
 const user={uid:'u',name:'Test',email:'test@example.com'};
 await assert.rejects(()=>service.startCheckout(user,false),{code:'CONSENT_REQUIRED'});assert.equal(count,0);
 const outcomes=await Promise.allSettled([service.startCheckout(user,true),service.startCheckout(user,true)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(count,1);
 const first=outcomes.find(x=>x.status==='fulfilled').value;
 assert.deepEqual(await service.startCheckout(user,true),first);assert.equal(count,1);transport.mock.restore();
});
test('malformed renewal responses stay unresolved for safe reconciliation',async()=>{
 setup();due();const transport=fakeFetch(()=>({}));await assert.rejects(()=>service.renewSubscription('u'),{code:'RENEWAL_UNVERIFIED'});assert.equal(rows.get('billingSubscriptions/u').renewalPending,true);assert.equal(rows.get('billingSubscriptions/u').autoRenew,true);assert.equal(rows.has('memberships/u'),false);transport.mock.restore();
});

test('new account status loads with billing disabled without needing the history index',async()=>{
 setup();process.env.BILLING_ENABLED='false';historyError=Object.assign(new Error('requires an index'),{code:9});
 const status=await service.billingStatus('new-user');
 assert.equal(status.available,false);assert.equal(status.autoRenew,false);assert.deepEqual(status.payments,[]);assert.equal(status.historyAvailable,true);assert.equal(historyRequests,0);
});
test('missing history index never prevents active subscription controls from loading',async()=>{
 setup();due();historyError=Object.assign(new Error('requires an index: private diagnostic'),{code:9});
 const warning=mock.method(console,'warn',()=>{});
 const status=await service.billingStatus('u');
 assert.equal(status.autoRenew,true);assert.equal(status.status,'active');assert.equal(status.historyAvailable,false);assert.deepEqual(status.payments,[]);
 assert.deepEqual(warning.mock.calls[0].arguments,['billing_history_unavailable']);warning.mock.restore();
});
test('payment history returns only the current members paid records and no payment credentials',async()=>{
 setup();due();rows.set('billingOrders/a',{uid:'u',status:'paid',amountAgorot:1999,paidAt:Timestamp.now(),documentNumber:10,token:'private-token'});
 rows.set('billingOrders/b',{uid:'other',status:'paid',amountAgorot:1999,paidAt:Timestamp.now()});
 rows.set('billingOrders/c',{uid:'u',status:'pending'});
 const status=await service.billingStatus('u');assert.equal(status.historyAvailable,true);assert.equal(status.payments.length,1);assert.equal(status.payments[0].documentNumber,10);assert.equal(JSON.stringify(status).includes('private-token'),false);
});
