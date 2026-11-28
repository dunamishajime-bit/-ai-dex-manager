/** Offline-only pre-entry stop+gap projected DD headroom; no order authority.
 * In particular, DD30 is NOT a max realized loss guarantee: stale or
 * incomplete marks, missing native STOP proof, gaps beyond the configured
 * reserve, fees/funding, order slippage and correlation invalidate it.
 */
import {evaluatePortfolioDdEntry,type PortfolioDdState} from "./stable4-portfolio-cumulative-dd";

export type SourceOnlyProtectedPosition=Readonly<{
  id:string;side:"LONG"|"SHORT";entryPrice:number;markPrice:number;
  protectiveStopPrice:number;entryNotionalUsd:number;stopProofKnown:boolean;
}>;
export type SourceOnlyEntryCandidate=Readonly<{
  id:string;side:"LONG"|"SHORT";entryPriceProxy:number;
  protectiveStopPrice:number;gross:number;
}>;
export type SourceOnlyProjectedStopReserveInput=Readonly<{
  dd:PortfolioDdState|undefined;atMs:number;releaseSha:string;
  allOwnersReconciled:boolean;openPositions:readonly SourceOnlyProtectedPosition[];
  candidate:SourceOnlyEntryCandidate;
  ddLimit?:number;gapReservePct?:number;roundTripCostBps?:number;
}>;
export type SourceOnlyStopReserveResult=Readonly<{
  status:"ELIGIBLE_OFFLINE"|"BLOCKED";reason:string;
  currentEquityUsd?:number;normalizedPeakEquivalentUsd?:number;
  projectedOtherStopLossUsd?:number;projectedCandidateStopLossUsd?:number;
  projectedAfterStopEquityUsd?:number;minimumEquityUsd?:number;
  orderAuthority:false;liveRiskProof:false;guaranteedDrawdownBound:false;
}>;
const finitePositive=(x:number)=>Number.isFinite(x)&&x>0;
function worseStop(p:{side:"LONG"|"SHORT";entryPrice:number;stopPrice:number}){
  if(!finitePositive(p.entryPrice)||!finitePositive(p.stopPrice))return false;
  return p.side==="LONG"?p.stopPrice<p.entryPrice:p.stopPrice>p.entryPrice;
}
export function evaluateSourceOnlyProjectedStopReserve(x:SourceOnlyProjectedStopReserveInput):SourceOnlyStopReserveResult{
  const blocked=(reason:string):SourceOnlyStopReserveResult=>({status:"BLOCKED",reason,orderAuthority:false,
    liveRiskProof:false,guaranteedDrawdownBound:false});
  if(!x||!x.dd||!Number.isSafeInteger(x.atMs)||!x.releaseSha)return blocked("SOURCE_ONLY_RISK_MARK_OR_INPUT_MISSING");
  if(!x.allOwnersReconciled||!Array.isArray(x.openPositions))return blocked("SOURCE_ONLY_FOREIGN_OWNERS_OR_POSITIONS_NOT_RECONCILED");
  const ddLimit=x.ddLimit??.30,gap=x.gapReservePct??.02,bps=x.roundTripCostBps??30;
  if(!finitePositive(ddLimit)||ddLimit>1||!Number.isFinite(gap)||gap<0||gap>.50||
     !Number.isFinite(bps)||bps<0||bps>1000)return blocked("SOURCE_ONLY_RISK_ASSUMPTIONS_INVALID");
  const prior=evaluatePortfolioDdEntry(x.dd,x.atMs,x.releaseSha,ddLimit);
  if(prior.status!=="ELIGIBLE_OFFLINE")return blocked(prior.reason);
  const {equity,index,peak}=x.dd;
  if(!finitePositive(equity)||!finitePositive(index)||!finitePositive(peak))return blocked("SOURCE_ONLY_RISK_PEAK_UNAVAILABLE");
  const peakEquivalent=equity*peak/index;
  if(!finitePositive(peakEquivalent)||peakEquivalent+1e-9<equity)return blocked("SOURCE_ONLY_RISK_PEAK_INVALID");
  const candidate=x.candidate;
  if(!candidate||!candidate.id||!worseStop({side:candidate.side,entryPrice:candidate.entryPriceProxy,
       stopPrice:candidate.protectiveStopPrice})||!finitePositive(candidate.gross)||candidate.gross>3.5)
    return blocked("SOURCE_ONLY_CANDIDATE_UNPROTECTED_OR_INVALID");
  const seen=new Set<string>([candidate.id]);
  let alreadyRisk=0;
  for(const p of x.openPositions){
    if(!p||!p.id||seen.has(p.id)||p.stopProofKnown!==true||
       !worseStop({side:p.side,entryPrice:p.entryPrice,stopPrice:p.protectiveStopPrice})||
       !finitePositive(p.markPrice)||!finitePositive(p.entryNotionalUsd))
      return blocked("SOURCE_ONLY_UNPROTECTED_OR_DUPLICATE_OPEN_POSITION");
    seen.add(p.id);
    if(p.side==="LONG"?p.markPrice<=p.protectiveStopPrice:p.markPrice>=p.protectiveStopPrice)
      return blocked("SOURCE_ONLY_OPEN_STOP_ALREADY_BREACHED");
    // How much value could be lost *from the current mark*, not at entry;
    // a protective stop is not a signed venue fill or execution guarantee.
    const adverse=p.side==="LONG"?p.markPrice-p.protectiveStopPrice:p.protectiveStopPrice-p.markPrice;
    const loss=p.entryNotionalUsd*(adverse/p.entryPrice+gap*p.markPrice/p.entryPrice+bps/20000);
    if(!Number.isFinite(loss)||loss<0)return blocked("SOURCE_ONLY_OPEN_STOP_RESERVE_OVERFLOW");
    alreadyRisk+=loss;
  }
  const newNotional=equity*candidate.gross;
  const stopMove=Math.abs(candidate.entryPriceProxy-candidate.protectiveStopPrice)/candidate.entryPriceProxy;
  const newLoss=newNotional*(stopMove+gap+bps/10000);
  const floor=peakEquivalent*(1-ddLimit);
  const projected=equity-alreadyRisk-newLoss;
  if(!Number.isFinite(alreadyRisk)||!Number.isFinite(newLoss)||!Number.isFinite(floor)||
     !Number.isFinite(projected)||!Number.isFinite(newNotional))
    return blocked("SOURCE_ONLY_RISK_PROJECTION_OVERFLOW");
  const values={currentEquityUsd:equity,normalizedPeakEquivalentUsd:peakEquivalent,
    projectedOtherStopLossUsd:alreadyRisk,projectedCandidateStopLossUsd:newLoss,
    projectedAfterStopEquityUsd:projected,minimumEquityUsd:floor};
  if(projected<floor-1e-9)return {...blocked("PROJECTED_STOP_PLUS_GAP_DD30_RESERVE_BLOCK"),...values};
  return {status:"ELIGIBLE_OFFLINE",reason:"PROJECTED_STOP_PLUS_GAP_DD30_HEADROOM_MODEL_ONLY",
    ...values,orderAuthority:false,liveRiskProof:false,guaranteedDrawdownBound:false};
}
