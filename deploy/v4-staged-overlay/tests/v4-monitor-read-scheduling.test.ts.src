import test from 'node:test';
import assert from 'node:assert/strict';
import {collectV4MonitorReads} from '../lib/v12-v4-monitor-only';

test('private reads complete before market reads without overlapping heavy budget reservations',async()=>{
 const events:string[]=[];let active=0,maxActive=0;
 const read=(name:string)=>async()=>{events.push(name);active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,2));active--;return name;};
 const result=await collectV4MonitorReads({positions:read('positions'),openOrders:read('orders'),decision:read('market')});
 assert.deepEqual(events,['positions','orders','market']);assert.equal(maxActive,1);
 assert.deepEqual(result,{positions:'positions',openOrders:'orders',decision:'market'});
});

test('a rejected private read never advances to a market decision or reports success',async()=>{
 let market=false;
 await assert.rejects(()=>collectV4MonitorReads({positions:async()=>{throw Error('BUDGET_DENIED');},openOrders:async()=>[],decision:async()=>{market=true;return {};} }),/BUDGET_DENIED/);
 assert.equal(market,false);
});
