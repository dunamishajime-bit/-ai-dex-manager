/**
 * H48 production-shape execution transaction. Not installed as a LIVE
 * entrypoint: the Root-signed scoped LIVE grant, active Kill Switch release,
 * new H48 STOP governance, and approved Gross plan do not exist yet.
 *
 * Real venue operations are implemented ONLY as an injectable integration
 * seam. A production factory must verify the exact Root/Owner signature and
 * current stop/risk policy and MUST call this through the genuine ASTER
 * executor, not a test dependency. No test order is ever sent by this module.
 */
import type { AccountLockHandle,AccountReservation } from "./disdex-account-order-lock";
import type {
  DirectTradeExecutor,DirectTradeResult,DirectTradeCommand,
} from "./direct-trade-executor";
import type { H48ExecutionJournal,H48OrderIntent,H48SignedVenueSnapshot } from "./hype-h48-execution-journal";
import { markH48OrderAttempted,reconcileH48Attempt,validateH48ExecutionJournal } from "./hype-h48-execution-journal";

export type H48ExecutedPhase="ENTRY"|"EXIT";
export interface H48ScopedOwnerOrderGrant {
  schema:"disdex-h48-production-order-grant/v2";
  scope:"HYPE_TREND_LONG";
  approvedSha:string;
  planSha256:string;
  certificateSha256:string;
  clientOrderId:string;
  phase:H48ExecutedPhase;
  approvalId:string;
  issuedAt:number;
  expiresAt:number;
  maxEntryNotionalUsd:number;
  maxSlippageBps:number;
  grossCapHype:number;
  // A new Root-approved protective STOP/governance decision is required.
  stopGovernanceCertified:true;
}
export interface H48RootGrantVerifier {
  verifyForOrder(input:{
    pending:H48OrderIntent;runtimeSha:string;
    lease:AccountLockHandle;now:number;
  }):Promise<H48ScopedOwnerOrderGrant>;
}
export interface H48OrderStateStore {
  load():Promise<H48ExecutionJournal>;
  save(old:H48ExecutionJournal,newState:H48ExecutionJournal,lease:AccountLockHandle,
       evidence?:{result:DirectTradeResult;venue:H48SignedVenueSnapshot;now:number}):Promise<H48ExecutionJournal>;
}
export interface H48OrderVenueReadback {
  read():Promise<H48SignedVenueSnapshot>;
}
export type H48OrderExecutionOutcome =
  | Readonly<{status:"RECONCILED_OPEN"|"RECONCILED_FLAT"|"MANUAL_REVIEW";clientOrderId:string;ordersAttempted:1}>
  | Readonly<{status:"SUBMITTED_RECONCILIATION_REQUIRED";clientOrderId:string;ordersAttempted:1}>;

const forbid=(reason:string):never=>{throw Error("H48_ORDER_EXECUTOR_BLOCKED:"+reason)};
const validSha=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{40}$/.test(v);
const validHex=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
const validUuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const pos=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>0;
function verifyGrant(g:H48ScopedOwnerOrderGrant,p:H48OrderIntent,sha:string,now:number){
  if(!g||g.schema!=="disdex-h48-production-order-grant/v2"||g.scope!=="HYPE_TREND_LONG"
    ||!validSha(g.approvedSha)||g.approvedSha!==sha
    ||!validHex(g.planSha256)||g.certificateSha256!==p.certificateSha256
    ||!validHex(g.certificateSha256)
    ||g.clientOrderId!==p.clientOrderId||g.phase!==p.phase
    ||!validUuid(g.approvalId)||!Number.isSafeInteger(g.issuedAt)
    ||!Number.isSafeInteger(g.expiresAt)||g.issuedAt>now
    ||g.expiresAt<=now||g.expiresAt-g.issuedAt>5*60_000
    ||!pos(g.maxEntryNotionalUsd)||!pos(g.maxSlippageBps)||g.maxSlippageBps>100
    ||!pos(g.grossCapHype)||g.grossCapHype>1.5
    ||g.stopGovernanceCertified!==true)forbid("ROOT_OWNER_GRANT_NOT_ATTESTED");
}

/**
 * NOTE: The preSubmit verifier is a formal Root-facing dependency, not
 * a production implementation. The live factory must validate a real
 * signed file and Kill Switch release, it cannot be replaced by a Boolean.
 */
export class H48NativeOrderExecutor {
  constructor(private readonly dependencies:{
    sourceSha:string;
    store:H48OrderStateStore;
    executor:Pick<DirectTradeExecutor,
      "normalizeMarketQuantity"|"getAccountSnapshot"|"executeMarket"|"reconcileOrder">;
    lease:AccountLockHandle;
    rootGrant:H48RootGrantVerifier;
    signedVenue:H48OrderVenueReadback;
    /** Fresh global permission is mandatory only for exposure-increasing ENTRY. */
    assertGlobalOrderRelease:()=>Promise<void>;
    /** ENTRY must pass shared risk, hard-stop and Gross before exposure. */
    assertFreshSharedRiskAndStops:()=>Promise<void>;
    /** EXIT has its own Root-authorized reduce-only HOLD_PROTECTED semantics.
     * The live factory must re-read owned HYPE quantity and STOP lineage;
     * daily loss or GLOBAL HOLD must never silently authorize an ENTRY. */
    assertProtectedReduceOnlyExitAllowed:()=>Promise<void>;
    now?:()=>number;
  }){
    if(!validSha(dependencies.sourceSha))forbid("SOURCE_SHA");
  }
  async submitPrepared():Promise<H48OrderExecutionOutcome>{
    const d=this.dependencies;
    const now=d.now??Date.now;
    const state=validateH48ExecutionJournal(await d.store.load(),d.sourceSha);
    const intent=state.pending;
    if(!intent||intent.stage!=="PREPARED"
      ||state.mode!==(intent.phase==="ENTRY"?"ENTRY_PENDING":"EXIT_PENDING"))
      forbid("NO_PREPARED_INTENT");
    const pending=intent!;
    if(!pos(pending.quantity)||!pos(pending.referencePrice))forbid("PRICE_OR_QUANTITY");
    const before=now();
    const grant=await d.rootGrant.verifyForOrder({
      pending,runtimeSha:d.sourceSha,lease:d.lease,now:before,
    });
    verifyGrant(grant,pending,d.sourceSha,before);
    // Revalidate all mutable safety conditions after the signed grant was
    // verified. The real factory MUST check canonical Kill, Owner release,
    // STOP, DD30, Gross, Shared Risk and the Root certificate on every order.
    if(pending.phase==="ENTRY"){
      await d.assertGlobalOrderRelease();
      await d.assertFreshSharedRiskAndStops();
    }else{
      await d.assertProtectedReduceOnlyExitAllowed();
    }
    const account=await d.executor.getAccountSnapshot();
    if(!account||account.asset!=="USDT"||!pos(account.walletBalance)
       ||!Number.isSafeInteger(account.updatedAt)
       ||Math.abs(now()-account.updatedAt)>30_000)forbid("ASTER_ACCOUNT_UNVERIFIED");
    const norm=await d.executor.normalizeMarketQuantity(
      "HYPEUSDT",pending.quantity,pending.referencePrice,
      {allowBelowMinNotional:pending.phase==="EXIT"},
    );
    if(norm.symbol!=="HYPEUSDT"||norm.quantity!==pending.quantity
       ||!pos(norm.notional))forbid("ASTER_QUANTITY_PARITY");
    if(pending.phase==="ENTRY"&&(norm.notional>grant.maxEntryNotionalUsd
       ||norm.notional/account.walletBalance>grant.grossCapHype))forbid("OWNER_GROSS");
    // Pre-existing position on EXIT must have been validated separately by
    // the signed POSITION authority; reserve only for exposure increases.
    let reservation:AccountReservation|undefined;
    if(pending.phase==="ENTRY"){
      reservation=await d.lease.reserve({
        strategyId:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",
        gross:norm.notional/account.walletBalance,
        notionalUsd:norm.notional,
      });
    }
    let submitted:H48ExecutionJournal;
    try {
      const attempted=markH48OrderAttempted(state,now());
      // Fully durable SUBMITTED state precedes *any* order request.
      submitted=await d.store.save(state,attempted,d.lease);
    }catch(err){
      // Reservation is safe to release because executeMarket was never called.
      if(reservation)await d.lease.releaseReservation(reservation.reservationId);
      throw err;
    }
    const command:DirectTradeCommand={
      requestId:pending.clientOrderId,clientOrderId:pending.clientOrderId,
      symbol:"HYPEUSDT",side:pending.phase==="ENTRY"?"BUY":"SELL",
      quantity:pending.quantity,positionSide:"BOTH",
      reduceOnly:pending.phase==="EXIT",
      expectedPrice:pending.referencePrice,
      maxSlippageBps:grant.maxSlippageBps,
      reason:pending.phase==="ENTRY"?"H48_APPROVED_ENTRY":"H48_TIME48_APPROVED_EXIT",
      requireVenueMargin5xCross:pending.phase==="ENTRY",
      ...(pending.phase==="ENTRY"?{maxEntryNotionalUsd:grant.maxEntryNotionalUsd}:{}),
    };
    // After this point an exception means UNKNOWN execution; do NOT retry,
    // clear the journal, release a reservation, or assume a flat account.
    try {
      await d.executor.executeMarket(command);
    }catch{
      return {status:"SUBMITTED_RECONCILIATION_REQUIRED",
        clientOrderId:pending.clientOrderId,ordersAttempted:1};
    }
    let proof:DirectTradeResult,venue:H48SignedVenueSnapshot;
    try {
      // The immediate POST result is not sufficient; GET the order by exact
      // client ID and independently read back the account/venue position.
      proof=await d.executor.reconcileOrder("HYPEUSDT",pending.clientOrderId);
      venue=await d.signedVenue.read();
      const reconciled=reconcileH48Attempt(submitted,{
        result:proof,venue,now:now(),
      });
      await d.store.save(submitted,reconciled,d.lease,{
        result:proof,venue,now:now(),
      });
      if(reconciled.mode==="MANUAL_REVIEW")return {
        status:"MANUAL_REVIEW",clientOrderId:pending.clientOrderId,ordersAttempted:1,
      };
      if(reservation)await d.lease.releaseReservation(reservation.reservationId);
      return {status:reconciled.mode==="OPEN"?"RECONCILED_OPEN":"RECONCILED_FLAT",
        clientOrderId:pending.clientOrderId,ordersAttempted:1};
    }catch {
      return {status:"SUBMITTED_RECONCILIATION_REQUIRED",
        clientOrderId:pending.clientOrderId,ordersAttempted:1};
    }
  }
}
