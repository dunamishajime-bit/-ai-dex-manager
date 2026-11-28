/**
 * Seven-runner cumulative DD attribution from reconciled net MTM PnL.
 * This is an account-equity contribution index, NOT standalone capital DD
 * and NOT a substitute for Shared Risk or an issuer-signed live admission.
 * No reset on UTC day/runner restart. Never manufacture missing PnL as zero.
 */
export const RUNNER_DD_SCHEMA = "disdex-runner-cumulative-dd/v1" as const;
export const RUNNER_DD_IDS = ["V4","Q102","PENGU","FET","IDLE","HYPE","V52"] as const;
export type RunnerDdId = typeof RUNNER_DD_IDS[number];
export type RunnerDdAmounts = Readonly<Record<RunnerDdId,number>>;
export type RunnerDdObservation = Readonly<{
  atMs:number;
  exactReleaseSha:string;
  proofId:string;
  accountEquityUsd:number;
  externalNetFlowUsd:number;
  netMtmPnlUsd:RunnerDdAmounts;
  provenance:"SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED";
}>;
export type RunnerDdIndexRow = Readonly<{
  index:number;
  peak:number;
  currentDd:number;
  maximumDd:number;
}>;
export type RunnerDdState = Readonly<{
  schema:typeof RUNNER_DD_SCHEMA;
  releaseSha:string;
  updatedAt:number;
  proofId:string;
  accountEquityUsd:number;
  netMtmPnlUsd:RunnerDdAmounts;
  runners:Readonly<Record<RunnerDdId,RunnerDdIndexRow>>;
}>;
const valid=(x:number)=>typeof x==="number"&&Number.isFinite(x);
const eligible=(x:number)=>valid(x)&&x>0;
const err=(code:string):never=>{throw Error("RUNNER_CUMULATIVE_DD_"+code);};
function validate(obs:RunnerDdObservation){
  if(!obs||!Number.isSafeInteger(obs.atMs)||obs.atMs<=0||!eligible(obs.accountEquityUsd)
    ||!valid(obs.externalNetFlowUsd)||!/^([a-f0-9]{40})$/.test(obs.exactReleaseSha)
    ||typeof obs.proofId!=="string"||!obs.proofId||obs.proofId.length>160
    ||obs.provenance!=="SIGNED_ACCOUNT_MARK_AND_RUNNER_LEDGER_RECONCILED")
    err("INVALID_OR_UNVERIFIED_OBSERVATION");
  if(!obs.netMtmPnlUsd||Object.keys(obs.netMtmPnlUsd).length!==RUNNER_DD_IDS.length
    ||RUNNER_DD_IDS.some(k=>!Object.prototype.hasOwnProperty.call(obs.netMtmPnlUsd,k)
      ||!valid(obs.netMtmPnlUsd[k])))err("MISSING_RUNNER_NET_MTM");
}
export function initializeRunnerCumulativeDd(obs:RunnerDdObservation):RunnerDdState{
  validate(obs);
  if(obs.externalNetFlowUsd!==0)err("BASELINE_EXTERNAL_FLOW_FORBIDDEN");
  const runners=Object.fromEntries(RUNNER_DD_IDS.map(k=>[k,{index:1,peak:1,currentDd:0,maximumDd:0}])) as Record<RunnerDdId,RunnerDdIndexRow>;
  return {schema:RUNNER_DD_SCHEMA,releaseSha:obs.exactReleaseSha,updatedAt:obs.atMs,
    proofId:obs.proofId,accountEquityUsd:obs.accountEquityUsd,
    netMtmPnlUsd:{...obs.netMtmPnlUsd},runners};
}
export function advanceRunnerCumulativeDd(
  prior:RunnerDdState,obs:RunnerDdObservation,
):RunnerDdState{
  validate(obs);
  if(!prior||prior.schema!==RUNNER_DD_SCHEMA||!eligible(prior.accountEquityUsd)
    ||!Number.isSafeInteger(prior.updatedAt)||prior.updatedAt<=0
    ||typeof prior.proofId!=="string"||!prior.proofId||prior.proofId.length>160
    ||RUNNER_DD_IDS.some(k=>!prior.runners?.[k]||!valid(prior.netMtmPnlUsd?.[k])
      ||!eligible(prior.runners[k].index)||!eligible(prior.runners[k].peak)
      ||prior.runners[k].peak<prior.runners[k].index
      ||!valid(prior.runners[k].currentDd)||!valid(prior.runners[k].maximumDd)
      ||prior.runners[k].currentDd<0||prior.runners[k].maximumDd>1
      ||prior.runners[k].maximumDd<prior.runners[k].currentDd-1e-12
      ||Math.abs(prior.runners[k].currentDd-Math.max(0,1-prior.runners[k].index/prior.runners[k].peak))>1e-9))
    err("STATE_INVALID");
  if(obs.exactReleaseSha!==prior.releaseSha||obs.atMs<=prior.updatedAt
    ||obs.proofId===prior.proofId)err("PROOF_OR_TIME_REPLAY");
  const pnlDelta=RUNNER_DD_IDS.reduce((sum,k)=>sum+obs.netMtmPnlUsd[k]-prior.netMtmPnlUsd[k],0);
  const accountDelta=obs.accountEquityUsd-prior.accountEquityUsd-obs.externalNetFlowUsd;
  if(!valid(accountDelta)||!valid(pnlDelta)||Math.abs(accountDelta-pnlDelta)>Math.max(0.00001,1e-8*Math.max(
    Math.abs(prior.accountEquityUsd),Math.abs(obs.accountEquityUsd))))
    err("ACCOUNT_TO_RUNNER_MTM_RECONCILIATION_FAILED");
  const runners={} as Record<RunnerDdId,RunnerDdIndexRow>;
  for(const k of RUNNER_DD_IDS){
    const old=prior.runners[k],delta=obs.netMtmPnlUsd[k]-prior.netMtmPnlUsd[k];
    const factor=1+delta/prior.accountEquityUsd;
    if(!eligible(factor))err("RUNNER_EQUITY_INDEX_NONPOSITIVE");
    const index=old.index*factor,peak=Math.max(old.peak,index);
    if(!eligible(index)||!eligible(peak))err("RUNNER_EQUITY_INDEX_NONPOSITIVE");
    const currentDd=Math.max(0,1-index/peak);
    runners[k]={index,peak,currentDd,maximumDd:Math.max(old.maximumDd,currentDd)};
  }
  return {schema:RUNNER_DD_SCHEMA,releaseSha:prior.releaseSha,updatedAt:obs.atMs,
    proofId:obs.proofId,accountEquityUsd:obs.accountEquityUsd,
    netMtmPnlUsd:{...obs.netMtmPnlUsd},runners};
}
export type RunnerDdAdmission=Readonly<{
  status:"ENTRY_ALLOWED_BY_THIS_DD_ONLY"|"BLOCKED";
  reason:string;
  orderAuthority:false;
  runnerMaxDd:number|undefined;
}>;
/** A result here cannot authorize orders; all other risk/Owner gates still apply. */
export function evaluateRunnerDdEntry(
  state:RunnerDdState|undefined,runner:RunnerDdId,atMs:number,releaseSha:string,
  maximumDd=0.30,maxAgeMs=120_000,
):RunnerDdAdmission{
  const block=(reason:string):RunnerDdAdmission=>({status:"BLOCKED",reason,
    orderAuthority:false,runnerMaxDd:state?.runners?.[runner]?.maximumDd});
  if(!RUNNER_DD_IDS.includes(runner)||!state||state.schema!==RUNNER_DD_SCHEMA
    ||state.releaseSha!==releaseSha||!/^[a-f0-9]{40}$/.test(releaseSha))return block("RUNNER_DD_SOURCE_UNAVAILABLE");
  if(!Number.isSafeInteger(atMs)||!Number.isSafeInteger(state.updatedAt)||state.updatedAt<=0
    ||!eligible(state.accountEquityUsd)||typeof state.proofId!=="string"||!state.proofId||state.proofId.length>160
    ||atMs<state.updatedAt||atMs-state.updatedAt>maxAgeMs
    ||!eligible(maxAgeMs)||!eligible(maximumDd)||maximumDd>1)
    return block("RUNNER_DD_STALE_OR_INVALID");
  const r=state.runners[runner];
  if(!r||!valid(r.maximumDd)||!valid(r.currentDd)||!eligible(r.peak)
    ||!eligible(r.index)||r.peak<r.index||r.currentDd<0
    ||r.maximumDd<r.currentDd-1e-12||r.maximumDd>1
    ||Math.abs(r.currentDd-Math.max(0,1-r.index/r.peak))>1e-9)
    return block("RUNNER_DD_STATE_INVALID");
  if(r.maximumDd>maximumDd+1e-12)return block("RUNNER_CUMULATIVE_MAX_DD_EXCEEDED");
  return {status:"ENTRY_ALLOWED_BY_THIS_DD_ONLY",reason:"RUNNER_CUMULATIVE_DD_WITHIN_LIMIT",
    runnerMaxDd:r.maximumDd,orderAuthority:false};
}
