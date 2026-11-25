import {strict as assert} from "node:assert";
import {test} from "node:test";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {H48Stop8NativeRetirementHandoff} from "../lib/hype-h48-stop8-native-retirement-handoff";
import {FileH48Stop8Store} from "../lib/hype-h48-stop8-journal-store";
import {makeH48Stop8Intent,type H48Stop8Intent} from "../lib/hype-h48-resident-stop8";
import type {AccountLockHandle} from "../lib/disdex-account-order-lock";
import type {H48SignedVenueSnapshot} from "../lib/hype-h48-execution-journal";
import type {AsterV3Client} from "../lib/aster-v3-client";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d",PLAN="a".repeat(64);
const POS="H48|HYPEUSDT|"+Date.UTC(2026,10,24,0),ENTRY="h48e-"+"d".repeat(30);
function lease():AccountLockHandle{
  const start=Date.now()-1500,end=Date.now()+120_000;
  const doc={schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
    ownerId:"H48-test",leaseId:"lease",acquiredAt:start,expiresAt:end,reservations:[]};
  return {ownerId:doc.ownerId,leaseId:doc.leaseId,acquiredAt:start,renewalIntervalMs:1000,
    document:async()=>({...doc}),renew:async()=>({...doc}),
    reserve:async()=>{throw Error("NO_TEST_ORDERS")},releaseReservation:async()=>{},release:async()=>{}};
}
function signed(intent:H48Stop8Intent,flat=false,stop=false):H48SignedVenueSnapshot{
  return {
    source:"ASTER_SIGNED_READ_ONLY",observedAt:Date.now(),
    positions:flat?[]:[{symbol:"HYPEUSDT",quantity:2,entryPrice:100,markPrice:100,
      notionalUsd:200,pnlPct:0,unrealizedPnl:0,
      leverage:5,positionSide:"BOTH",updatedAt:Date.now()}],
    openOrders:stop?[{symbol:"HYPEUSDT",clientOrderId:intent.stopClientOrderId,
      type:"STOP_MARKET",side:"SELL",status:"NEW",reduceOnly:true,
      stopPrice:intent.stopPrice,quantity:2,executedQuantity:0}]:[],
  };
}
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"h48-native-retire-"));
  const stopRoot=join(root,"stop"),retirementRoot=join(root,"retirement");
  await mkdir(join(stopRoot,SHA),{recursive:true,mode:0o700});
  await mkdir(join(retirementRoot,SHA),{recursive:true,mode:0o700});
  const filename=createHash("sha256").update(encodeURIComponent(POS))
    .digest("hex").slice(0,40)+".json";
  const stopStore=new FileH48Stop8Store(join(stopRoot,SHA,filename),SHA,PLAN);
  const lock=lease(),now=Date.now();
  const intent=makeH48Stop8Intent({sourceSha:SHA,planSha256:PLAN,
    positionId:POS,entryClientOrderId:ENTRY,
    entryPrice:100,quantity:2,tickSize:0.1,now:now-2000});
  await stopStore.initialize({intent,lease:lock,signedVenue:signed(intent),now:Date.now()});
  const submitted={...intent,stage:"SUBMITTED" as const,submittedAt:now-1000};
  await stopStore.save(intent,submitted,lock);
  const time=Date.now(),after=signed(submitted,false,true);
  const confirmed={...submitted,stage:"CONFIRMED" as const,confirmedAt:time};
  await stopStore.save(submitted,confirmed,lock,{venue:after,now:time});
  return {root,stopRoot,retirementRoot,lock,intent:confirmed};
}
test("native retirement adapter uses prior STOP8 journal and one signed flat DELETE, not mock permit",async()=>{
  const f=await fixture();
  try{
    let cancels=0,removed=false;
    const client={cancelOrder:async(_symbol:string,id:string)=>{
      assert.equal(id,f.intent.stopClientOrderId);
      cancels++;removed=true;
      return {status:"CANCELED"};
    }} as Pick<AsterV3Client,"cancelOrder">;
    const adapter=new H48Stop8NativeRetirementHandoff({
      client,root:{assertSignedResidentStop8:async()=>{}},
      stopRoot:f.stopRoot,retirementRoot:f.retirementRoot,
      readSignedVenue:async()=>signed(f.intent,true,!removed),
    });
    const request={sourceSha:SHA,planSha256:PLAN,positionId:POS,
      lease:f.lock,now:Date.now()};
    const result=await adapter.retireAfterSignedFlat(request);
    assert.equal(result.status,"STOP8_RETIRED_SIGNED_FLAT");
    assert.equal(result.stopCancels,1);
    assert.equal(cancels,1);
    await assert.rejects(adapter.retireAfterSignedFlat(request),/PRIOR_RETIRE_INTENT_EXISTS/);
    assert.equal(cancels,1);
  }finally{await rm(f.root,{recursive:true,force:true})}
});
test("wrong source/position identity or unavailable root authority cannot cancel resident STOP8",async()=>{
  const f=await fixture();
  try{
    let cancels=0;
    const adapter=new H48Stop8NativeRetirementHandoff({
      client:({cancelOrder:async()=>{cancels++;throw Error("UNEXPECTED_CANCEL")}}
        as Pick<AsterV3Client,"cancelOrder">),
      root:{assertSignedResidentStop8:async()=>{throw Error("OWNER_ROOT_STOP8_GRANT_MISSING")}},
      stopRoot:f.stopRoot,retirementRoot:f.retirementRoot,
      readSignedVenue:async()=>signed(f.intent,true,true),
    });
    const request={sourceSha:SHA,planSha256:PLAN,positionId:POS,lease:f.lock,now:Date.now()};
    await assert.rejects(adapter.retireAfterSignedFlat(request),/OWNER_ROOT_STOP8_GRANT_MISSING/);
    await assert.rejects(adapter.retireAfterSignedFlat({...request,positionId:"H48|BTCUSDT|"+Date.now()}),/SOURCE_OR_POSITION_IDENTITY/);
    assert.equal(cancels,0);
  }finally{await rm(f.root,{recursive:true,force:true})}
});
