/**
 * Retire exactly one owned resident HYPE STOP8 after a signed confirmed FLAT.
 * A stale STOP must never be deleted while a position is open. Every DELETE
 * is preceded by durable intent; UNKNOWN is never automatically retried.
 * Separate from the H48 entry/exit market-order journal.
 */
import type {AccountLockHandle} from "./disdex-account-order-lock";
import type {AsterV3Client} from "./aster-v3-client";
import type {H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import {validateH48Stop8Intent,type H48Stop8Intent,type H48Stop8OwnerAuthority}
  from "./hype-h48-resident-stop8";
const fail=(why:string):never=>{throw Error("H48_STOP8_RETIRE_BLOCKED:"+why)};
export const RETIRE_SCHEMA="disdex-h48-stop8-retirement/v1" as const;
export type H48Stop8Retirement=Readonly<{
  schema:typeof RETIRE_SCHEMA;
  sourceSha:string;planSha256:string;positionId:string;stopClientOrderId:string;
  phase:"PREPARED"|"CANCEL_SUBMITTED"|"CONFIRMED";
  preparedAt:number;submittedAt:number|null;confirmedAt:number|null;
}>;
export interface H48Stop8RetirementStore {
  load():Promise<H48Stop8Retirement>;
  initialize(state:H48Stop8Retirement,lease:AccountLockHandle):Promise<void>;
  save(before:H48Stop8Retirement,after:H48Stop8Retirement,lease:AccountLockHandle,
    signedEvidence?:{venue:H48SignedVenueSnapshot;now:number}):Promise<void>;
}
const fresh=(v:H48SignedVenueSnapshot,now:number)=>
  v?.source==="ASTER_SIGNED_READ_ONLY"&&Number.isSafeInteger(v.observedAt)
  &&v.observedAt>0&&v.observedAt<=now&&now-v.observedAt<=30_000
  &&Array.isArray(v.positions)&&Array.isArray(v.openOrders);
function checkFlatOwnedStop(stop:H48Stop8Intent,venue:H48SignedVenueSnapshot,now:number){
  if(!fresh(venue,now))fail("VENUE_STALE");
  if(venue.positions.some(p=>p?.symbol==="HYPEUSDT"&&Math.abs(p.quantity)>1e-9))
    fail("HYPE_POSITION_NOT_FLAT");
  const orders=venue.openOrders.filter(o=>o?.symbol==="HYPEUSDT");
  if(orders.length===0)return "CLEARED" as const;
  if(orders.length!==1)fail("UNMANAGED_HYPE_OPEN_ORDERS");
  const order=orders[0];
  if(order.clientOrderId!==stop.stopClientOrderId
    ||order.type!=="STOP_MARKET"||order.side!=="SELL"
    ||order.reduceOnly!==true||order.status!=="NEW"
    ||order.quantity!==stop.quantity||order.executedQuantity!==0
    ||Math.abs(Number(order.stopPrice)-stop.stopPrice)>Math.max(1e-8,stop.tickSize*0.0001))
    fail("STOP8_ORDER_OWNER_OR_SHAPE_MISMATCH");
  return "OWNED_STOP_PRESENT" as const;
}
function validateRetirement(s:H48Stop8Retirement,stop:H48Stop8Intent){
  if(!s||s.schema!==RETIRE_SCHEMA||s.sourceSha!==stop.sourceSha
    ||s.planSha256!==stop.planSha256||s.positionId!==stop.positionId
    ||s.stopClientOrderId!==stop.stopClientOrderId
    ||!Number.isSafeInteger(s.preparedAt)||s.preparedAt<=0
    ||!["PREPARED","CANCEL_SUBMITTED","CONFIRMED"].includes(s.phase))
    fail("RETIRE_JOURNAL_NOT_BOUND");
}
export class H48Stop8RetirementCoordinator {
  constructor(private readonly dep:{
    sourceSha:string;planSha256:string;
    stopJournal:Pick<{load():Promise<H48Stop8Intent>},"load">;
    retireStore:H48Stop8RetirementStore;
    lease:AccountLockHandle;
    ownerAuthority:H48Stop8OwnerAuthority;
    readSignedVenue:()=>Promise<H48SignedVenueSnapshot>;
    venue:Pick<AsterV3Client,"cancelOrder">;
    now?:()=>number;
  }){}
  async retireOnce():Promise<Readonly<{
    status:"STOP8_RETIRED_SIGNED_FLAT"|"STOP8_CANCEL_UNKNOWN_REVIEW";
    stopCancels:0|1;
  }>>{
    const d=this.dep,now=d.now??Date.now;
    const stop=validateH48Stop8Intent(await d.stopJournal.load());
    if(stop.stage!=="CONFIRMED"
      ||stop.sourceSha!==d.sourceSha||stop.planSha256!==d.planSha256)
      fail("NO_CONFIRMED_STOP8");
    const lease=await d.lease.document();
    if(lease.accountScope!=="ASTER_FUTURES"||lease.expiresAt<=now()
      ||lease.leaseId!==d.lease.leaseId||lease.ownerId!==d.lease.ownerId)
      fail("ACCOUNT_LOCK_NOT_VALID");
    await d.ownerAuthority.assertSignedResidentStop8({
      sourceSha:d.sourceSha,planSha256:d.planSha256,
      positionId:stop.positionId,lease:d.lease,now:now(),
    });
    const before=await d.readSignedVenue(),time=now();
    const orderState=checkFlatOwnedStop(stop,before,time);
    const original:H48Stop8Retirement={
      schema:RETIRE_SCHEMA,sourceSha:d.sourceSha,planSha256:d.planSha256,
      positionId:stop.positionId,stopClientOrderId:stop.stopClientOrderId,
      phase:"PREPARED",preparedAt:time,submittedAt:null,confirmedAt:null,
    };
    // New journal wx-only. A previous PREPARED/SUBMITTED attempt cannot
    // be reset or silently retried by calling retireOnce again.
    await d.retireStore.initialize(original,d.lease);
    if(orderState==="CLEARED"){
      await d.retireStore.save(original,{...original,phase:"CONFIRMED",
        submittedAt:null,confirmedAt:time},d.lease,{venue:before,now:time});
      return {status:"STOP8_RETIRED_SIGNED_FLAT",stopCancels:0};
    }
    const attempted:H48Stop8Retirement={...original,phase:"CANCEL_SUBMITTED",submittedAt:now()};
    await d.retireStore.save(original,attempted,d.lease);
    // No second DELETE on failure. Signed fresh GET-only recovery is a
    // separate operation with the already-persisted CANCEL_SUBMITTED file.
    try{
      await d.venue.cancelOrder("HYPEUSDT",stop.stopClientOrderId);
      const after=await d.readSignedVenue(),checkedAt=now();
      if(checkFlatOwnedStop(stop,after,checkedAt)!=="CLEARED")
        fail("STOP_STILL_ON_VENUE");
      await d.retireStore.save(attempted,{...attempted,phase:"CONFIRMED",
        confirmedAt:checkedAt},d.lease,{venue:after,now:checkedAt});
      return {status:"STOP8_RETIRED_SIGNED_FLAT",stopCancels:1};
    }catch{
      return {status:"STOP8_CANCEL_UNKNOWN_REVIEW",stopCancels:1};
    }
  }
  async inspectUnknownWithoutResend():Promise<Readonly<{
    status:"STOP8_RETIRED_SIGNED_FLAT"|"STOP8_CANCEL_UNKNOWN_REVIEW";
    stopCancels:0;
  }>> {
    const d=this.dep,now=d.now??Date.now;
    const stop=validateH48Stop8Intent(await d.stopJournal.load());
    const old=await d.retireStore.load();
    validateRetirement(old,stop);
    if(old.phase!=="CANCEL_SUBMITTED")fail("NO_CANCEL_SUBMITTED_TO_RECONCILE");
    await d.ownerAuthority.assertSignedResidentStop8({
      sourceSha:d.sourceSha,planSha256:d.planSha256,
      positionId:stop.positionId,lease:d.lease,now:now(),
    });
    try{
      const signed=await d.readSignedVenue(),observed=now();
      if(checkFlatOwnedStop(stop,signed,observed)!=="CLEARED")
        return {status:"STOP8_CANCEL_UNKNOWN_REVIEW",stopCancels:0};
      await d.retireStore.save(old,{...old,phase:"CONFIRMED",
        confirmedAt:observed},d.lease,{venue:signed,now:observed});
      return {status:"STOP8_RETIRED_SIGNED_FLAT",stopCancels:0};
    }catch{
      return {status:"STOP8_CANCEL_UNKNOWN_REVIEW",stopCancels:0};
    }
  }
}
