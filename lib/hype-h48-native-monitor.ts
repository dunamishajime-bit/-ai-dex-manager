/**
 * H48 native MONITOR pipeline. End-to-end six-hour candidate and 48-hour
 * deadline observation, with a real journal store and authenticated venue
 * reads, but strictly NO order/cancel/position APIs or LIVE mutation.
 *
 * Production LIVE requires a separate formally reviewed executor, Root
 * certificate/new SHA, signed Owner activation, gross+STOP+Shared Risk+DD
 * and account-owner/ASTER writer gate. These cannot be inferred from SHADOW.
 */
import type { DirectTradeExecutor } from "./direct-trade-executor";
import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { H48ExecutionJournal } from "./hype-h48-execution-journal";
import type { H48ClosedHour,H48EntryBoundary } from "./hype-h48-research-entry";
import { advanceH48ResearchSequence } from "./hype-h48-research-sequence";
import { checkpointH48ResearchGrid } from "./hype-h48-execution-journal";
import { inspectH48Restart } from "./hype-h48-restart-admission";
import { readAuthenticatedH48Inventory } from "./hype-h48-authenticated-readback";
import {assessH48ProtectedRestart} from "./hype-h48-protected-restart";
import type {H48Stop8Intent} from "./hype-h48-resident-stop8";
import type {H48Stop8Retirement} from "./hype-h48-stop8-retirement";
import { evaluateHypeH48TimeOnlyExit } from "./hype-stable4-time-only-contract";

export type H48MonitorDecision =
  | Readonly<{status:"HOLD";reason:string;ordersSent:0}>
  | Readonly<{status:"RESEARCH_RECORDED";reason:string;candidate:boolean;ordersSent:0}>
  | Readonly<{status:"EXIT_NOT_DUE"|"EXIT_DUE_NOT_AUTHORIZED";reason:string;ordersSent:0}>;

export interface H48JournalStore {
  load():Promise<H48ExecutionJournal>;
  save(old:H48ExecutionJournal,newState:H48ExecutionJournal,lease:AccountLockHandle):Promise<H48ExecutionJournal>;
}
export class H48NativeReadOnlyMonitor {
  constructor(private readonly dependencies:{
    runtimeSha:string;
    store:H48JournalStore;
    executor:Pick<DirectTradeExecutor,"getPositions"|"getOpenOrders"|"getAccountSnapshot">;
    lease:AccountLockHandle;
    /** Required in a STOP8 policy SHADOW/LIVE source. No order methods. */
    protectedStop8?:{
      planSha256:string;
      stop8:()=>Promise<H48Stop8Intent|null>;
      stopRetirement:()=>Promise<H48Stop8Retirement|null>;
    };
    now?:()=>number;
  }){
    if(!/^[0-9a-f]{40}$/.test(dependencies.runtimeSha))throw Error("H48_MONITOR_SHA_INVALID");
  }
  async tick(input:{
    entry?:H48EntryBoundary;
    hypeClosed?:readonly H48ClosedHour[];
    btcClosed?:readonly H48ClosedHour[];
    exitBoundary?:{openTs:number;open:number;observedAt:number};
  }):Promise<H48MonitorDecision>{
    const d=this.dependencies;
    const clock=d.now??Date.now;
    const now=clock();
    if(!Number.isSafeInteger(now)||now<=0)throw Error("H48_MONITOR_CLOCK_INVALID");
    // A trusted journal and a complete, fresh authenticated account GET are
    // mandatory even for monitoring a position; missing file is NOT FLAT.
    let journal:H48ExecutionJournal;
    if(d.protectedStop8){
      const state=await d.store.load();
      const venue=await readAuthenticatedH48Inventory({
        executor:d.executor,lease:d.lease,now:clock,
      });
      const stop=await d.protectedStop8.stop8();
      const retirement=await d.protectedStop8.stopRetirement();
      const admission=assessH48ProtectedRestart({
        journal:state,stop8:stop,stopRetirement:retirement,
        venue,runtimeSha:d.runtimeSha,
        planSha256:d.protectedStop8.planSha256,now:clock(),
      });
      if(admission.decision==="HOLD_PROTECTED_RECONCILIATION")
        return {status:"HOLD",reason:admission.reason,ordersSent:0};
      journal=state;
    }else{
      const assessed=await inspectH48Restart({
        journalStore:d.store,executor:d.executor,lease:d.lease,
        runtimeSha:d.runtimeSha,now:clock,
      });
      if(assessed.decision==="HOLD_RECONCILIATION_REQUIRED"
         ||assessed.decision==="HOLD_MANUAL_REVIEW"
         ||assessed.decision==="HOLD_UNTRUSTED_INVENTORY")return {
        status:"HOLD",reason:assessed.reason,ordersSent:0,
      };
      journal=assessed.journal;
    }
    // Verify close only as research evidence: never call a venue executor.
    if(journal.mode==="OPEN"&&journal.position){
      const due=evaluateHypeH48TimeOnlyExit(journal.position.contract,now,input.exitBoundary);
      if(due.due)return {
        status:"EXIT_DUE_NOT_AUTHORIZED",
        reason:"HYPE_REDESIGN_TIME48_NEXTOPEN_AWAIT_OWNER_LIVE_EXECUTOR",ordersSent:0,
      };
      if(!input.entry)return {status:"EXIT_NOT_DUE",reason:"H48_POSITION_MONITORED",ordersSent:0};
    }
    if(!input.entry) return {status:"HOLD",reason:"H48_ENTRY_GRID_NOT_SUPPLIED",ordersSent:0};
    if(!input.hypeClosed||!input.btcClosed)return {
      status:"HOLD",reason:"H48_CLOSED_H1_DATA_MISSING",ordersSent:0,
    };
    const observed=advanceH48ResearchSequence({
      state:journal.research,runtimeSha:d.runtimeSha,now,
      entry:input.entry,hypeClosed:input.hypeClosed,
      btcClosed:input.btcClosed,
      existingHypePosition:journal.mode!=="FLAT",
    });
    const replacement=checkpointH48ResearchGrid(journal,observed);
    await d.store.save(journal,replacement,d.lease);
    return {
      status:"RESEARCH_RECORDED",
      reason:observed.decision.status,
      candidate:observed.decision.status==="RESEARCH_CANDIDATE",
      ordersSent:0,
    };
  }
}
