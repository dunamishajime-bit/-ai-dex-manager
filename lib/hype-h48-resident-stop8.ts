/**
 * H48 STOP8 candidate: one resident reduce-only ASTER STOP_MARKET protects
 * one authenticated HYPE long. New policy needs a NEW exact SHA/Owner/Root
 * certificate; the existing H48_TIME_ONLY certificate does NOT authorize
 * this module. No service creates the required Root grant yet.
 *
 * STOP8 is a trigger, not a guarantee of -8% realized loss on gap/slippage.
 */
import { createHash } from "node:crypto";
import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { AsterV3Client } from "./aster-v3-client";
import type { H48SignedVenueSnapshot } from "./hype-h48-execution-journal";

export const H48_STOP8_POLICY = "H48_R4_RESIDENT_STOP8" as const;
export const H48_STOP8_SCHEMA = "disdex-h48-stop8-intent/v1" as const;
const SHA=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const fail=(s:string):never=>{throw Error("H48_STOP8_BLOCKED:"+s)};
const validNumber=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>0;
const validClock=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;

export type H48Stop8Stage="PREPARED"|"SUBMITTED"|"CONFIRMED"|"MANUAL_REVIEW";
export interface H48Stop8Intent {
  schema:typeof H48_STOP8_SCHEMA;
  sourceSha:string;
  planSha256:string;
  positionId:string;
  entryClientOrderId:string;
  stopClientOrderId:string;
  entryPrice:number;
  quantity:number;
  tickSize:number;
  stopPrice:number;
  stage:H48Stop8Stage;
  issuedAt:number;
  submittedAt:number|null;
  confirmedAt:number|null;
}
export interface H48Stop8Store {
  load():Promise<H48Stop8Intent>;
  save(before:H48Stop8Intent,after:H48Stop8Intent,lease:AccountLockHandle,
    proof?:{venue:H48SignedVenueSnapshot;now:number}):Promise<void>;
}
export interface H48Stop8OwnerAuthority {
  /** Must check actual Root-signed, exact release/plan/policy and lease.
   * A typed boolean is NOT an implementation of this requirement. */
  assertSignedResidentStop8(input:{
    sourceSha:string;planSha256:string;positionId:string;lease:AccountLockHandle;now:number;
  }):Promise<void>;
}
export type H48Stop8Result=Readonly<{
  status:"STOP8_VERIFIED"|"STOP8_SUBMITTED_RECONCILIATION_REQUIRED";
  clientOrderId:string;
  stopAttempts:1;
}>;
export function stop8ClientOrderId(sourceSha:string,positionId:string):string{
  if(!SHA.test(sourceSha)||!positionId.startsWith("H48|HYPEUSDT|"))
    fail("ORDER_IDENTITY_INVALID");
  return "h48s-"+createHash("sha256")
    .update(sourceSha+"|"+positionId+"|STOP8").digest("hex").slice(0,30);
}

/** Ceiling rounds a LONG stop trigger toward entry (not farther away);
 * the trigger still cannot promise a maximum realized stop loss. */
export function stop8Price(entryPrice:number,tickSize:number):number{
  if(!validNumber(entryPrice)||!validNumber(tickSize)||tickSize>=entryPrice)
    fail("STOP_PRICE_PARAMETERS_INVALID");
  const ratio=entryPrice*0.92/tickSize;
  const ticks=Math.ceil(ratio-1e-10);
  const price=Number((ticks*tickSize).toPrecision(14));
  if(!validNumber(price)||price>=entryPrice
      ||price+1e-9<entryPrice*0.92)
    fail("STOP_PRICE_UNEXECUTABLE");
  return price;
}
export function validateH48Stop8Intent(v:H48Stop8Intent){
  if(!v||v.schema!==H48_STOP8_SCHEMA||!SHA.test(v.sourceSha)
    ||!HEX64.test(v.planSha256)||!v.positionId.startsWith("H48|HYPEUSDT|")
    ||!/^h48e-[0-9a-f]{30}$/.test(v.entryClientOrderId)
    ||v.stopClientOrderId!==stop8ClientOrderId(v.sourceSha,v.positionId)
    ||!validNumber(v.entryPrice)||!validNumber(v.quantity)
    ||!validNumber(v.tickSize)||v.stopPrice!==stop8Price(v.entryPrice,v.tickSize)
    ||!validClock(v.issuedAt)||!["PREPARED","SUBMITTED","CONFIRMED","MANUAL_REVIEW"].includes(v.stage)
    ||(v.stage==="PREPARED"
      ?v.submittedAt!==null||v.confirmedAt!==null
      :!validClock(v.submittedAt)||Number(v.submittedAt)<v.issuedAt)
    ||(v.stage==="CONFIRMED"
      ?!validClock(v.confirmedAt)||Number(v.confirmedAt)<Number(v.submittedAt)
      :v.confirmedAt!==null))fail("INTENT_NOT_ATTESTED");
  return v;
}
export function makeH48Stop8Intent(input:{
  sourceSha:string;planSha256:string;positionId:string;entryClientOrderId:string;
  entryPrice:number;quantity:number;tickSize:number;now:number;
}):H48Stop8Intent{
  const v:H48Stop8Intent={
    schema:H48_STOP8_SCHEMA,
    sourceSha:input.sourceSha,planSha256:input.planSha256,positionId:input.positionId,
    entryClientOrderId:input.entryClientOrderId,
    stopClientOrderId:stop8ClientOrderId(input.sourceSha,input.positionId),
    entryPrice:input.entryPrice,quantity:input.quantity,tickSize:input.tickSize,
    stopPrice:stop8Price(input.entryPrice,input.tickSize),
    stage:"PREPARED",issuedAt:input.now,submittedAt:null,confirmedAt:null,
  };
  return validateH48Stop8Intent(v);
}

/** The signed venue readback must attest BOTH the correct HYPE position
 * and the one unambiguous owned STOP; an ACK alone proves nothing. */
export function verifyH48Stop8Venue(
  intent:H48Stop8Intent, venue:H48SignedVenueSnapshot,now:number,
):void{
  validateH48Stop8Intent(intent);
  if(intent.stage!=="SUBMITTED"||!validClock(now)
    ||venue?.source!=="ASTER_SIGNED_READ_ONLY"
    ||!validClock(venue.observedAt)||venue.observedAt<Number(intent.submittedAt)
    ||venue.observedAt>now||now-venue.observedAt>120_000
    ||!Array.isArray(venue.positions)||!Array.isArray(venue.openOrders))
    fail("VENUE_FRESHNESS_OR_INTENT");
  const positions=venue.positions.filter(x=>x?.symbol?.toUpperCase()==="HYPEUSDT"&&Math.abs(x.quantity)>1e-9);
  if(positions.length!==1||positions[0].positionSide!=="BOTH"&&positions[0].positionSide!=="LONG"
    ||positions[0].quantity!==intent.quantity||!validNumber(positions[0].entryPrice)
    ||Math.abs(positions[0].entryPrice-intent.entryPrice)>Math.max(intent.tickSize,1e-8))
    fail("SIGNED_HYPE_POSITION_MISMATCH");
  const orders=venue.openOrders.filter(x=>x?.symbol?.toUpperCase()==="HYPEUSDT");
  if(orders.length!==1)fail("UNMANAGED_OR_MISSING_STOP");
  const order=orders[0];
  if(order.clientOrderId!==intent.stopClientOrderId||order.type!=="STOP_MARKET"
    ||order.side!=="SELL"||order.reduceOnly!==true||order.status!=="NEW"
    ||order.quantity!==intent.quantity||order.executedQuantity!==0
    ||!validNumber(order.stopPrice)
    ||Math.abs(order.stopPrice-intent.stopPrice)>Math.max(1e-8,intent.tickSize*1e-4))
    fail("STOP_ORDER_EVIDENCE_MISMATCH");
}

/** All failures AFTER durable SUBMITTED are ambiguous. No automatic retry
 * or premature exposure reservation release. A human/reconciliation process
 * must resolve open positions, STOP ownership and any venue response. */
export class H48Stop8Installer {
  constructor(private readonly dep:{
    sourceSha:string;planSha256:string;
    store:H48Stop8Store;lease:AccountLockHandle;
    authority:H48Stop8OwnerAuthority;
    venue:Pick<AsterV3Client,"placeStopMarketOrder">;
    readSignedVenue:()=>Promise<H48SignedVenueSnapshot>;
    now?:()=>number;
  }){}
  async installOnce():Promise<H48Stop8Result>{
    const d=this.dep,now=d.now??Date.now;
    const expected=validateH48Stop8Intent(await d.store.load());
    if(expected.stage!=="PREPARED")fail("NOT_FIRST_ATTEMPT");
    if(expected.sourceSha!==d.sourceSha||expected.planSha256!==d.planSha256)
      fail("RELEASE_OR_PLAN_MISMATCH");
    const lease=await d.lease.document();
    if(lease.accountScope!=="ASTER_FUTURES"||lease.expiresAt<=now())
      fail("ACCOUNT_LEASE_NOT_ACTIVE");
    await d.authority.assertSignedResidentStop8({
      sourceSha:d.sourceSha,planSha256:d.planSha256,
      positionId:expected.positionId,lease:d.lease,now:now(),
    });
    const current=await d.lease.document();
    if(current.ownerId!==lease.ownerId||current.leaseId!==lease.leaseId
      ||current.acquiredAt!==lease.acquiredAt||current.expiresAt<=now())
      fail("ACCOUNT_LEASE_CHANGED");
    const submitted={...expected,stage:"SUBMITTED" as const,submittedAt:now()};
    // Persistence is required BEFORE any API request, even one that may fail.
    await d.store.save(expected,submitted,d.lease);
    try{
      await d.venue.placeStopMarketOrder({
        symbol:"HYPEUSDT",side:"SELL",
        quantity:String(expected.quantity),stopPrice:String(expected.stopPrice),
        positionSide:"BOTH",reduceOnly:true,
        newClientOrderId:expected.stopClientOrderId,newOrderRespType:"RESULT",
      });
      const signed=await d.readSignedVenue(),observedAt=now();
      verifyH48Stop8Venue(submitted,signed,observedAt);
      await d.store.save(submitted,{
        ...submitted,stage:"CONFIRMED",confirmedAt:observedAt,
      },d.lease,{venue:signed,now:observedAt});
      return {status:"STOP8_VERIFIED",clientOrderId:expected.stopClientOrderId,stopAttempts:1};
    }catch{
      return {status:"STOP8_SUBMITTED_RECONCILIATION_REQUIRED",
        clientOrderId:expected.stopClientOrderId,stopAttempts:1};
    }
  }
}
