import { strict as assert } from "node:assert";
import {test} from "node:test";
import {
  makeH48Stop8Intent,stop8Price,stop8ClientOrderId,
  verifyH48Stop8Venue,H48Stop8Installer,type H48Stop8Intent,
} from "../lib/hype-h48-resident-stop8";
import type { AccountLockHandle } from "../lib/disdex-account-order-lock";
import type { AsterV3Client,AsterNewStopMarketOrder } from "../lib/aster-v3-client";
import type { H48SignedVenueSnapshot } from "../lib/hype-h48-execution-journal";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d";
const PLAN="a".repeat(64);
const E=Date.UTC(2026,10,24,0),NOW=E+55000;
const args={
  sourceSha:SHA,planSha256:PLAN,
  positionId:"H48|HYPEUSDT|"+E,
  entryClientOrderId:"h48e-"+"d".repeat(30),
  entryPrice:100,quantity:2,tickSize:0.1,now:NOW-1000,
};
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function snapshot(o:H48Stop8Intent,over?:{
  missing?:boolean;duplicate?:boolean;wrongStop?:boolean;wrongQty?:boolean;
  observedAt?:number;empty?:boolean;
}):H48SignedVenueSnapshot {
  const order={
    symbol:"HYPEUSDT",clientOrderId:o.stopClientOrderId,
    type:"STOP_MARKET",side:"SELL" as const,reduceOnly:true,status:"NEW",
    stopPrice:over?.wrongStop?o.stopPrice-5:o.stopPrice,
    quantity:over?.wrongQty?o.quantity-1:o.quantity,executedQuantity:0,
  };
  return {
    source:"ASTER_SIGNED_READ_ONLY",
    observedAt:over?.observedAt??NOW,
    positions:over?.empty?[]:[{
      symbol:"HYPEUSDT",quantity:o.quantity,entryPrice:o.entryPrice,
      markPrice:100,unrealizedPnl:0,pnlPct:0,notionalUsd:200,
      positionSide:"BOTH",leverage:5,updatedAt:NOW,
    }],
    openOrders:over?.missing?[]:over?.duplicate?[order,order]:[order],
  };
}
function makeFake(opts:{
  deny?:boolean;networkUnknown?:boolean;noStopOnGET?:boolean;
  duplicateOnGET?:boolean;wrongStop?:boolean;staleGet?:boolean;
  brokenJournalSave?:boolean;
}={}){
  let persisted:H48Stop8Intent=makeH48Stop8Intent(args);
  let submitCount=0, saveCount=0;
  const lease={
    ownerId:"h48-test",leaseId:"lease",acquiredAt:NOW-1000,renewalIntervalMs:1000,
    document:async()=>({
      schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
      ownerId:"h48-test",leaseId:"lease",acquiredAt:NOW-1000,expiresAt:NOW+60000,reservations:[],
    }),
    renew:async()=>{throw Error("TEST_NO_RENEW")},
    reserve:async()=>{throw Error("TEST_NO_NEW_EXPOSURE")},
    releaseReservation:async()=>{throw Error("TEST_CANNOT_RELEASE")},
    release:async()=>{},
  } as AccountLockHandle;
  const commands:AsterNewStopMarketOrder[]=[];
  const runner=new H48Stop8Installer({
    sourceSha:SHA,planSha256:PLAN,lease,
    store:{
      load:async()=>clone(persisted),
      save:async(before,after)=>{
        if(opts.brokenJournalSave)throw Error("FSYNC_FAILED");
        assert.deepEqual(before,persisted);
        assert.equal(after.schema, before.schema);
        assert.equal(after.stopClientOrderId,before.stopClientOrderId);
        if(after.stage==="SUBMITTED") assert.equal(before.stage,"PREPARED");
        if(after.stage==="CONFIRMED") assert.equal(before.stage,"SUBMITTED");
        persisted=clone(after);saveCount++;
      },
    },
    authority:{assertSignedResidentStop8:async({sourceSha,planSha256,positionId})=>{
      if(opts.deny)throw Error("OWNER_STOP8_NOT_SIGNED");
      assert.equal(sourceSha,SHA);assert.equal(planSha256,PLAN);
      assert.equal(positionId,args.positionId);
    }},
    venue:{
      placeStopMarketOrder:async(order:AsterNewStopMarketOrder)=>{
        submitCount++;commands.push(order);
        assert.equal(persisted.stage,"SUBMITTED",
          "a durable STOP_SUBMITTED intent must precede any ASTER POST");
        if(opts.networkUnknown)throw Error("UNKNOWN_POST_RESULT");
        return {orderId:123,status:"NEW"};
      },
    } as unknown as Pick<AsterV3Client,"placeStopMarketOrder">,
    readSignedVenue:async()=>snapshot(persisted,{
      missing:opts.noStopOnGET,duplicate:opts.duplicateOnGET,
      wrongStop:opts.wrongStop,
      observedAt:opts.staleGet?NOW-130000:NOW,
    }),
    now:()=>NOW,
  });
  return {runner,commands,getStatus:()=>persisted.stage,
    getSubmitCount:()=>submitCount,getSaveCount:()=>saveCount};
}
test("STOP8 long rounds threshold towards entry, not into greater planned loss",()=>{
  assert.equal(stop8Price(100,0.1),92);
  assert.equal(stop8Price(100,0.3),92.1);
  assert.throws(()=>stop8Price(100,0),/STOP_PRICE_PARAMETERS_INVALID/);
  assert.throws(()=>stop8Price(100,100),/STOP_PRICE_PARAMETERS_INVALID/);
  assert.equal(stop8ClientOrderId(SHA,args.positionId).length,35);
});
test("a signed STOP8 grant and durable SUBMITTED precondition lead to one reduce-only SELL STOP_MARKET",async()=>{
  const x=makeFake();
  const out=await x.runner.installOnce();
  assert.equal(out.status,"STOP8_VERIFIED");
  assert.equal(x.getSubmitCount(),1);
  assert.equal(x.getSaveCount(),2);
  assert.equal(x.getStatus(),"CONFIRMED");
  assert.deepEqual(x.commands.map(c=>({
    symbol:c.symbol,side:c.side,reduceOnly:c.reduceOnly,
    stop:c.stopPrice,quantity:c.quantity,
  })),[{symbol:"HYPEUSDT",side:"SELL",reduceOnly:true,stop:"92",quantity:"2"}]);
  await assert.rejects(x.runner.installOnce(),/NOT_FIRST_ATTEMPT/);
});
test("unsigned STOP8 or failed persistence sends zero orders",async()=>{
  for(const options of [{deny:true},{brokenJournalSave:true}]){
    const x=makeFake(options);
    await assert.rejects(x.runner.installOnce());
    assert.equal(x.getSubmitCount(),0);
    assert.equal(x.getStatus(),"PREPARED");
  }
});
test("unknown POST status preserves SUBMITTED and never resends the same stop ID",async()=>{
  const x=makeFake({networkUnknown:true});
  assert.equal((await x.runner.installOnce()).status,
    "STOP8_SUBMITTED_RECONCILIATION_REQUIRED");
  assert.equal(x.getStatus(),"SUBMITTED");
  await assert.rejects(x.runner.installOnce(),/NOT_FIRST_ATTEMPT/);
  assert.equal(x.getSubmitCount(),1);
  assert.equal(x.getSaveCount(),1);
});
test("missing, wrong, duplicated or stale signed STOP evidence never counts as confirmed",async()=>{
  for(const options of [{noStopOnGET:true},{wrongStop:true},
    {duplicateOnGET:true},{staleGet:true}]){
    const x=makeFake(options);
    const out=await x.runner.installOnce();
    assert.equal(out.status,"STOP8_SUBMITTED_RECONCILIATION_REQUIRED");
    assert.equal(x.getStatus(),"SUBMITTED");
    assert.equal(x.getSubmitCount(),1);
    assert.equal(x.getSaveCount(),1);
  }
});
test("a signed STOP does not protect a missing or different live HYPE position",()=>{
  const stop: H48Stop8Intent={...makeH48Stop8Intent(args),
    stage:"SUBMITTED",submittedAt:NOW-100,confirmedAt:null};
  assert.throws(()=>verifyH48Stop8Venue(stop,snapshot(stop,{empty:true}),NOW),
    /SIGNED_HYPE_POSITION_MISMATCH/);
  assert.throws(()=>verifyH48Stop8Venue(stop,snapshot(stop,{wrongQty:true}),NOW),
    /STOP_ORDER_EVIDENCE_MISMATCH/);
  verifyH48Stop8Venue(stop,snapshot(stop),NOW);
});

test("UNKNOWN STOP8 POST is independently reconciled by signed GET without a second order",async()=>{
  const x=makeFake({networkUnknown:true});
  assert.equal((await x.runner.installOnce()).status,
    "STOP8_SUBMITTED_RECONCILIATION_REQUIRED");
  assert.equal(x.getSubmitCount(),1);
  const r=await x.runner.reconcileSubmitted();
  assert.equal(r.status,"STOP8_VERIFIED_WITHOUT_RESEND");
  assert.equal(r.stopAttempts,0);
  assert.equal(x.getStatus(),"CONFIRMED");
  assert.equal(x.getSaveCount(),2);
  assert.equal(x.getSubmitCount(),1);
});
test("missing STOP8 after UNKNOWN stays SUBMITTED and cannot be assumed protected",async()=>{
  const x=makeFake({networkUnknown:true,noStopOnGET:true});
  await x.runner.installOnce();
  const r=await x.runner.reconcileSubmitted();
  assert.equal(r.status,"STOP8_RECONCILIATION_REQUIRED");
  assert.equal(r.stopAttempts,0);
  assert.equal(x.getStatus(),"SUBMITTED");
  assert.equal(x.getSubmitCount(),1);
});
