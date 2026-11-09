import { test } from 'node:test';
import assert from 'node:assert/strict';
import { options, prepare } from '../scripts/prepare-cardcom.mjs';
test('preparation makes only a read-only Cardcom call and writes pinned references without values',async()=>{
 const logs=[];let output;const requests=[];let probeBody;
 const secrets={'cardcom-terminal-number':'12345','cardcom-api-name':'DO_NOT_PRINT_THIS_API_NAME'};
 const client={getAccessToken:async()=>({token:'DO_NOT_PRINT_THIS_TOKEN'}),request:async({url})=>{
   requests.push(url);
   if(url.startsWith('https://run.googleapis.com/'))return {data:{template:{containers:[{image:'me-west1-docker.pkg.dev/freelance-514118/freelance/engine@sha256:test',env:[{name:'GOOGLE_SIGN_IN_ENABLED',value:'true'},{name:'NANGO_API_KEY',valueSource:{secretKeyRef:{secret:'NANGO_API_KEY',version:'7'}}}]}]}}};
   const name=Object.keys(secrets).find(name=>url.includes('/secrets/'+name+'/'));
   if(url.endsWith(':access'))return {data:{payload:{data:Buffer.from(secrets[name]).toString('base64')}}};
   return {data:{name:`projects/crypto-coral-328619/secrets/${name}/versions/4`,state:'ENABLED'}};
 }};
 const result=await prepare(options([]),{auth:{getClient:async()=>client},transport:async(url,init)=>{
   assert.equal(url,'https://secure.cardcom.solutions/api/v11/Transactions/GetTransactionByExternalUniqTran');
   probeBody=JSON.parse(init.body);return Response.json({ResponseCode:9999,Description:'ignored raw response'});
 },save:async(path,text,opts)=>{assert.equal(opts.flag,'wx');output=text;},report:line=>logs.push(line)});
 assert.equal(probeBody.TerminalNumber,12345);assert.equal(probeBody.ApiName,secrets['cardcom-api-name']);
 assert.equal(result.vars.billing_enabled,false);assert.equal(result.vars.cardcom_secrets.CARDCOM_API_NAME.version,'4');
 assert.equal(result.vars.nango_secret_version,'7');assert.equal(result.vars.google_sign_in_enabled,true);
 assert.equal(output.includes(secrets['cardcom-api-name']),false);assert.equal(logs.join('').includes(secrets['cardcom-api-name']),false);
 assert.equal(logs.join('').includes('DO_NOT_PRINT_THIS_TOKEN'),false);assert.equal(logs.join('').includes('ignored raw response'),false);
 assert.ok(requests.every(url=>url.startsWith('https://secretmanager.googleapis.com/')||url.startsWith('https://run.googleapis.com/')));
});
test('unavailable cloud auth stops before accessing secrets or contacting Cardcom',async()=>{
 let called=false;
 await assert.rejects(()=>prepare(options([]),{auth:{getClient:async()=>{throw Error('private failure');}},transport:async()=>{called=true;}}),{message:'GCP_AUTH_UNAVAILABLE'});
 assert.equal(called,false);
});
test('resource names reject URLs and arbitrary paths',()=>{
 assert.throws(()=>options(['--secret-project','https://example.com']),{message:'INVALID_RESOURCE_NAME'});
});
