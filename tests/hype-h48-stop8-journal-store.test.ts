import {strict as assert} from "node:assert";
import {test} from "node:test";
import {mkdtemp,rm,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileH48Stop8Store} from "../lib/hype-h48-stop8-journal-store";
import {makeH48Stop8Intent,type H48Stop8Intent} from "../lib/hype-h48-resident-stop8";
import type {AccountLockHandle} from "../lib/disdex-account-order-lock";
import type {H48SignedVenueSnapshot} from "../lib/hype-h48-execution-journal";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d",PLAN="b".repeat(64);
const now=()=>Date.now();
const entry=()=>makeH48Stop8Intent({
  sourceSha:SHA,planSha256:PLAN,positionId:"H48|HYPEUSDT|1795478400000",
  entryClientOrderId:"h48e-"+"1".repeat(30),
  entryPrice:100,quantity:2,tickSize:0.1,now:now()-1000,
});
function lease():AccountLockHandle{
  const acquired=now()-1000,expires=now()+300000;
  return {
    ownerId:"test",leaseId:"lease-"+SHA,acquiredAt:acquired,renewalIntervalMs:1000,
    document:async()=>({
      schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
      ownerId:"test",leaseId:"lease-"+SHA,acquiredAt:acquired,
      expiresAt:expires,reservations:[],
    }),
    renew:async()=>{throw Error("NO_RENEW")},reserve:async()=>{throw Error("NO_RESERVE")},
    releaseReservation:async()=>{},release:async()=>{},
  };
}
function venue(i:H48Stop8Intent,withStop=false):H48SignedVenueSnapshot{
  return {
    source:"ASTER_SIGNED_READ_ONLY",observedAt:now()-50,
    positions:[{
      symbol:"HYPEUSDT",quantity:2,entryPrice:100,
      markPrice:100,unrealizedPnl:0,pnlPct:0,notionalUsd:200,
      positionSide:"BOTH",leverage:5,updatedAt:now()-50,
    }],
    openOrders:withStop?[{
      symbol:"HYPEUSDT",clientOrderId:i.stopClientOrderId,
      type:"STOP_MARKET",side:"SELL",reduceOnly:true,status:"NEW",
      stopPrice:i.stopPrice,quantity:2,executedQuantity:0,
    }]:[],
  };
}
async function tmpFile(){
  const folder=await mkdtemp(join(tmpdir(),"h48-stop8-store-"));
  return {folder,path:join(folder,"h48-stop8.json")};
}
test("H48 STOP8 fsynced PREPARED -> SUBMITTED -> signed CONFIRMED",async()=>{
  const t=await tmpFile();
  try{
    const i=entry(),lock=lease(),store=new FileH48Stop8Store(t.path,SHA,PLAN);
    await assert.rejects(store.load(),/ENOENT/);
    await store.initialize({intent:i,lease:lock,signedVenue:venue(i),now:now()});
    assert.deepEqual(await store.load(),i);
    const submitted={...i,stage:"SUBMITTED" as const,submittedAt:now()};
    await store.save(i,submitted,lock);
    assert.deepEqual(await store.load(),submitted);
    const at=now(),snap=venue(submitted,true);
    const confirmed={...submitted,stage:"CONFIRMED" as const,confirmedAt:at};
    await store.save(submitted,confirmed,lock,{venue:snap,now:at});
    assert.deepEqual(await store.load(),confirmed);
    await assert.rejects(store.save(confirmed,submitted,lock),/ILLEGAL_TRANSITION/);
  }finally{await rm(t.folder,{recursive:true,force:true})}
});
test("untrusted venue inventory blocks initial creation without deleting anything",async()=>{
  const t=await tmpFile();
  try{
    const i=entry(),store=new FileH48Stop8Store(t.path,SHA,PLAN),lock=lease();
    for(const bad of [
      {...venue(i),positions:[]},
      {...venue(i),openOrders:[{symbol:"HYPEUSDT",clientOrderId:"OTHER",quantity:2,executedQuantity:0}]},
      {...venue(i),observedAt:now()-300000},
    ]){
      await assert.rejects(store.initialize({intent:i,lease:lock,signedVenue:bad,now:now()}));
    }
    await assert.rejects(store.load(),/ENOENT/);
  }finally{await rm(t.folder,{recursive:true,force:true})}
});
test("after STOP8 SUBMITTED a replay initialization is rejected and no reset occurs",async()=>{
  const t=await tmpFile();
  try{
    const i=entry(),lock=lease(),store=new FileH48Stop8Store(t.path,SHA,PLAN);
    await store.initialize({intent:i,lease:lock,signedVenue:venue(i),now:now()});
    const submitted={...i,stage:"SUBMITTED" as const,submittedAt:now()};
    await store.save(i,submitted,lock);
    await assert.rejects(store.initialize({intent:i,lease:lock,signedVenue:venue(i),now:now()}),/PRIOR_INTENT_ALREADY_EXISTS/);
    assert.deepEqual(await store.load(),submitted);
  }finally{await rm(t.folder,{recursive:true,force:true})}
});
test("a forged STOP8 CONFIRMED transition without independent signed readback is rejected",async()=>{
  const t=await tmpFile();
  try{
    const i=entry(),lock=lease(),store=new FileH48Stop8Store(t.path,SHA,PLAN);
    await store.initialize({intent:i,lease:lock,signedVenue:venue(i),now:now()});
    const submitted={...i,stage:"SUBMITTED" as const,submittedAt:now()};
    await store.save(i,submitted,lock);
    const confirmed={...submitted,stage:"CONFIRMED" as const,confirmedAt:now()};
    await assert.rejects(store.save(submitted,confirmed,lock),/VENUE_READBACK_REQUIRED/);
    await assert.rejects(store.save(submitted,confirmed,lock,{venue:venue(submitted),now:confirmed.confirmedAt!}),/UNMANAGED_OR_MISSING_STOP/);
    assert.deepEqual(await store.load(),submitted);
  }finally{await rm(t.folder,{recursive:true,force:true})}
});
test("a stale, changed or concurrent STOP8 writer cannot replace durable SUBMITTED state",async()=>{
  const t=await tmpFile();
  try{
    const i=entry(),lock=lease(),store=new FileH48Stop8Store(t.path,SHA,PLAN);
    await store.initialize({intent:i,lease:lock,signedVenue:venue(i),now:now()});
    const submitted={...i,stage:"SUBMITTED" as const,submittedAt:now()};
    await store.save(i,submitted,lock);
    await assert.rejects(store.save(i,submitted,lock),/STALE_OR_CONFLICTED/);
    const confirmed={...submitted,stage:"CONFIRMED" as const,confirmedAt:now()};
    await writeFile(t.path+".writer.lock","busy\n");
    await assert.rejects(store.save(submitted,confirmed,lock,{venue:venue(submitted,true),now:confirmed.confirmedAt!}),/EXCLUSIVE_WRITER_CONFLICT/);
    assert.deepEqual(await store.load(),submitted);
  }finally{await rm(t.folder,{recursive:true,force:true})}
});
test("wrong SHA and broken JSON are never silently reset to PREPARED",async()=>{
  const t=await tmpFile();
  try{
    const i=entry(),lock=lease(),store=new FileH48Stop8Store(t.path,SHA,PLAN);
    await store.initialize({intent:i,lease:lock,signedVenue:venue(i),now:now()});
    await assert.rejects(new FileH48Stop8Store(t.path,"f".repeat(40),PLAN).load(),/SOURCE_PLAN_MISMATCH/);
    await writeFile(t.path,"{ BROKEN JSON");
    await assert.rejects(store.load());
  }finally{await rm(t.folder,{recursive:true,force:true})}
});
