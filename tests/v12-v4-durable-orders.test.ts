import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {V4DurableOrderDispatcher} from "../lib/v12-v4-durable-orders";
test("ambiguous send is journaled and absent order lookup never resubmits",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-send-"));
 try{
 const store=new V4ExecutionStore(join(dir,"state.json"),"a".repeat(40));
 store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
 let sends=0,reservations=0;
 const gateway:any={executeEntry:async()=>{sends++;throw Error("transport disconnected");},queryOrderSameId:async()=>null};
 const guards={assertAuthority:async()=>{},assertAccountLease:async()=>{},reserveShared:async()=>{reservations++;}};
 const bridge=new V4DurableOrderDispatcher(store,gateway,guards);
 const cid=bridge.prepare({legId:"XRPUSDT:route:LONG:3600000",action:"ENTRY",sequence:0,symbol:"XRPUSDT",positionSide:"LONG",quantity:2,price:100,signalTs:3600000},3600000);
 await assert.rejects(()=>bridge.submit(cid,3600001),/transport disconnected/);
 assert.equal(store.read().intents[cid].stage,"UNKNOWN");
 const recovered=new V4DurableOrderDispatcher(store,gateway,guards);
 assert.equal(await recovered.reconcile(cid,3600002),null);
 await assert.rejects(()=>recovered.submit(cid,3600003),/RECONCILIATION_REQUIRED/);
 assert.equal(sends,1);assert.equal(reservations,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("authority rejection performs no reservation or order mutation",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-send-"));
 try{
 const store=new V4ExecutionStore(join(dir,"state.json"),"a".repeat(40));
 store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
 let mutations=0;
 const bridge=new V4DurableOrderDispatcher(store,{executeEntry:async()=>{mutations++;}} as any,{
 assertAuthority:async()=>{throw Error("CERTIFICATION_FAILED");},assertAccountLease:async()=>{},reserveShared:async()=>{mutations++;}});
 const cid=bridge.prepare({legId:"XRPUSDT:r:LONG:3600000",action:"ENTRY",sequence:0,symbol:"XRPUSDT",positionSide:"LONG",quantity:2,price:100,signalTs:3600000},3600000);
 await assert.rejects(()=>bridge.submit(cid,3600001),/CERTIFICATION_FAILED/);
 assert.equal(mutations,0);assert.equal(store.read().intents[cid].stage,"PREPARED");
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("reduce-only exit routes through existing executor without reserving new gross",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-exit-"));
 try{
 const store=new V4ExecutionStore(join(dir,"state.json"),"a".repeat(40));
 store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
 let received:any,reservations=0;
 const gateway:any={executeExit:async(input:any)=>{received=input;return {executionUnknown:false};},
 queryOrderSameId:async()=>({symbol:"XRPUSDT",clientOrderId:received.clientOrderId,side:"SELL",status:"FILLED",reduceOnly:true})};
 const bridge=new V4DurableOrderDispatcher(store,gateway,{assertAuthority:async()=>{},assertAccountLease:async()=>{},reserveShared:async()=>{reservations++;}});
 const cid=bridge.prepare({legId:"XRPUSDT:r:LONG:3600000",action:"EXIT",sequence:0,symbol:"XRPUSDT",positionSide:"LONG",quantity:2,price:100,signalTs:3600000},3600000);
 await bridge.submit(cid,3600001);
 assert.equal(received.positionSide,"LONG");assert.equal(received.clientOrderId,cid);assert.equal(reservations,0);
 await bridge.reconcile(cid,3600002);
 assert.equal(store.read().intents[cid].stage,"TERMINAL");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("readback of a non-reduce-only exit fails before terminal acknowledgement",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-exit-"));
 try{
 const store=new V4ExecutionStore(join(dir,"state.json"),"a".repeat(40));
 store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
 let cid="";
 const gateway:any={executeExit:async()=>({executionUnknown:false}),queryOrderSameId:async()=>({symbol:"XRPUSDT",clientOrderId:cid,side:"SELL",status:"FILLED",reduceOnly:false})};
 const bridge=new V4DurableOrderDispatcher(store,gateway,{assertAuthority:async()=>{},assertAccountLease:async()=>{},reserveShared:async()=>{}});
 cid=bridge.prepare({legId:"XRPUSDT:r:LONG:3600000",action:"EXIT",sequence:0,symbol:"XRPUSDT",positionSide:"LONG",quantity:2,price:100,signalTs:3600000},3600000);
 await bridge.submit(cid,3600001);
 await assert.rejects(()=>bridge.reconcile(cid,3600002),/NOT_REDUCE_ONLY/);
 assert.equal(store.read().intents[cid].stage,"ACKNOWLEDGED");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
