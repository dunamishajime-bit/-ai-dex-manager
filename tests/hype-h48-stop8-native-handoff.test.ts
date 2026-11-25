import {strict as assert} from "node:assert";
import {test} from "node:test";
import {mkdtemp,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {H48Stop8NativeHandoff} from "../lib/hype-h48-stop8-native-handoff";
import type {AccountLockHandle} from "../lib/disdex-account-order-lock";
import type {AsterV3Client,AsterNewStopMarketOrder} from "../lib/aster-v3-client";
import type {H48SignedVenueSnapshot} from "../lib/hype-h48-execution-journal";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d";
const PLAN="a".repeat(64),NOW=()=>Date.now();
const ENTRY="h48e-"+"2".repeat(30),POSITION="H48|HYPEUSDT|1795478400000";
function lease():AccountLockHandle {
  const acquiredAt=NOW()-1000,expiresAt=NOW()+300000;
  return {
    ownerId:"test",leaseId:"test-lease",acquiredAt,renewalIntervalMs:1000,
    document:async()=>({
      schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
      ownerId:"test",leaseId:"test-lease",acquiredAt,expiresAt,reservations:[],
    }),
    renew:async()=>{throw Error("NO_RENEW")},reserve:async()=>{throw Error("NO_RESERVE")},
    releaseReservation:async()=>{},release:async()=>{},
  };
}
const position=()=>({
  contract:{sourceSha:SHA,positionId:POSITION,logicalEntryTs:1795478400000,
    logicalExitTs:1795478400000+48*3600000},
  quantity:2,entryPrice:100,entryClientOrderId:ENTRY,observedAt:NOW()-1000,
});
function fake(opts:{deny?:boolean;unknown?:boolean;invalidExchange?:boolean;noStop?:boolean}={}){
  let submits=0,auth=0,reads=0;
  let stop:AsterNewStopMarketOrder|undefined;
  const venue={
    getExchangeInfo:async()=>({
      symbols:[{
        symbol:"HYPEUSDT",status:"TRADING",
        orderTypes:opts.invalidExchange?["MARKET"]:["MARKET","STOP_MARKET"],
        filters:[{filterType:"PRICE_FILTER",tickSize:"0.1"}],
      }],
    }),
    placeStopMarketOrder:async (command:AsterNewStopMarketOrder)=>{
      submits++;
      stop=command;
      if(opts.unknown)throw Error("VENUE_NETWORK_UNKNOWN");
      return {orderId:12,status:"NEW"};
    },
  } as Pick<AsterV3Client,"getExchangeInfo"|"placeStopMarketOrder">;
  const signed=async():Promise<H48SignedVenueSnapshot>=>{
    reads++;
    return {
      source:"ASTER_SIGNED_READ_ONLY",observedAt:NOW(),
      positions:[{
        symbol:"HYPEUSDT",quantity:2,entryPrice:100,
        markPrice:100,unrealizedPnl:0,pnlPct:0,notionalUsd:200,
        positionSide:"BOTH",leverage:5,updatedAt:NOW(),
      }],
      openOrders:submits&&!opts.noStop?[{
        symbol:"HYPEUSDT",clientOrderId:stop!.newClientOrderId,
        type:"STOP_MARKET",side:"SELL",reduceOnly:true,status:"NEW",
        stopPrice:Number(stop!.stopPrice),quantity:2,executedQuantity:0,
      }]:[],
    };
  };
  return {venue,signed,authority:{
    assertSignedResidentStop8:async({sourceSha,planSha256,positionId}:{
      sourceSha:string;planSha256:string;positionId:string
    })=>{
      auth++;
      assert.equal(sourceSha,SHA);assert.equal(planSha256,PLAN);
      assert.equal(positionId,POSITION);
      if(opts.deny)throw Error("OWNER_STOP8_CERTIFICATE_MISSING");
    },
  },getSubmits:()=>submits,getAuth:()=>auth,getReads:()=>reads};
}
test("handoff uses actual exchange filters, first signed position GET, durable intent and real STOP then signed GET",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"h48-stop8-handoff-"));
  try{
    const f=fake();
    const x=new H48Stop8NativeHandoff({
      client:f.venue,readSignedVenue:f.signed,
      stop8RootAuthority:f.authority,explicitStoreRoot:folder,now:NOW,
    });
    const args={sourceSha:SHA,planSha256:PLAN,position:position(),lease:lease(),now:NOW()};
    const result=await x.protectConfirmedEntry(args);
    assert.equal(result.status,"STOP8_VERIFIED");
    assert.equal(f.getSubmits(),1);
    assert.equal(f.getAuth(),2);
    assert.equal(f.getReads(),2);
    await assert.rejects(x.protectConfirmedEntry(args),/PRIOR_INTENT_ALREADY_EXISTS/);
    assert.equal(f.getSubmits(),1);
  }finally{await rm(folder,{recursive:true,force:true})}
});
test("no signed STOP8 Root grant creates no journal and sends zero orders",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"h48-stop8-deny-"));
  try{
    const f=fake({deny:true});
    const x=new H48Stop8NativeHandoff({
      client:f.venue,readSignedVenue:f.signed,
      stop8RootAuthority:f.authority,explicitStoreRoot:folder,now:NOW,
    });
    await assert.rejects(x.protectConfirmedEntry({
      sourceSha:SHA,planSha256:PLAN,position:position(),lease:lease(),now:NOW(),
    }),/OWNER_STOP8_CERTIFICATE_MISSING/);
    assert.equal(f.getSubmits(),0);
    assert.deepEqual(await readdir(folder),[]);
  }finally{await rm(folder,{recursive:true,force:true})}
});
test("ASTER lacking STOP_MARKET support fails before creating a journal",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"h48-stop8-market-"));
  try{
    const f=fake({invalidExchange:true});
    const x=new H48Stop8NativeHandoff({
      client:f.venue,readSignedVenue:f.signed,
      stop8RootAuthority:f.authority,explicitStoreRoot:folder,now:NOW,
    });
    await assert.rejects(x.protectConfirmedEntry({
      sourceSha:SHA,planSha256:PLAN,position:position(),lease:lease(),now:NOW(),
    }),/HYPE_STOP_MARKET_NOT_AVAILABLE/);
    assert.equal(f.getSubmits(),0);
  }finally{await rm(folder,{recursive:true,force:true})}
});
test("an UNKNOWN STOP order remains persisted and is not retried by the handoff",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"h48-stop8-unknown-"));
  try{
    const f=fake({unknown:true});
    const x=new H48Stop8NativeHandoff({
      client:f.venue,readSignedVenue:f.signed,
      stop8RootAuthority:f.authority,explicitStoreRoot:folder,now:NOW,
    });
    const args={sourceSha:SHA,planSha256:PLAN,position:position(),lease:lease(),now:NOW()};
    await assert.rejects(x.protectConfirmedEntry(args),/STOP_SUBMITTED_ACCOUNT_RECONCILIATION_REQUIRED/);
    assert.equal(f.getSubmits(),1);
    await assert.rejects(x.protectConfirmedEntry(args),/PRIOR_INTENT_ALREADY_EXISTS/);
    assert.equal(f.getSubmits(),1);
  }finally{await rm(folder,{recursive:true,force:true})}
});
