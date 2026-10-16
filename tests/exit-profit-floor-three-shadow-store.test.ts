import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileThreeExitFloorShadowStore} from "../lib/exit-profit-floor-three-shadow-store";
import {observeThreeFloorH1History} from "../lib/exit-profit-floor-three-observers";
import {EXIT_FLOOR_HOUR_MS as H} from "../lib/exit-profit-floor-three";
const ts=410*H;
const ident={owner:"Q102" as const,family:"MR",symbol:"BTCUSDT",
 side:"LONG" as const,entryTs:ts,entryPrice:100,entryQuantity:5,
 legId:"Q102:BTCUSDT:"+ts+":1"};
const candles=(entries:[number,number][])=>entries.map(([i,p])=>
 ({timestampMs:ts+i*H,open:p,high:p+1,low:p-1,close:p}));
const tracked=()=>observeThreeFloorH1History({identity:ident,
 closedCandles:candles([[0,103.5]]),observedAt:ts+H}).state!;
async function withStore(fn:(s:FileThreeExitFloorShadowStore,path:string)=>Promise<void>){
 const d=mkdtempSync(join(tmpdir(),"three-exit-floor-sidecar-")),path=join(d,"profit-floor.json");
 try{await fn(new FileThreeExitFloorShadowStore(path,"Q102"),path);}
 finally{rmSync(d,{recursive:true,force:true});}
}
test("separate sidecar starts empty then persists an armed profit floor across restarts",async()=>{
 await withStore(async(store,path)=>{
  assert.equal(await store.load(ident.legId),undefined);
  const state=tracked();
  await store.save(state);
  assert.deepEqual(await new FileThreeExitFloorShadowStore(path,"Q102").load(ident.legId),state);
  await store.save(state);
  const value=JSON.parse(readFileSync(path,"utf8"));
  assert.deepEqual(Object.keys(value).sort(),["byLegId","owner","schema"]);
  assert.equal(value.owner,"Q102");
 });
});
test("cannot overwrite a previous H1 with lower best profit, wrong owner, or disabled arm",async()=>{
 await withStore(async(store)=>{
  const previous=tracked();await store.save(previous);
  for(const s of [
   {...previous,highWaterCloseReturn:0},
   {...previous,armed:false},
   {...previous,owner:"V12_V4" as const},
  ])await assert.rejects(store.save(s));
 });
});
test("cannot advance sidecar past missing intermediate confirmed bar",async()=>{
 await withStore(async(store)=>{
  const previous=tracked();await store.save(previous);
  const future={...previous,lastClosedH1OpenTs:ts+2*H};
  await assert.rejects(store.save(future),/H1_GAP/);
 });
});
test("sidecar malformed on disk fails closed and is never silently overwritten",async()=>{
 await withStore(async(store,path)=>{
  await store.save(tracked());
  writeFileSync(path,'{"schema":"three-exit-profit-floor-shadow/v1","owner":"PENGU","byLegId":{}}');
  await assert.rejects(store.load(ident.legId),/SCHEMA_MISMATCH/);
  await assert.rejects(store.save(tracked()),/SCHEMA_MISMATCH/);
 });
});
test("cross-owner Q102 sidecar cannot be opened as V4",async()=>{
 await withStore(async(store,path)=>{
  await store.save(tracked());
  await assert.rejects(
   new FileThreeExitFloorShadowStore(path,"V12_V4").load(ident.legId),
   /SCHEMA_MISMATCH/);
 });
});
test("shadow-only sidecar does not import or mutate any LIVE trading state",async()=>{
 await withStore(async(store,path)=>{
  const s=tracked();await store.save(s);
  assert.ok(readFileSync(path,"utf8").includes("three-exit-profit-floor-shadow/v1"));
  assert.equal(Object.keys(s).includes("ordersSent"),false);
 });
});
