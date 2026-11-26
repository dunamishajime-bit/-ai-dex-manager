import {strict as assert} from "node:assert";
import {test} from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {H48Stop8RetirementCoordinator} from "../lib/hype-h48-stop8-retirement";
import {FileH48Stop8RetirementStore} from "../lib/hype-h48-stop8-retirement-store";
import {makeH48Stop8Intent,type H48Stop8Intent} from "../lib/hype-h48-resident-stop8";
import type {H48SignedVenueSnapshot} from "../lib/hype-h48-execution-journal";
import type {AccountLockHandle} from "../lib/disdex-account-order-lock";
import type {AsterV3Client} from "../lib/aster-v3-client";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d";
const PLAN="c".repeat(64);
const id="H48|HYPEUSDT|"+Date.UTC(2026,10,24,0);
const entry="h48e-"+"e".repeat(30);
const now=()=>Date.now();
function stop():H48Stop8Intent{
  const t=now();
  return {...makeH48Stop8Intent({sourceSha:SHA,planSha256:PLAN,positionId:id,
    entryClientOrderId:entry,entryPrice:100,quantity:2,tickSize:0.1,now:t-3000}),
    stage:"CONFIRMED",submittedAt:t-2000,confirmedAt:t-1000};
}
function lease():AccountLockHandle{
  const start=now()-1000,end=now()+90_000;
  return {ownerId:"h48-test",leaseId:"lease1",acquiredAt:start,renewalIntervalMs:1000,
    document:async()=>({schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
      ownerId:"h48-test",leaseId:"lease1",acquiredAt:start,expiresAt:end,reservations:[]}),
    renew:async()=>{throw Error("NO_RENEW")},reserve:async()=>{throw Error("NO_RESERVE")},
    releaseReservation:async()=>{},release:async()=>{},
  };
}
function signed(s:H48Stop8Intent,opts:{
  open?:boolean;position?:boolean;wrongOrder?:boolean;dup?:boolean;
}={}):H48SignedVenueSnapshot{
  const order={symbol:"HYPEUSDT",clientOrderId:opts.wrongOrder?"ROGUE":s.stopClientOrderId,
    type:"STOP_MARKET",side:"SELL" as const,reduceOnly:true,
    stopPrice:s.stopPrice,status:"NEW",quantity:s.quantity,executedQuantity:0};
  return {source:"ASTER_SIGNED_READ_ONLY",observedAt:now(),
    positions:opts.position?[{symbol:"HYPEUSDT",quantity:2,entryPrice:100,markPrice:100,
      pnlPct:0,unrealizedPnl:0,notionalUsd:200,
      positionSide:"BOTH",leverage:5,updatedAt:now()}]:[],
    openOrders:opts.open===false?[]:opts.dup?[order,order]:[order],
  };
}
async function fixture(options:{
  open?:boolean;position?:boolean;wrongOrder?:boolean;dup?:boolean;
  deny?:boolean;unknown?:boolean;afterStillOpen?:boolean;
}={}){
  const folder=await mkdtemp(join(tmpdir(),"h48-retire-")),journal=stop();
  const store=new FileH48Stop8RetirementStore(join(folder,"retire.json"),SHA,PLAN);
  const lock=lease();
  let cancelCount=0,readCount=0,authorized=0,canceled=false;
  const dep={
    sourceSha:SHA,planSha256:PLAN,
    stopJournal:{load:async()=>journal},
    retireStore:store,lease:lock,
    ownerAuthority:{assertSignedResidentStop8:async()=>{
      authorized++;
      if(options.deny)throw Error("STOP_ROOT_GRANT_NOT_ISSUED");
    }},
    readSignedVenue:async()=>{
      readCount++;
      return signed(journal,{open:canceled&&!options.afterStillOpen?false:options.open,
        position:options.position,wrongOrder:options.wrongOrder,dup:options.dup});
    },
    venue:{cancelOrder:async(_symbol:string,clientOrderId:string)=>{
      cancelCount++;
      assert.equal(clientOrderId,journal.stopClientOrderId);
      const state=await store.load();
      assert.equal(state.phase,"CANCEL_SUBMITTED","persist DELETE intent first");
      canceled=true;
      if(options.unknown)throw Error("CANCEL_HTTP_TIMEOUT");
      return {status:"CANCELED"};
    }} as Pick<AsterV3Client,"cancelOrder">,
    now,
  };
  const coordinator=new H48Stop8RetirementCoordinator(dep);
  return {folder,journal,store,coordinator,
    getCancelCount:()=>cancelCount,getReadCount:()=>readCount,
    getAuthorized:()=>authorized};
}
const cleanup=async(f:{folder:string})=>rm(f.folder,{recursive:true,force:true});
test("signed FLAT plus one owned STOP permits one durable exact STOP8 cancel then signed no-stop confirmation",async()=>{
  const f=await fixture();
  try{
    const result=await f.coordinator.retireOnce();
    assert.deepEqual(result,{status:"STOP8_RETIRED_SIGNED_FLAT",stopCancels:1});
    assert.equal(f.getCancelCount(),1);
    assert.equal((await f.store.load()).phase,"CONFIRMED");
    await assert.rejects(f.coordinator.retireOnce(),/PRIOR_RETIRE_INTENT_EXISTS/);
    assert.equal(f.getCancelCount(),1);
  }finally{await cleanup(f)}
});
test("open HYPE position or foreign/duplicate STOP always blocks cancellation",async()=>{
  for(const options of [{position:true},{wrongOrder:true},{dup:true}]){
    const f=await fixture(options);
    try{
      await assert.rejects(f.coordinator.retireOnce());
      assert.equal(f.getCancelCount(),0);
      await assert.rejects(f.store.load(),/ENOENT/);
    }finally{await cleanup(f)}
  }
});
test("missing STOP on signed FLAT can be durably retired with zero cancels",async()=>{
  const f=await fixture({open:false});
  try{
    const out=await f.coordinator.retireOnce();
    assert.equal(out.status,"STOP8_RETIRED_SIGNED_FLAT");
    assert.equal(out.stopCancels,0);
    assert.equal(f.getCancelCount(),0);
    assert.equal((await f.store.load()).phase,"CONFIRMED");
  }finally{await cleanup(f)}
});
test("unknown DELETE persists CANCEL_SUBMITTED, rechecks signed GET and never repeats the DELETE",async()=>{
  const f=await fixture({unknown:true});
  try{
    const out=await f.coordinator.retireOnce();
    assert.equal(out.status,"STOP8_CANCEL_UNKNOWN_REVIEW");
    assert.equal(f.getCancelCount(),1);
    assert.equal((await f.store.load()).phase,"CANCEL_SUBMITTED");
    const recovered=await f.coordinator.inspectUnknownWithoutResend();
    assert.equal(recovered.status,"STOP8_RETIRED_SIGNED_FLAT");
    assert.equal(recovered.stopCancels,0);
    assert.equal(f.getCancelCount(),1);
    assert.equal((await f.store.load()).phase,"CONFIRMED");
  }finally{await cleanup(f)}
});
test("unknown DELETE with STOP still on venue stays CANCEL_SUBMITTED and no retry",async()=>{
  const f=await fixture({unknown:true,afterStillOpen:true});
  try{
    await f.coordinator.retireOnce();
    assert.equal((await f.store.load()).phase,"CANCEL_SUBMITTED");
    const r=await f.coordinator.inspectUnknownWithoutResend();
    assert.equal(r.status,"STOP8_CANCEL_UNKNOWN_REVIEW");
    assert.equal(f.getCancelCount(),1);
  }finally{await cleanup(f)}
});
test("missing signed Root STOP8 authority never creates a retirement journal or DELETE",async()=>{
  const f=await fixture({deny:true});
  try{
    await assert.rejects(f.coordinator.retireOnce(),/STOP_ROOT_GRANT_NOT_ISSUED/);
    assert.equal(f.getCancelCount(),0);
    await assert.rejects(f.store.load(),/ENOENT/);
  }finally{await cleanup(f)}
});
