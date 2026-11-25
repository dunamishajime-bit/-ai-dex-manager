import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  auditH48LiveReadiness,H48_CERTIFIED_GROSS_CAPS,
  type H48GateObservation,
} from "../lib/hype-h48-production-gates";
import { buildSharedCryptoDailyRiskState,SHARED_CRYPTO_STRATEGIES } from "../lib/disdex-shared-crypto-daily-risk";

const NOW=Date.UTC(2026,10,25,14,30);
function ready():H48GateObservation{
  const risk=buildSharedCryptoDailyRiskState({
    accountScope:"ASTER_FUTURES",utcDay:"2026-11-25",
    strategyIds:[...SHARED_CRYPTO_STRATEGIES],lossPct:1,
    maximumLossPct:7.5,tripped:false,updatedAt:NOW,
    realizedPnl:0,unrealizedPnl:-1,fees:0,funding:0,netDailyPnl:-1,
    referenceEquity:100,sourceComplete:true,
  });
  return {
    now:NOW,
    killSwitch:{configuredPaths:["/var/lib/disdex/shared/kill-switch.json"],active:false},
    sharedDailyRisk:risk,
    existingOwnerApprovedPlanGross:{...H48_CERTIFIED_GROSS_CAPS},
    effectiveRunnerGross:{...H48_CERTIFIED_GROSS_CAPS},
    marginGuard:{stage:"HEALTHY",ordersAllowed:true,checkedAt:NOW},
    pendingExposureCount:0,ddDrawdownPct:20,
    residentStopRequiredByOwner:false,h48CertificateResidentStopRequired:false,
  };
}

test("even passing read-only risk observations NEVER authorize a H48 LIVE order",()=>{
  const result=auditH48LiveReadiness(ready());
  assert.equal(result.status,"BLOCKED");
  assert.equal(result.ordersAllowed,false);
  assert.equal(result.tradingMutations,0);
  assert.deepEqual(result.blockers,["NEW_SHA_ROOT_OWNER_ORDER_PERMIT_NOT_ATTESTED"]);
});

test("actual GLOBAL HOLD and original lower Gross Owner plan remain explicit blockers",()=>{
  const data=ready();
  data.killSwitch={configuredPaths:["/var/lib/disdex/shared/kill-switch.json"],active:true,
    scope:"GLOBAL",action:"HOLD_PROTECTED",reason:"STABLE4_RESEARCH_ROLLOUT:e0e4f1d8"};
  data.existingOwnerApprovedPlanGross={crypto:3,stock:1.5,total:3.5,hype:1};
  const result=auditH48LiveReadiness(data);
  assert.ok(result.blockers.includes("GLOBAL_HOLD_OR_KILL_SWITCH_UNVERIFIED"));
  assert.ok(result.blockers.includes("OWNER_PLAN_GROSS_CAP_CONFLICT"));
  assert.equal(result.ordersAllowed,false);
});

test("STOP policy conflict, DD, stale risk, margin and pending exposure all block",()=>{
  const data=ready();
  data.residentStopRequiredByOwner=true;
  data.ddDrawdownPct=31;
  data.marginGuard={stage:"STALE",ordersAllowed:true,checkedAt:NOW-3600000};
  data.pendingExposureCount=1;
  data.sharedDailyRisk={...(data.sharedDailyRisk as object),updatedAt:NOW-7200000};
  const blockers=auditH48LiveReadiness(data).blockers;
  assert.ok(blockers.includes("H48_TIME_ONLY_VS_PROTECTIVE_STOP_POLICY_UNRESOLVED"));
  assert.ok(blockers.includes("DD30_NOT_VERIFIED"));
  assert.ok(blockers.includes("MARGIN_GUARD_NOT_FRESH_AND_HEALTHY"));
  assert.ok(blockers.includes("PENDING_EXPOSURE_NOT_FLAT"));
  assert.ok(blockers.some(x=>x.startsWith("SHARED_DAILY_RISK_")));
  assert.equal(auditH48LiveReadiness(data).tradingMutations,0);
});

test("missing or altered effective Gross is not accepted as an Owner-approved upgrade",()=>{
  const data=ready();
  data.effectiveRunnerGross={crypto:3,stock:4,total:4.25,hype:1};
  assert.ok(auditH48LiveReadiness(data).blockers.includes("EFFECTIVE_RUNNER_GROSS_CAP_CONFLICT"));
  data.effectiveRunnerGross={...H48_CERTIFIED_GROSS_CAPS};
  data.existingOwnerApprovedPlanGross={crypto:3,stock:4,total:4.25,hype:1.5};
  assert.deepEqual(auditH48LiveReadiness(data).blockers,["NEW_SHA_ROOT_OWNER_ORDER_PERMIT_NOT_ATTESTED"]);
});
