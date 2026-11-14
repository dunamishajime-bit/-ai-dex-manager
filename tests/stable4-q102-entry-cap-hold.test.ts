import test from "node:test";
import assert from "node:assert/strict";
import {Quality102CausalV1Runner} from "../lib/disdex-quality102-causal-v1-runner";
import {QUALITY102_CAUSAL_V1} from "../config/disdexQuality102CausalV1Runtime";
import {Stable4EntryGrossAdmissionError} from "../lib/stable4-entry-gross-guard";
test("Q102 before-send Stable4 hold releases exact reservation without execution-unknown review",async()=>{
 let command:any,released:string|undefined;
 const state:any={failures:[],pending:{phase:"planned",symbol:"UNIUSDT",side:"SELL",quantity:1,targetGross:.75,reduceOnly:false,idempotencyKey:"candidate",clientOrderId:"entry-cid",expectedPrice:100}};
 const store={save:async()=>{}};
 const runner:any=new Quality102CausalV1Runner({config:{...QUALITY102_CAUSAL_V1,symbols:["UNIUSDT"],mode:"LIVE",maxSlippageBps:20},stateStore:store,now:()=>1800000000000,executor:{normalizeMarketQuantity:async()=>({quantity:1,notional:100}),executeMarket:async(c:any)=>{command=c;throw new Stable4EntryGrossAdmissionError("TOTAL_CAP_EXCEEDED");}}} as any);
 runner.validatePendingExecutionWindow=async()=>({expectedPrice:100,equity:1000});
 const document=async()=>({schema:"disdex-account-lock/v1",accountScope:"ASTER_FUTURES",ownerId:"Q102",leaseId:"lease",acquiredAt:1800000000000,expiresAt:1800000120000,reservations:[]});
 const result=await runner.executePending(state,{document,reserve:async()=>({reservationId:"only-own-reservation"}),releaseReservation:async(id:string)=>{released=id;}});
 assert.equal(result.status,"blocked-local");assert.equal(result.ordersSent,0);assert.equal(state.pending,undefined);assert.equal(state.manualReview,undefined);
 assert.equal(released,"only-own-reservation");assert.equal(command.stable4Admission.ownReservationId,"only-own-reservation");assert.equal(command.stable4Admission.lease.document,document);
});
