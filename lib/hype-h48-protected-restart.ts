/**
 * H48 STOP8 candidate — non-mutating restart and EXIT protection audit.
 * The historic H48_TIME_ONLY permit is not adequate for this policy.
 *
 * This module does not issue an entry, exit, cancel, stop or Root permit.
 * It refuses to classify an unprotected HYPE long as OPEN_VERIFIED.
 */
import type {H48ExecutionJournal,H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import {validateH48ExecutionJournal} from "./hype-h48-execution-journal";
import type {H48Stop8Intent} from "./hype-h48-resident-stop8";
import {validateH48Stop8Intent,verifyH48Stop8Venue} from "./hype-h48-resident-stop8";
import {assessH48Restart} from "./hype-h48-restart-admission";

export type H48ProtectedRestartResult=Readonly<{
  decision:"FLAT_VERIFIED_READ_ONLY"|"OPEN_STOP8_VERIFIED_READ_ONLY"|"HOLD_PROTECTED_RECONCILIATION";
  reason:string;
  ordersSent:0;
  cancelsSent:0;
}>;
const held=(reason:string):H48ProtectedRestartResult=>({
  decision:"HOLD_PROTECTED_RECONCILIATION",reason,ordersSent:0,cancelsSent:0,
});
const pass=(decision:H48ProtectedRestartResult["decision"],reason:string):H48ProtectedRestartResult=>({
  decision,reason,ordersSent:0,cancelsSent:0,
});
const exact=(a:number,b:number,tol=1e-8)=>Number.isFinite(a)&&Number.isFinite(b)
  &&Math.abs(a-b)<=Math.max(tol,Math.abs(b)*1e-8);
export function assessH48ProtectedRestart(input:{
  journal:H48ExecutionJournal;
  stop8:H48Stop8Intent|null;
  venue:H48SignedVenueSnapshot;
  runtimeSha:string;
  planSha256:string;
  now:number;
}):H48ProtectedRestartResult {
  const {runtimeSha,planSha256,venue,now}=input;
  let state:H48ExecutionJournal,stop:H48Stop8Intent|null;
  try {
    state=validateH48ExecutionJournal(input.journal,runtimeSha);
    stop=input.stop8===null?null:validateH48Stop8Intent(input.stop8);
  }catch{return held("JOURNAL_OR_STOP_FILE_INVALID");}
  if(!/^[a-f0-9]{64}$/.test(planSha256)||!Number.isSafeInteger(now)||now<=0
     ||venue?.source!=="ASTER_SIGNED_READ_ONLY"
     ||!Number.isSafeInteger(venue.observedAt)
     ||venue.observedAt>now||now-venue.observedAt>30_000
     ||!Array.isArray(venue.positions)||!Array.isArray(venue.openOrders))
    return held("SIGNED_VENUE_OR_PLAN_UNVERIFIED");
  const hypeOrders=venue.openOrders.filter(o=>o?.symbol==="HYPEUSDT");
  if(state.mode==="FLAT") {
    // A STOP journal is never silently deleted. Any lingering HYPE STOP
    // after a confirmed 48-hour exit is a blocker for the next entry.
    if(stop!==null||hypeOrders.length!==0||venue.positions.some(p=>p?.symbol==="HYPEUSDT"&&Math.abs(p.quantity)>1e-9))
      return held("FLAT_BUT_HYPE_STOP_OR_POSITION_REMAINS");
    const base=assessH48Restart(state,venue);
    return base.decision==="FLAT_VERIFIED_READ_ONLY"
      ?pass("FLAT_VERIFIED_READ_ONLY","NO_HYPE_POSITION_OR_STOP")
      :held("BASE_RESTART_NOT_FLAT");
  }
  if(state.mode!=="OPEN"||!state.position)
    return held("PENDING_OR_MANUAL_REVIEW_DO_NOT_RETRY");
  if(!stop||stop.stage!=="CONFIRMED")
    return held("RESIDENT_STOP8_NOT_CONFIRMED");
  if(stop.sourceSha!==runtimeSha||stop.planSha256!==planSha256
    ||stop.positionId!==state.position.contract.positionId
    ||stop.entryClientOrderId!==state.position.entryClientOrderId
    ||stop.quantity!==state.position.quantity
    ||!exact(stop.entryPrice,state.position.entryPrice,stop.tickSize)
    ||!Number.isSafeInteger(stop.confirmedAt)||Number(stop.confirmedAt)>venue.observedAt)
    return held("STOP8_JOURNAL_POSITION_OR_PLAN_MISMATCH");
  try {
    // The venue verifier only accepts a SUBMITTED intent; re-check the
    // immutable confirmed record against a NEW signed GET without allowing
    // any record mutation.
    verifyH48Stop8Venue({...stop,stage:"SUBMITTED",confirmedAt:null},venue,now);
  }catch{return held("RESIDENT_STOP8_NOT_ON_SIGNED_VENUE");}
  if(hypeOrders.length!==1||hypeOrders[0].clientOrderId!==stop.stopClientOrderId)
    return held("UNMANAGED_HYPE_STOP_OR_ORDER");
  // The base restart engine must see a clean view AFTER exact protection
  // has been independently verified, not treat a known owned STOP as rogue.
  const cleanVenue={...venue,openOrders:venue.openOrders.filter(
    o=>!(o.symbol==="HYPEUSDT"&&o.clientOrderId===stop.stopClientOrderId)
  )};
  const base=assessH48Restart(state,cleanVenue);
  return base.decision==="OPEN_VERIFIED_READ_ONLY"
    ?pass("OPEN_STOP8_VERIFIED_READ_ONLY","HYPE_POSITION_AND_STOP8_SIGNED_READBACK_MATCH")
    :held("BASE_RESTART_POSITION_OR_ACCOUNT_MISMATCH");
}
