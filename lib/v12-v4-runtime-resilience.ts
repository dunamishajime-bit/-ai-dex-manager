import {classifyAsterRateBudgetFailure} from "./disdex-aster-rate-budget-policy";

export type V4RuntimeTickView={
 status:string;
 reason?:string;
 eventTs:number;
 candidateCount:number;
 orderEnabled:boolean;
};

export type V4TransientInfrastructureDeferral={
 result:V4RuntimeTickView;
 retryMs:number;
};

export const V4_RATE_BUDGET_DEFERRED_PREFIX="V4_RATE_BUDGET_DEFERRED:";

function bounded(value:number,fallback:number,min:number,max:number){
 const n=Number(value);
 if(!Number.isFinite(n))return fallback;
 return Math.max(min,Math.min(max,Math.trunc(n)));
}

export function classifyV4TransientInfrastructureFailure(
 error:unknown,now:number=Date.now(),
):V4TransientInfrastructureDeferral|undefined{
 const rate=classifyAsterRateBudgetFailure(error);
 if(!rate)return undefined;
 const retryMs=bounded(Number(rate.waitMs),5_000,1_000,15_000);
 return {
  result:{
   status:"observing",
   reason:V4_RATE_BUDGET_DEFERRED_PREFIX+rate.reason,
   eventTs:now,
   candidateCount:0,
   orderEnabled:false,
  },
  retryMs,
 };
}

export function nextV4DaemonWaitMs(
 result:Pick<V4RuntimeTickView,"status"|"reason">,
 options:{
  now?:number;
  normalIntervalMs?:number;
  lockRetryMs?:number;
  phaseOffsetMs?:number;
 }={},
){
 const now=Number.isFinite(options.now)?Number(options.now):Date.now();
 const reason=String(result.reason??"");
 const rawRateReason=reason.startsWith(V4_RATE_BUDGET_DEFERRED_PREFIX)
  ?reason.slice(V4_RATE_BUDGET_DEFERRED_PREFIX.length):reason;
 const rate=classifyAsterRateBudgetFailure(new Error(rawRateReason));
 if(rate)return bounded(Number(rate.waitMs),5_000,1_000,15_000);
 if(result.status==="locked")return bounded(Number(options.lockRetryMs),5_000,1_000,15_000);

 const interval=bounded(Number(options.normalIntervalMs),60_000,15_000,300_000);
 const phaseRaw=bounded(Number(options.phaseOffsetMs),17_000,0,interval-1);
 const phase=((phaseRaw%interval)+interval)%interval;
 const mod=((Math.trunc(now)%interval)+interval)%interval;
 let delay=phase-mod;
 if(delay<1_000)delay+=interval;
 return delay;
}
