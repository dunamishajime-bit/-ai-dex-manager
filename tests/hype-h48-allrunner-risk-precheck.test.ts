import {strict as assert} from "node:assert";
import {test} from "node:test";
import {inspectH48AllRunnerGrossAndRisk,type H48AllRunnerRiskObservation}
  from "../lib/hype-h48-allrunner-risk-precheck";
import {buildSharedCryptoDailyRiskState,SHARED_CRYPTO_STRATEGIES}
  from "../lib/disdex-shared-crypto-daily-risk";
import {initialPortfolioDdGovernor} from "../lib/disdex-portfolio-dd-governor";
import {emptyPendingExposureRegistry,type PendingExposureRegistry} from "../lib/disdex-pending-exposure-registry";
const NOW=Date.UTC(2026,10,26,12);
function base():H48AllRunnerRiskObservation{
  const risk=buildSharedCryptoDailyRiskState({
    accountScope:"ASTER_FUTURES",utcDay:new Date(NOW).toISOString().slice(0,10),
    strategyIds:[...SHARED_CRYPTO_STRATEGIES],lossPct:0,maximumLossPct:7.5,
    tripped:false,updatedAt:NOW,
    realizedPnl:0,unrealizedPnl:0,fees:0,funding:0,netDailyPnl:0,referenceEquity:100,
    sourceComplete:true,
  });
  return {
    now:NOW,accountEquityUsd:1000,requestedHypeNotionalUsd:100,
    venue:{source:"ASTER_SIGNED_READ_ONLY",observedAt:NOW-1000,
      positions:[{symbol:"BTCUSDT",quantity:1,entryPrice:100,markPrice:110,
        notionalUsd:1500,unrealizedPnl:0,pnlPct:0,
        positionSide:"BOTH",leverage:5,updatedAt:NOW-1000}],
      openOrders:[]},
    pending:emptyPendingExposureRegistry(NOW),
    sharedDailyRisk:risk,
    ddState:initialPortfolioDdGovernor(NOW,1000),
    marginGuard:{stage:"HEALTHY",ordersAllowed:true,checkedAt:NOW},
    killSwitch:{configuredPaths:["/var/lib/disdex/shared/kill-switch.json"],active:false},
  };
}
test("full 7-runner market/risk data can pass source precheck, never authorize any order",()=>{
  const r=inspectH48AllRunnerGrossAndRisk(base());
  assert.equal(r.status,"SOURCE_EVIDENCE_READY_NOT_AUTHORIZED");
  assert.equal(r.tradingAuthorization,false);
  assert.equal(r.actualGross.crypto,1.5);
});
test("GLOBAL HOLD or missing Risk/ DD or margin never upgrades precheck into LIVE",()=>{
  const a=base();
  for(const update of [
    {killSwitch:{configuredPaths:["/var/lib/disdex/shared/kill-switch.json"],
      active:true,action:"HOLD_PROTECTED" as const,scope:"GLOBAL" as const}},
    {marginGuard:{stage:"FAILED",ordersAllowed:false,checkedAt:NOW}},
    {ddState:{...a.ddState,currentDrawdownPct:31}},
    {venue:{...a.venue,observedAt:NOW-300000}},
    {sharedDailyRisk:{...a.sharedDailyRisk,updatedAt:NOW-400000}},
  ]){
    const r=inspectH48AllRunnerGrossAndRisk({...a,...update});
    assert.equal(r.status,"BLOCKED");
    assert.equal(r.tradingAuthorization,false);
    assert.ok(r.blockers.length);
  }
});
test("UNKNOWN pending crypto/HYPE exposure consumes headroom before new H48 order",()=>{
  const a=base(),pending:PendingExposureRegistry={
    ...emptyPendingExposureRegistry(NOW),
    entries:[{reservationId:"reserve-1",strategyId:"HYPE_LONG",sleeve:"CRYPTO",
      symbol:"HYPEUSDT",side:"LONG",gross:1.6,notionalUsd:1600,
      status:"UNKNOWN",createdAt:NOW-1000,updatedAt:NOW-1000}],
  };
  const r=inspectH48AllRunnerGrossAndRisk({...a,pending});
  assert.equal(r.status,"BLOCKED");
  assert.ok(r.blockers.includes("OWNER_GROSS_HARD_CAP_CRYPTO"));
  assert.ok(r.blockers.includes("OWNER_GROSS_HARD_CAP_HYPE"));
  assert.equal(r.pendingGross.hype,1.6);
});
test("actual signed stock+crypto leverage cannot exceed strict total4.25 or stock4",()=>{
  const a=base();
  const stock={...a.venue.positions[0],symbol:"NVDAUSDT",notionalUsd:3000};
  const r=inspectH48AllRunnerGrossAndRisk({
    ...a,venue:{...a.venue,positions:[...a.venue.positions,stock]},
  });
  assert.equal(r.status,"BLOCKED");
  assert.ok(r.blockers.includes("OWNER_GROSS_HARD_CAP_TOTAL"));
  assert.equal(r.actualGross.total,4.5);
});
test("unknown venue symbol, stale pending ledger and NaN signed position fail closed",()=>{
  const a=base();
  const r=inspectH48AllRunnerGrossAndRisk({...a,venue:{...a.venue,
    positions:[{...a.venue.positions[0],symbol:"UNLISTEDUSDT"}]}});
  assert.equal(r.status,"BLOCKED");
  assert.ok(r.blockers.includes("ASTER_POSITIONS_INCONSISTENT_OR_UNKNOWN_SYMBOL"));
  const stale=inspectH48AllRunnerGrossAndRisk({...a,pending:{...a.pending,updatedAt:NOW-120000}});
  assert.ok(stale.blockers.includes("PENDING_REGISTRY_SCOPE_OR_FRESHNESS"));
  const nan=inspectH48AllRunnerGrossAndRisk({...a,venue:{...a.venue,
    positions:[{...a.venue.positions[0],quantity:NaN}]}});
  assert.ok(nan.blockers.includes("ASTER_POSITIONS_INCONSISTENT_OR_UNKNOWN_SYMBOL"));
});
