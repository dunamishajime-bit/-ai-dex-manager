/** Offline-only account-wide cumulative drawdown state. Not proof of live authorization.
 * Neutralize external deposits/withdrawals through a time-weighted index.
 * Peak and maximum DD survive day rollover and runner restart.
 * Real-money use requires a separate root-verified account mark source.
 */
export const STABLE4_PORTFOLIO_DD_SCHEMA="stable4-portfolio-cumulative-dd/v1" as const;
export type EquityMark=Readonly<{
 atMs:number;releaseSha:string;proofId:string;
 equity:number;externalNetFlow:number;
 source:"OFFLINE_RECONCILED_MTM_ONLY";
}>;
export type PortfolioDdState=Readonly<{
 schema:typeof STABLE4_PORTFOLIO_DD_SCHEMA;releaseSha:string;updatedAt:number;proofId:string;
 equity:number;index:number;peak:number;currentDd:number;maximumDd:number;
 source:"OFFLINE_RECONCILED_MTM_ONLY";
}>;
function check(o:EquityMark){
 if(!o||!Number.isSafeInteger(o.atMs)||o.atMs<=0||!Number.isFinite(o.equity)||o.equity<=0||
 !Number.isFinite(o.externalNetFlow)||!/^([0-9a-f]{40})$/.test(o.releaseSha)||
 typeof o.proofId!=="string"||!o.proofId||o.proofId.length>160||
 o.source!=="OFFLINE_RECONCILED_MTM_ONLY")throw Error("PORTFOLIO_DD_UNVERIFIED_MARK");
}
export function initializePortfolioDd(o:EquityMark):PortfolioDdState{
 check(o);if(o.externalNetFlow!==0)throw Error("PORTFOLIO_DD_INITIAL_EXTERNAL_FLOW");
 return {schema:STABLE4_PORTFOLIO_DD_SCHEMA,releaseSha:o.releaseSha,proofId:o.proofId,
 updatedAt:o.atMs,equity:o.equity,index:1,peak:1,currentDd:0,maximumDd:0,source:o.source};
}
export function advancePortfolioDd(p:PortfolioDdState,o:EquityMark):PortfolioDdState{
 check(o);
 if(!p||p.schema!==STABLE4_PORTFOLIO_DD_SCHEMA||p.source!=="OFFLINE_RECONCILED_MTM_ONLY"||
 !Number.isFinite(p.index)||p.index<=0||!Number.isFinite(p.peak)||p.peak<p.index||
 !Number.isFinite(p.maximumDd)||p.maximumDd<0||p.maximumDd>1||
 !Number.isFinite(p.equity)||p.equity<=0)throw Error("PORTFOLIO_DD_STATE_INVALID");
 if(o.releaseSha!==p.releaseSha||o.atMs<=p.updatedAt||o.proofId===p.proofId)throw Error("PORTFOLIO_DD_CLOCK_OR_PROOF_REPLAY");
 const growth=(o.equity-o.externalNetFlow)/p.equity;
 if(!Number.isFinite(growth)||growth<=0)throw Error("PORTFOLIO_DD_EQUITY_OR_FLOW_INVALID");
 const index=p.index*growth,peak=Math.max(p.peak,index);
 const currentDd=Math.max(0,1-index/peak),maximumDd=Math.max(p.maximumDd,currentDd);
 return {...p,updatedAt:o.atMs,proofId:o.proofId,equity:o.equity,index,peak,currentDd,maximumDd};
}
export type PortfolioDdGate=Readonly<{status:"ELIGIBLE_OFFLINE"|"BLOCKED";reason:string;currentDd?:number;maximumDd?:number;orderAuthority:false}>;
export function evaluatePortfolioDdEntry(p:PortfolioDdState|undefined,atMs:number,releaseSha:string,limit=0.30,maxAgeMs=120000):PortfolioDdGate{
 const blocked=(reason:string):PortfolioDdGate=>({status:"BLOCKED",reason,currentDd:p?.currentDd,maximumDd:p?.maximumDd,orderAuthority:false});
 if(!p||p.schema!==STABLE4_PORTFOLIO_DD_SCHEMA||p.source!=="OFFLINE_RECONCILED_MTM_ONLY"||p.releaseSha!==releaseSha)return blocked("PORTFOLIO_DD_MARK_UNAVAILABLE");
 if(!Number.isSafeInteger(atMs)||atMs<p.updatedAt||atMs-p.updatedAt>maxAgeMs||
 !Number.isFinite(p.equity)||p.equity<=0||!Number.isFinite(p.index)||p.index<=0||
 !Number.isFinite(p.peak)||p.peak<p.index||!Number.isFinite(p.maximumDd)||p.maximumDd<0||p.maximumDd>1||
 !Number.isFinite(p.currentDd)||p.currentDd<0||p.currentDd>p.maximumDd+1e-12||
 !Number.isFinite(limit)||limit<=0||limit>1)return blocked("PORTFOLIO_DD_STALE_OR_INVALID");
 if(p.maximumDd>limit+1e-12)return blocked("PORTFOLIO_CUMULATIVE_MAX_DD_EXCEEDED");
 return {status:"ELIGIBLE_OFFLINE",reason:"PORTFOLIO_CUMULATIVE_DD_WITHIN_LIMIT",currentDd:p.currentDd,maximumDd:p.maximumDd,orderAuthority:false};
}
