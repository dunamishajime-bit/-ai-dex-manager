import assert from 'node:assert/strict';
import test from 'node:test';
import {createAsterReadonlyEvidenceFetch,assertSharedAsterReadBudget} from '../lib/aster-readonly-evidence-fetch';

test('evidence transport rejects every mutation, other host and unreviewed endpoint before fetch',async()=>{
 let calls=0;
 const client=createAsterReadonlyEvidenceFetch((async()=>{calls++;return new Response('{}');}) as typeof fetch);
 for(const method of ['POST','DELETE','PUT','PATCH']){
  await assert.rejects(client('https://fapi.asterdex.com/fapi/v3/openOrders',{method}),/HTTP_NOT_ALLOWED/);
 }
 for(const url of ['https://evil.example/fapi/v3/balance','http://fapi.asterdex.com/fapi/v3/balance',
   'https://fapi.asterdex.com/fapi/v3/order','not-a-url']){
  await assert.rejects(client(url),/HTTP_NOT_ALLOWED/);
 }
 assert.equal(calls,0);
});

test('reviewed signed GETs cannot follow redirects and require the shared budget',async()=>{
 let redirected:any;
 const client=createAsterReadonlyEvidenceFetch((async(_url,init)=>{redirected=init?.redirect;return new Response('{}');}) as typeof fetch);
 await client('https://fapi.asterdex.com/fapi/v3/positionRisk',{method:'GET',redirect:'follow'});
 assert.equal(redirected,'error');
 assert.doesNotThrow(()=>assertSharedAsterReadBudget('/var/lib/disdex/shared/aster-rate-budget.json'));
 for(const path of [undefined,'','/tmp/private-budget.json'])assert.throws(()=>assertSharedAsterReadBudget(path),/SHARED_RATE_BUDGET_REQUIRED/);
});
