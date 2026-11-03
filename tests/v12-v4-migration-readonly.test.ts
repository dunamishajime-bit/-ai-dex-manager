import test from 'node:test';
import assert from 'node:assert/strict';
import {createV4MigrationReadOnlyFetch} from '../lib/v12-v4-migration-readonly';
test('migration transport permits only exact Aster signed GET inventory endpoints with redirect errors',async()=>{
 const sent:unknown[]=[];
 const fetcher=createV4MigrationReadOnlyFetch((async(input,init)=>{sent.push([String(input),init?.redirect]);return new Response('[]');}) as typeof fetch);
 for(const endpoint of ['balance','positionRisk','openOrders'])await fetcher('https://fapi.asterdex.com/fapi/v3/'+endpoint,{method:'GET'});
 assert.equal(sent.length,3);assert.ok(sent.every(row=>(row as any)[1]==='error'));
 for(const [url,method] of [['https://fapi.asterdex.com/fapi/v3/order','POST'],['https://fapi.asterdex.com/fapi/v3/balance','DELETE'],['https://other.invalid/fapi/v3/balance','GET'],['https://fapi.asterdex.com/fapi/v3/order','GET'],['http://fapi.asterdex.com/fapi/v3/balance','GET']])
  await assert.rejects(fetcher(url,{method}),/V4_MIGRATION_READ_ONLY/);
 assert.equal(sent.length,3);
});
