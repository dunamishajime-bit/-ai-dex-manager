/**
 * Cross-runner, real-venue-source risk PRECHECK for the next signed release.
 * This is non-authorizing, immutable-source-pin-safe and never sends orders,
 * issues grants or clears GLOBAL HOLD. A successful value does not waive
 * the live Root/Owner/STOP8, hold release, single-writer or signed GET gate.
 */
import type {H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import type {SharedKillSwitchView} from "./disdex-shared-kill-switch";
import type {PortfolioDdGovernorState} from "./disdex-portfolio-dd-governor";
import {validateSharedCryptoDailyRisk} from "./disdex-shared-crypto-daily-risk";
import {normalizePendingExposureRegistry,aggregatePendingExposure,type PendingExposureRegistry}
  from "./disdex-pending-exposure-registry";
import {classifyAsterSymbol} from "./disdex-aster-portfolio-classifier";
import {evaluateOwnerStable4HardGross} from "./stable4-dd30-owner-hard-gross-candidate";

export type H48AllRunnerRiskObservation=Readonly<{
  now:number;
  accountEquityUsd:number;
  venue:H48SignedVenueSnapshot;
  pending:PendingExposureRegistry;
  sharedDailyRisk:unknown;
  ddState:PortfolioDdGovernorState;
  marginGuard:{stage:string;ordersAllowed:boolean;checkedAt:number};
  killSwitch:SharedKillSwitchView;
  requestedHypeNotionalUsd:number;
}>;
export type H48AllRunnerRiskPrecheck=Readonly<{
  status:"SOURCE_EVIDENCE_READY_NOT_AUTHORIZED"|"BLOCKED";
  blockers:readonly string[];
  actualGross:Readonly<{crypto:number;stock:number;total:number;hype:number}>;
  pendingGross:Readonly<{crypto:number;stock:number;hype:number}>;
  tradingAuthorization:false;
}>;
function result(blockers:string[],actualGross:{crypto:number;stock:number;total:number;hype:number},
  pendingGross:{crypto:number;stock:number;hype:number}):H48AllRunnerRiskPrecheck {
  return Object.freeze({
    status:blockers.length?"BLOCKED" as const:"SOURCE_EVIDENCE_READY_NOT_AUTHORIZED" as const,
    blockers:Object.freeze([...new Set(blockers)]),
    actualGross:Object.freeze(actualGross),pendingGross:Object.freeze(pendingGross),
    tradingAuthorization:false as const,
  });
}
export function inspectH48AllRunnerGrossAndRisk(input:H48AllRunnerRiskObservation):H48AllRunnerRiskPrecheck {
  const reasons:string[]=[];
  const empty={crypto:0,stock:0,total:0,hype:0};
  const noPending={crypto:0,stock:0,hype:0};
  const {now}=input;
  if(!Number.isSafeInteger(now)||now<=0||!Number.isFinite(input.accountEquityUsd)
    ||input.accountEquityUsd<=0||!Number.isFinite(input.requestedHypeNotionalUsd)
    ||input.requestedHypeNotionalUsd<0)
    return result(["ACCOUNT_OR_CLOCK_INVALID"],empty,noPending);
  const v=input.venue;
  if(v?.source!=="ASTER_SIGNED_READ_ONLY"
    ||!Number.isSafeInteger(v.observedAt)
    ||v.observedAt>now||now-v.observedAt>30_000
    ||!Array.isArray(v.positions)||!Array.isArray(v.openOrders))
    return result(["SIGNED_ASTER_GET_MISSING_STALE"],empty,noPending);
  // No additional H48 ENTRY is possible while a venue HYPE conditional
  // order is outstanding, regardless of whether the pending ledger is flat.
  if(v.openOrders.some(o=>o?.symbol==="HYPEUSDT"))
    return result(["HYPE_OPEN_ORDER_REQUIRES_SIGNED_OWNERSHIP_RECONCILIATION"],empty,noPending);
  let crypto=0,stock=0,hype=0,malformed=false;
  for(const p of v.positions){
    if(!p||typeof p.symbol!=="string"||!Number.isFinite(p.quantity)
      ||!Number.isFinite(p.notionalUsd)||p.notionalUsd<0
      ||!Number.isSafeInteger(p.updatedAt)||p.updatedAt>now
      ||now-p.updatedAt>30_000){
      malformed=true;break;
    }
    if(Math.abs(p.quantity)<1e-10)continue;
    const group=classifyAsterSymbol(p.symbol);
    if(!group.tradable||group.assetClass==="UNKNOWN"){malformed=true;break}
    const gross=p.notionalUsd/input.accountEquityUsd;
    if(group.assetClass==="CRYPTO")crypto+=gross;
    else stock+=gross;
    if(p.symbol==="HYPEUSDT")hype+=gross;
  }
  if(malformed)return result(["ASTER_POSITIONS_INCONSISTENT_OR_UNKNOWN_SYMBOL"],empty,noPending);
  const actual={crypto,stock,total:crypto+stock,hype};
  let pend=noPending;
  try{
    const normalized=normalizePendingExposureRegistry(input.pending);
    if(normalized.accountScope!=="ASTER_FUTURES"
      ||normalized.updatedAt>now||now-normalized.updatedAt>90_000)
      reasons.push("PENDING_REGISTRY_SCOPE_OR_FRESHNESS");
    const totals=aggregatePendingExposure(normalized);
    pend={
      crypto:totals.cryptoGross,
      stock:totals.stockGross,
      hype:totals.byStrategyGross.HYPE_LONG??0,
    };
  }catch{reasons.push("PENDING_REGISTRY_MALFORMED");}
  const risk=validateSharedCryptoDailyRisk(input.sharedDailyRisk,now);
  if(!risk.ok||risk.state?.maximumLossPct!==7.5
    ||typeof risk.state?.lossPct!=="number"
    ||risk.state.lossPct>7.5)
    reasons.push("SHARED_DAILY_RISK_UNVERIFIED_OR_TRIPPED");
  const dd=input.ddState;
  if(dd?.schema!=="disdex-portfolio-dd-governor/v1"
    ||!Number.isSafeInteger(dd.updatedAt)||dd.updatedAt>now
    ||now-dd.updatedAt>120_000||!Number.isFinite(dd.currentDrawdownPct)
    ||dd.currentDrawdownPct<0||dd.currentDrawdownPct>=30)
    reasons.push("DD30_ENTRY_HOLD_OR_STALE");
  const margin=input.marginGuard;
  if(margin?.stage!=="HEALTHY"||margin.ordersAllowed!==true
    ||!Number.isSafeInteger(margin.checkedAt)||margin.checkedAt>now
    ||now-margin.checkedAt>15*60_000)
    reasons.push("MARGIN_GUARD_NOT_HEALTHY");
  const kill=input.killSwitch;
  if(!kill||kill.active!==false||kill.configuredPaths?.length!==1
    ||kill.configuredPaths[0]!=="/var/lib/disdex/shared/kill-switch.json")
    reasons.push("CANONICAL_GLOBAL_HOLD_OR_KILL_UNVERIFIED");
  const budget=evaluateOwnerStable4HardGross({
    currentCrypto:crypto,currentStock:stock,currentHype:hype,
    pendingCrypto:pend.crypto,pendingStock:pend.stock,pendingHype:pend.hype,
    requestedCrypto:input.requestedHypeNotionalUsd/input.accountEquityUsd,
    requestedStock:0,
    requestedHype:input.requestedHypeNotionalUsd/input.accountEquityUsd,
  });
  if(budget.status!=="WITHIN_ABSOLUTE_CAPS_NOT_AUTHORIZED")
    reasons.push(...budget.reasons);
  return result(reasons,actual,pend);
}
