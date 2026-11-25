/**
 * Native H48 STOP8 strategy coordinator for a future immutable LIVE runner.
 *
 * This module is NOT an installed VPS service, order permit or approval. The
 * only path to an order is through H48NativeOrderExecutor which independently
 * verifies the current exact Root/Owner cert, scoped permit, single writer,
 * Global HOLD release, Shared Risk, DD, Margin Guard and STOP8. Calls from
 * this coordinator do not replace any of these checks.
 *
 * UNKNOWN/pending, stale STOP or unmatched live position never cause a
 * duplicate order. Research grid progress remains durable in both FLAT and
 * OPEN modes so BASE-before-WSIG six-hour replay does not skip clocks.
 */
import type {AccountLockHandle} from "./disdex-account-order-lock";
import type {H48ExecutionJournal,H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import {advanceH48ResearchSequence} from "./hype-h48-research-sequence";
import {checkpointH48ResearchGrid} from "./hype-h48-execution-journal";
import type {H48ClosedHour,H48EntryBoundary} from "./hype-h48-research-entry";
import {
  prepareH48Stop8Entry,prepareH48Stop8TimeExit,type H48Stop8RootPositionEvidence,
} from "./hype-h48-stop8-policy-intent";
import {assessH48ProtectedRestart} from "./hype-h48-protected-restart";
import type {H48Stop8Intent} from "./hype-h48-resident-stop8";
import type {H48Stop8Retirement} from "./hype-h48-stop8-retirement";
import type {H48OrderExecutionOutcome} from "./hype-h48-native-order-executor";
import {
  inspectH48AllRunnerGrossAndRisk,type H48AllRunnerRiskObservation,
} from "./hype-h48-allrunner-risk-precheck";
import {evaluateHypeH48TimeOnlyExit} from "./hype-stable4-time-only-contract";

export type H48NativeCoordinatorDecision=Readonly<{
  status:"HOLD_PROTECTED"|"RESEARCH_RECORDED"|"POSITION_PROTECTED"|"ORDER_HANDOFF";
  reason:string;
  tradingAuthorization:false;
  orderOutcome?:H48OrderExecutionOutcome;
}>;
export interface H48NativeOrderJournal {
  load():Promise<H48ExecutionJournal>;
  save(before:H48ExecutionJournal,after:H48ExecutionJournal,lease:AccountLockHandle):Promise<H48ExecutionJournal>;
}
export interface H48NativePositionPolicyAuthority {
  attestPosition(input:{
    contract:NonNullable<H48ExecutionJournal["position"]>["contract"];
    quantity:number;lease:AccountLockHandle;now:number;
  }):Promise<H48Stop8RootPositionEvidence>;
}
const held=(reason:string):H48NativeCoordinatorDecision=>({
  status:"HOLD_PROTECTED",reason,tradingAuthorization:false,
});
export class H48NativeStop8Coordinator {
  constructor(private readonly dep:{
    sourceSha:string;planSha256:string;lease:AccountLockHandle;
    store:H48NativeOrderJournal;
    signedVenue:()=>Promise<H48SignedVenueSnapshot>;
    stop8:()=>Promise<H48Stop8Intent|null>;
    stopRetirement:()=>Promise<H48Stop8Retirement|null>;
    root:H48NativePositionPolicyAuthority;
    readAllRunnerRisk:()=>Promise<H48AllRunnerRiskObservation>;
    order:{submitPrepared():Promise<H48OrderExecutionOutcome>};
    now?:()=>number;
  }){
    if(!/^[a-f0-9]{40}$/.test(dep.sourceSha)
       ||!/^[a-f0-9]{64}$/.test(dep.planSha256))
      throw Error("H48_NATIVE_COORDINATOR_INVALID_PIN");
  }
  async tick(input:{
    entry?:H48EntryBoundary;hypeClosed?:readonly H48ClosedHour[];
    btcClosed?:readonly H48ClosedHour[];
    exitBoundary?:{openTs:number;open:number;observedAt:number};
    requestedQuantity?:number;
  }):Promise<H48NativeCoordinatorDecision>{
    const d=this.dep,now=(d.now??Date.now)();
    if(!Number.isSafeInteger(now)||now<=0)return held("CLOCK_NOT_ATTESTED");
    let state=await d.store.load();
    const venue=await d.signedVenue();
    const stop=await d.stop8(),receipt=await d.stopRetirement();
    const safe=assessH48ProtectedRestart({
      journal:state,stop8:stop,stopRetirement:receipt,venue,
      runtimeSha:d.sourceSha,planSha256:d.planSha256,now,
    });
    if(safe.decision==="HOLD_PROTECTED_RECONCILIATION")
      return held(safe.reason);
    if(state.mode!=="FLAT"&&state.mode!=="OPEN")
      return held("PENDING_DO_NOT_RETRY");
    // Do not skip a 6h grid merely because an already-owned position is
    // protected. Persist the research clock before any attempt at an entry.
    if(input.entry){
      if(!input.hypeClosed||!input.btcClosed)
        return held("H48_CLOSED_H1_MISSING");
      const sequence=advanceH48ResearchSequence({
        state:state.research,runtimeSha:d.sourceSha,now,entry:input.entry,
        hypeClosed:input.hypeClosed,btcClosed:input.btcClosed,
        existingHypePosition:state.mode!=="FLAT",
      });
      const checkpoint=checkpointH48ResearchGrid(state,sequence);
      state=await d.store.save(state,checkpoint,d.lease);
      if(state.mode==="FLAT"&&sequence.decision.status==="RESEARCH_CANDIDATE"){
        const qty=input.requestedQuantity;
        if(typeof qty!=="number"||!Number.isFinite(qty)||qty<=0)
          return held("ENTRY_QUANTITY_NOT_CERTIFIED");
        const risk=inspectH48AllRunnerGrossAndRisk(await d.readAllRunnerRisk());
        if(risk.status!=="SOURCE_EVIDENCE_READY_NOT_AUTHORIZED")
          return held("PORTFOLIO_RISK_OR_GROSS_BLOCKED:"+risk.blockers.join(","));
        const c=sequence.decision.contract;
        if(!c)return held("ENTRY_CONTRACT_NOT_ATTESTED");
        const proof=await d.root.attestPosition({
          contract:c,quantity:qty,lease:d.lease,now,
        });
        const pending=prepareH48Stop8Entry({
          state,contract:c,evidence:proof,planSha256:d.planSha256,
          quantity:qty,referencePrice:input.entry.open,now,
        });
        await d.store.save(state,pending,d.lease);
        const outcome=await d.order.submitPrepared();
        return {status:"ORDER_HANDOFF",reason:"H48_STOP8_ENTRY_ROOT_ORDER_HANDOFF",
          orderOutcome:outcome,tradingAuthorization:false};
      }
    }
    if(state.mode==="FLAT")
      return {status:"RESEARCH_RECORDED",reason:"NO_H48_ENTRY_CANDIDATE",
        tradingAuthorization:false};
    if(!state.position)return held("OPEN_POSITION_STATE_MISSING");
    if(!input.exitBoundary)
      return {status:"POSITION_PROTECTED",reason:"H48_STOP8_POSITION_MONITORED",
        tradingAuthorization:false};
    const due=evaluateHypeH48TimeOnlyExit(state.position.contract,now,input.exitBoundary);
    if(!due.due)
      return {status:"POSITION_PROTECTED",reason:"H48_TIME48_NOT_DUE",
        tradingAuthorization:false};
    // CLOSE is allowed during canonical HOLD only under the distinct Root
    // protected reduce-only authorization inside H48NativeOrderExecutor.
    const proof=await d.root.attestPosition({
      contract:state.position.contract,quantity:state.position.quantity,
      lease:d.lease,now,
    });
    const pending=prepareH48Stop8TimeExit({
      state,contract:state.position.contract,
      evidence:proof,planSha256:d.planSha256,
      signedProtectedRestart:safe,exitBoundary:input.exitBoundary,now,
    });
    await d.store.save(state,pending,d.lease);
    const outcome=await d.order.submitPrepared();
    return {status:"ORDER_HANDOFF",reason:"H48_TIME48_REDUCE_ONLY_ROOT_ORDER_HANDOFF",
      orderOutcome:outcome,tradingAuthorization:false};
  }
}
