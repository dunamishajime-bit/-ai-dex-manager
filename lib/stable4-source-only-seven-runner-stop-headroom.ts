/** Research-only composition of 7-runner DD/Gross/ownership and STOP+gap headroom.
 * Nothing in this module sends orders, provides signed venue STOP evidence,
 * or changes the existing pinned LIVE / Owner authorization path.
 */
import {evaluateStable4DryEntry,type RiskInput,type Decision} from "./stable4-seven-runner-dryrun-gate";
import {evaluateSourceOnlyProjectedStopReserve,type SourceOnlyProtectedPosition} from "./stable4-source-only-stop-reserve";

export type ProtectedResearchEntry=Readonly<{
  dryRun:RiskInput;
  protectedOpen:readonly SourceOnlyProtectedPosition[];
  candidateEntryPriceProxy:number;
  candidateProtectiveStopPrice:number;
  allOwnersReconciled:boolean;
  gapReservePct?:number;
  roundTripCostBps?:number;
}>;
export type ProtectedResearchDecision=Decision&Readonly<{
  projectedStopRiskUsd?:number;projectedAfterStopEquityUsd?:number;
  liveRiskProof:false;guaranteedDrawdownBound:false;
}>;
export function evaluateSevenRunnerDryEntryWithProjectedStopHeadroom(x:ProtectedResearchEntry):ProtectedResearchDecision{
  const blocked=(reason:string,ddMax?:number):ProtectedResearchDecision=>({status:"BLOCKED",reason,
    ddMax,orderAuthority:false,liveRiskProof:false,guaranteedDrawdownBound:false});
  if(!x||!x.dryRun)return blocked("SEVEN_RUNNER_STOP_HEADROOM_INPUT_MISSING");
  const base=evaluateStable4DryEntry(x.dryRun);
  if(base.status!=="ELIGIBLE_OFFLINE")return {...base,liveRiskProof:false,guaranteedDrawdownBound:false};
  if(!Array.isArray(x.protectedOpen)||x.protectedOpen.length!==x.dryRun.open.length||
    x.dryRun.open.some(r=>r.status!=="OPEN")||
    new Set(x.protectedOpen.map(r=>r?.id)).size!==x.protectedOpen.length||
    x.dryRun.open.some(r=>!x.protectedOpen.some(p=>p?.id===r.id)))
    return blocked("SEVEN_RUNNER_OPEN_STOP_PROOF_NOT_RECONCILED",base.ddMax);
  const c=x.dryRun.candidate;
  if(c.route.startsWith("R21_")){
    if(c.sleeve!=="V4"||c.side!=="SHORT"||
       !Number.isFinite(x.candidateEntryPriceProxy)||x.candidateEntryPriceProxy<=0||
       !Number.isFinite(x.candidateProtectiveStopPrice)||
       Math.abs(x.candidateProtectiveStopPrice/x.candidateEntryPriceProxy-1.08)>1e-8)
      return blocked("R21_SOURCE_STOP8_PRICE_NOT_PINNED",base.ddMax);
  }
  const risk=evaluateSourceOnlyProjectedStopReserve({
    dd:x.dryRun.portfolioDdState,atMs:x.dryRun.asof,releaseSha:x.dryRun.releaseSha,
    allOwnersReconciled:x.allOwnersReconciled,openPositions:x.protectedOpen,
    candidate:{id:c.id,side:c.side,entryPriceProxy:x.candidateEntryPriceProxy,
      protectiveStopPrice:x.candidateProtectiveStopPrice,gross:c.gross},
    gapReservePct:x.gapReservePct,roundTripCostBps:x.roundTripCostBps,ddLimit:.30,
  });
  if(risk.status!=="ELIGIBLE_OFFLINE")return {...blocked(risk.reason,base.ddMax),
    projectedStopRiskUsd:risk.projectedOtherStopLossUsd!==undefined&&
      risk.projectedCandidateStopLossUsd!==undefined?
      risk.projectedOtherStopLossUsd+risk.projectedCandidateStopLossUsd:undefined,
    projectedAfterStopEquityUsd:risk.projectedAfterStopEquityUsd};
  return {status:"ELIGIBLE_OFFLINE",reason:"SEVEN_RUNNER_DD_GROSS_AND_PROJECTED_STOP_HEADROOM_MODEL_ONLY",
    ddMax:base.ddMax,orderAuthority:false,liveRiskProof:false,guaranteedDrawdownBound:false,
    projectedStopRiskUsd:risk.projectedOtherStopLossUsd!+risk.projectedCandidateStopLossUsd!,
    projectedAfterStopEquityUsd:risk.projectedAfterStopEquityUsd};
}
