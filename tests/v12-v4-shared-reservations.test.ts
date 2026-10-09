import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {planProductionEntry,createProductionState,applyProductionEvent,HOUR} from "../lib/v12-v4-production-lifecycle";
import {V4ExecutionStore,v4OrderIdentity,advanceV4Intent} from "../lib/v12-v4-execution-store";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {readPendingExposureRegistry,upsertPendingExposure} from "../lib/disdex-pending-exposure-registry";
import {V4SharedReservations} from "../lib/v12-v4-shared-reservations";
async function setup(withSecond=false){
 const dir=mkdtempSync(join(tmpdir(),"v4-shared-")),pending=join(dir,"pending.json"),lockPath=join(dir,"account.lock"),sha="a".repeat(40);
 const at=Date.now(),ts=Math.floor(at/HOUR)*HOUR;
 const raw=adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0];
 const candidate={...raw,eligibleEntryTs:ts,sourceSignalTs:ts,requestedGross:.5};
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const reserve=await planProductionEntry(state,{candidate,ts,eventId:"reserve",referencePrice:100,minimumOrderNotionalUsd:5,
 quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,quantityText:String(q),notional:q*p})} as any});
 state=applyProductionEvent(state,reserve);
 let secondPlan:Awaited<ReturnType<typeof planProductionEntry>>|undefined;
 if(withSecond){
  const other={...candidate,symbol:candidate.symbol==="ETHUSDT"?"SOLUSDT":"ETHUSDT"};
  secondPlan=await planProductionEntry(state,{candidate:other,ts,eventId:"reserve-second",referencePrice:100,minimumOrderNotionalUsd:5,quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,quantityText:String(q),notional:q*p})} as any});
  state=applyProductionEvent(state,secondPlan);
 }
 state=applyProductionEvent(state,{type:"ACCOUNT_MARK",eventId:"fresh-account",ts:at,equityUsd:1000,prices:{[candidate.symbol]:100},foreign:[]});
 const store=new V4ExecutionStore(join(dir,"state.json"),sha);let doc=store.initialize(state.initial);
 const id=reserve.leg.id,cid=v4OrderIdentity(sha,id,"ENTRY",0);
 const command={legId:id,action:"ENTRY" as const,sequence:0,symbol:candidate.symbol,positionSide:candidate.effectiveSide,quantity:5,price:100,signalTs:ts};
 doc=store.commit(doc.revision,{...doc,state,intents:{[cid]:{clientOrderId:cid,legId:id,action:"ENTRY",sequence:0,stage:"PREPARED",createdAt:at,updatedAt:at,command}}});
 let second:{cid:string;command:typeof command}|undefined;
 if(secondPlan){
  const cid2=v4OrderIdentity(sha,secondPlan.leg.id,"ENTRY",0);
  const command2={...command,legId:secondPlan.leg.id,symbol:secondPlan.leg.candidate.symbol};
  doc=store.commit(doc.revision,{...doc,intents:{...doc.intents,[cid2]:{clientOrderId:cid2,legId:command2.legId,action:"ENTRY",sequence:0,stage:"PREPARED",createdAt:at,updatedAt:at,command:command2}}});
  second={cid:cid2,command:command2};
 }
 const lock=new FileAccountOrderLock(lockPath,120000,pending);const handle=(await lock.acquire("V12_V4_TEST"))!;
 return {dir,pending,lock,handle,store,id,cid,command,at,second,manager:new V4SharedReservations(store,handle,pending)};
}
test("shared reservation survives account-lock release and is not duplicated after reacquisition",async()=>{
 const x=await setup();
 try{
 await x.manager.reserve(x.cid,x.command);await x.handle.release();
 const handle=(await x.lock.acquire("V12_V4_RESTART"))!;
 try{await new V4SharedReservations(x.store,handle,x.pending).reserve(x.cid,x.command);}finally{await handle.release();}
 const registry=await readPendingExposureRegistry(x.pending);
 assert.equal(registry.entries.length,1);assert.equal(registry.entries[0].reservationId,x.cid);
 assert.equal(registry.entries[0].strategyId,"V12_V4");assert.equal(registry.entries[0].notionalUsd,500);
 }finally{rmSync(x.dir,{recursive:true,force:true});}
});
test("unknown submission retains shared exposure and cannot be released from an order ACK",async()=>{
 const x=await setup();
 try{
 await x.manager.reserve(x.cid,x.command);
 let doc=x.store.read();doc=x.store.commit(doc.revision,advanceV4Intent(doc,x.cid,"SUBMITTING",x.at));
 doc=x.store.commit(doc.revision,advanceV4Intent(doc,x.cid,"UNKNOWN",x.at));
 await x.manager.synchronize(x.cid);
 const row=(await readPendingExposureRegistry(x.pending)).entries[0];
 assert.equal(row.status,"UNKNOWN");assert.equal(row.notionalUsd,500);
 doc=x.store.commit(doc.revision,advanceV4Intent(doc,x.cid,"TERMINAL",x.at));
 await assert.rejects(()=>x.manager.synchronize(x.cid),/VERIFIED_TERMINAL_FILL_JOURNAL_REQUIRED/);
 assert.notEqual((await readPendingExposureRegistry(x.pending)).entries[0].status,"RELEASED");
 }finally{await x.handle.release();rmSync(x.dir,{recursive:true,force:true});}
});
test("partial fill reduces only unfilled reservation while recorded position retains gross",async()=>{
 const x=await setup();
 try{
 await x.manager.reserve(x.cid,x.command);
 let doc=x.store.read();doc=x.store.commit(doc.revision,advanceV4Intent(doc,x.cid,"SUBMITTING",x.at));
 doc=x.store.commit(doc.revision,advanceV4Intent(doc,x.cid,"ACKNOWLEDGED",x.at));
 const state=applyProductionEvent(doc.state,{type:"ENTRY_FILL",eventId:"venue-trade:"+x.command.symbol+":7",ts:x.at,id:x.id,qty:2,price:100,feeUsd:.2});
 x.store.commit(doc.revision,{...doc,state});await x.manager.synchronize(x.cid);
 assert.equal((await readPendingExposureRegistry(x.pending)).entries[0].notionalUsd,300);
 assert.equal(x.store.read().state.legs[x.id].entryNotional,200);
 }finally{await x.handle.release();rmSync(x.dir,{recursive:true,force:true});}
});
test("reservation fails closed when account lease was released",async()=>{
 const x=await setup();await x.handle.release();
 try{
 await assert.rejects(()=>x.manager.reserve(x.cid,x.command),/ACCOUNT_LOCK_RELEASED/);
 assert.equal((await readPendingExposureRegistry(x.pending)).entries.length,0);
 }finally{rmSync(x.dir,{recursive:true,force:true});}
});
test("peer reservation missing from the current account ledger prevents another admission",async()=>{
 const x=await setup();
 try{
 await upsertPendingExposure({reservationId:"peer",strategyId:"PENGU_DUAL_LS_V2_FINAL",sleeve:"CRYPTO",symbol:"PENGUUSDT",side:"SHORT",gross:3.25,notionalUsd:3250,createdAt:x.at},x.pending);
 await assert.rejects(()=>x.manager.reserve(x.cid,x.command),/PEER_RESERVATION_NOT_IN_ACCOUNT_LEDGER/);
 assert.equal((await readPendingExposureRegistry(x.pending)).entries.length,1);
 }finally{await x.handle.release();rmSync(x.dir,{recursive:true,force:true});}
});

test("order bridge restart releases shared reservation only after verified fills are durably recorded",async()=>{
 const x=await setup();
 try{
 const {V4DurableOrderDispatcher}=await import("../lib/v12-v4-durable-orders");
 const {bindV4SharedDispatchGuards}=await import("../lib/v12-v4-shared-reservations");
 const {reconcileV4EntryTrades}=await import("../lib/v12-v4-venue-fills");
 let sends=0;
 const order={symbol:x.command.symbol,clientOrderId:x.cid,orderId:42,status:"FILLED",side:"SELL" as const,quantity:5,executedQuantity:5,averagePrice:100,quoteQuantity:500};
 const gateway:any={executeEntry:async()=>{sends++;return {executionUnknown:false};},queryOrderSameId:async()=>order};
 const guards=bindV4SharedDispatchGuards(x.manager,async()=>{});
 const bridge=new V4DurableOrderDispatcher(x.store,gateway,guards);
 await bridge.submit(x.cid,x.at);
 const restored=new V4DurableOrderDispatcher(x.store,gateway,guards);
 await restored.reconcile(x.cid,x.at+1);
 assert.equal(x.store.read().intents[x.cid].venueOrderId,"42");
 await assert.rejects(()=>x.manager.synchronize(x.cid),/VERIFIED_TERMINAL_FILL_JOURNAL_REQUIRED/);
 let doc=x.store.read();
 const state=reconcileV4EntryTrades(doc.state,x.id,x.cid,{order,trades:[{symbol:x.command.symbol,id:7,orderId:42,side:"SELL",price:"100",qty:"5",commission:".5",commissionAsset:"USDT",time:x.at}]},x.at+1);
 x.store.commit(doc.revision,{...doc,state});
 await x.manager.synchronize(x.cid);
 assert.equal((await readPendingExposureRegistry(x.pending)).entries[0].status,"RELEASED");
 assert.equal(x.store.read().state.legs[x.id].qty,5);
 assert.equal(x.store.read().state.legs[x.id].feesUsd,.5);assert.equal(sends,1);
 }finally{await x.handle.release();rmSync(x.dir,{recursive:true,force:true});}
});

test("concurrent managers sharing one account lease preserve both reservations",async()=>{
 const x=await setup(true);
 try{
 const second=new V4SharedReservations(x.store,x.handle,x.pending);
 await Promise.all([x.manager.reserve(x.cid,x.command),second.reserve(x.second!.cid,x.second!.command)]);
 const rows=(await readPendingExposureRegistry(x.pending)).entries;
 assert.equal(rows.length,2);assert.equal(rows.reduce((n,row)=>n+row.notionalUsd,0),1000);
 }finally{await x.handle.release();rmSync(x.dir,{recursive:true,force:true});}
});
