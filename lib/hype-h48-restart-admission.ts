/**
 * H48 restart admission / reconciliation audit.
 *
 * Restarts NEVER submit or retry a venue order. The journal's existence,
 * exact SHA/revision, live account lock and fresh authenticated ASTER GET
 * must all be checked before an OPEN position can resume monitoring.
 * PENDING, corrupt/missing, unmanaged exposure and ambiguous inventory
 * cause an explicit protected HOLD; operator reconciliation is separate.
 */
import type { DirectTradeExecutor } from "./direct-trade-executor";
import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { H48ExecutionJournal, H48SignedVenueSnapshot } from "./hype-h48-execution-journal";
import { validateH48ExecutionJournal } from "./hype-h48-execution-journal";
import { readAuthenticatedH48Inventory } from "./hype-h48-authenticated-readback";

export type H48RecoveryAssessment =
  | Readonly<{decision:"FLAT_VERIFIED_READ_ONLY"|"OPEN_VERIFIED_READ_ONLY"; journal:H48ExecutionJournal;venue:H48SignedVenueSnapshot; ordersSent:0}>
  | Readonly<{decision:"HOLD_RECONCILIATION_REQUIRED"|"HOLD_MANUAL_REVIEW"|"HOLD_UNTRUSTED_INVENTORY"; reason:string; journal:H48ExecutionJournal;venue:H48SignedVenueSnapshot; ordersSent:0}>;

const bad=(reason:string):never=>{throw Error("H48_RESTART_ADMISSION_"+reason);};
const roughlyEqual=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-8);
function activeHype(v:H48SignedVenueSnapshot){
  if(v.openOrders.some(o=>o.symbol==="HYPEUSDT"))return {badOrders:true,positions:[]};
  return {badOrders:false,
    positions:v.positions.filter(p=>p.symbol==="HYPEUSDT"&&Math.abs(p.quantity)>1e-10)};
}
export function assessH48Restart(journal:H48ExecutionJournal,venue:H48SignedVenueSnapshot):H48RecoveryAssessment{
  const j=validateH48ExecutionJournal(journal,journal.sourceSha);
  if(!venue||venue.source!=="ASTER_SIGNED_READ_ONLY"
     ||!Array.isArray(venue.positions)||!Array.isArray(venue.openOrders)
     ||!Number.isSafeInteger(venue.observedAt)||venue.observedAt<=0)bad("SIGNED_GET_INVALID");
  const inv=activeHype(venue);
  if(inv.badOrders)return {decision:"HOLD_UNTRUSTED_INVENTORY",
    reason:"UNMANAGED_HYPE_OPEN_ORDER",journal:j,venue,ordersSent:0};
  if(j.mode==="MANUAL_REVIEW")return {decision:"HOLD_MANUAL_REVIEW",
    reason:j.reviewReason??"H48_MANUAL_REVIEW",journal:j,venue,ordersSent:0};
  if(j.mode==="ENTRY_PENDING"||j.mode==="EXIT_PENDING")return {
    decision:"HOLD_RECONCILIATION_REQUIRED",
    reason:j.pending?.stage==="SUBMITTED"?"VENUE_ORDER_QUERY_REQUIRED_NO_RETRY":"PREPARED_INTENT_RESTART_REQUIRES_REVIEW",
    journal:j,venue,ordersSent:0,
  };
  if(j.mode==="FLAT"){
    if(inv.positions.length!==0)return {decision:"HOLD_UNTRUSTED_INVENTORY",
      reason:"UNOWNED_HYPE_POSITION",journal:j,venue,ordersSent:0};
    return {decision:"FLAT_VERIFIED_READ_ONLY",journal:j,venue,ordersSent:0};
  }
  if(!j.position||inv.positions.length!==1
     ||inv.positions[0].quantity<=0
     ||!["BOTH","LONG"].includes(inv.positions[0].positionSide)
     ||!roughlyEqual(inv.positions[0].quantity,j.position.quantity)
     ||!roughlyEqual(inv.positions[0].entryPrice,j.position.entryPrice)){
    return {decision:"HOLD_UNTRUSTED_INVENTORY",
      reason:"H48_OPEN_POSITION_NOT_OWNED_OR_INCONSISTENT",journal:j,venue,ordersSent:0};
  }
  return {decision:"OPEN_VERIFIED_READ_ONLY",journal:j,venue,ordersSent:0};
}

export async function inspectH48Restart(input:{
  journalStore:Pick<{load():Promise<H48ExecutionJournal>},"load">;
  executor:Pick<DirectTradeExecutor,"getPositions"|"getOpenOrders"|"getAccountSnapshot">;
  lease:AccountLockHandle;
  runtimeSha:string;
  now?:()=>number;
}):Promise<H48RecoveryAssessment>{
  const state=validateH48ExecutionJournal(await input.journalStore.load(),input.runtimeSha);
  const venue=await readAuthenticatedH48Inventory({
    executor:input.executor,lease:input.lease,now:input.now,
  });
  return assessH48Restart(state,venue);
}
