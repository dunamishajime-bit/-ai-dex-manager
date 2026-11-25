/**
 * H48 live-readiness audit (STRICTLY NON-AUTHORIZING).
 *
 * Gross/SharedRisk/STOP and Kill Switch must agree before issuing a new
 * H48 LIVE certificate/permit. This diagnostic can only return BLOCKED and
 * cannot be used as an entry permit or a production gate bypass.
 */
import type { SharedKillSwitchView } from "./disdex-shared-kill-switch";
import type { SharedCryptoDailyRiskState } from "./disdex-shared-crypto-daily-risk";
import { validateSharedCryptoDailyRisk } from "./disdex-shared-crypto-daily-risk";

export interface H48GrossCaps {
  crypto:number;stock:number;total:number;hype:number;
}
export const H48_CERTIFIED_GROSS_CAPS:Readonly<H48GrossCaps>=Object.freeze({
  crypto:3.0,stock:4.0,total:4.25,hype:1.5,
});
export interface H48GateObservation {
  now:number;
  killSwitch:SharedKillSwitchView;
  sharedDailyRisk:unknown;
  existingOwnerApprovedPlanGross:H48GrossCaps;
  effectiveRunnerGross:H48GrossCaps;
  marginGuard:{stage:string;ordersAllowed:boolean;checkedAt:number}|null;
  pendingExposureCount:number|null;
  ddDrawdownPct:number|null;
  residentStopRequiredByOwner:boolean;
  h48CertificateResidentStopRequired:boolean;
}
export type H48LiveReadinessAudit=Readonly<{
  status:"BLOCKED";ordersAllowed:false;tradingMutations:0;
  blockers:readonly string[];
}>;

function exactCaps(v:H48GrossCaps,expected:H48GrossCaps){
  return v&&Object.keys(expected).every(key=>{
    const k=key as keyof H48GrossCaps;
    return Number.isFinite(v[k])&&v[k]===expected[k];
  })&&Object.keys(v).length===Object.keys(expected).length;
}
export function auditH48LiveReadiness(input:H48GateObservation):H48LiveReadinessAudit {
  const reasons:string[]=[];
  const now=input.now;
  if(!Number.isSafeInteger(now)||now<=0)reasons.push("CLOCK_UNVERIFIED");
  if(!input.killSwitch||input.killSwitch.active!==false
     ||input.killSwitch.configuredPaths?.length!==1
     ||input.killSwitch.scope==="GLOBAL"&&input.killSwitch.active===true){
    reasons.push("GLOBAL_HOLD_OR_KILL_SWITCH_UNVERIFIED");
  }
  if(!exactCaps(input.existingOwnerApprovedPlanGross,H48_CERTIFIED_GROSS_CAPS))
    reasons.push("OWNER_PLAN_GROSS_CAP_CONFLICT");
  if(!exactCaps(input.effectiveRunnerGross,H48_CERTIFIED_GROSS_CAPS))
    reasons.push("EFFECTIVE_RUNNER_GROSS_CAP_CONFLICT");
  const risk=validateSharedCryptoDailyRisk(input.sharedDailyRisk,now);
  if(!risk.ok)reasons.push("SHARED_DAILY_RISK_"+(risk.reason||"INVALID"));
  const raw=risk.state??input.sharedDailyRisk as SharedCryptoDailyRiskState;
  if(!raw||raw.maximumLossPct!==7.5||!Number.isFinite(raw.lossPct)||raw.lossPct>7.5)
    reasons.push("DAILY_LOSS_LIMIT_NOT_ATTESTED");
  const margin=input.marginGuard;
  if(!margin||margin.stage!=="HEALTHY"||margin.ordersAllowed!==true
      ||!Number.isFinite(margin.checkedAt)||margin.checkedAt>now+1000
      ||now-margin.checkedAt>15*60_000)
    reasons.push("MARGIN_GUARD_NOT_FRESH_AND_HEALTHY");
  if(input.pendingExposureCount!==0)
    reasons.push("PENDING_EXPOSURE_NOT_FLAT");
  if(typeof input.ddDrawdownPct!=="number"||!Number.isFinite(input.ddDrawdownPct)
      ||input.ddDrawdownPct<0||input.ddDrawdownPct>30)
    reasons.push("DD30_NOT_VERIFIED");
  if(input.h48CertificateResidentStopRequired!==false||input.residentStopRequiredByOwner!==false)
    reasons.push("H48_TIME_ONLY_VS_PROTECTIVE_STOP_POLICY_UNRESOLVED");
  // Even if all non-authorizing observations happen to look healthy, the
  // complete signed Owner approval, Root cert, venue/writer + new SHA gates
  // have NOT been evaluated here and can never be inferred.
  reasons.push("NEW_SHA_ROOT_OWNER_ORDER_PERMIT_NOT_ATTESTED");
  return Object.freeze({
    status:"BLOCKED" as const,ordersAllowed:false as const,tradingMutations:0 as const,
    blockers:Object.freeze([...new Set(reasons)]),
  });
}
