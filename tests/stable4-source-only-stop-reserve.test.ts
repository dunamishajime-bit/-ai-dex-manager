import test from "node:test";
import assert from "node:assert/strict";
import {initializePortfolioDd,advancePortfolioDd} from "../lib/stable4-portfolio-cumulative-dd";
import {evaluateSourceOnlyProjectedStopReserve} from "../lib/stable4-source-only-stop-reserve";
const sha="b".repeat(40),t=1_797_000_000_000;
const mark=(atMs:number,equity:number,id:string,flow=0)=>({atMs,equity,proofId:id,externalNetFlow:flow,
  releaseSha:sha,source:"OFFLINE_RECONCILED_MTM_ONLY" as const});
const init=initializePortfolioDd(mark(t,10000,"start"));
const candidate={id:"R21_no_order",side:"SHORT" as const,entryPriceProxy:100,protectiveStopPrice:108,gross:.30};
const baseline={dd:init,atMs:t,releaseSha:sha,allOwnersReconciled:true,openPositions:[],candidate};

test("source-only current DD zero, STOP8+2% gap+30bps reserve models 309 USD and never permits orders",()=>{
  const x=evaluateSourceOnlyProjectedStopReserve(baseline);
  assert.equal(x.status,"ELIGIBLE_OFFLINE");
  assert.equal(x.reason,"PROJECTED_STOP_PLUS_GAP_DD30_HEADROOM_MODEL_ONLY");
  assert.ok(Math.abs(x.projectedCandidateStopLossUsd!-309)<1e-9);
  assert.equal(x.projectedAfterStopEquityUsd,9691);
  assert.equal(x.minimumEquityUsd,7000);
  assert.equal(x.orderAuthority,false);
  assert.equal(x.liveRiskProof,false);
  assert.equal(x.guaranteedDrawdownBound,false);
});

test("29% drawdown despite current gate allowance must BLOCK new gross from STOP8+2% risk reserve",()=>{
  const dd=advancePortfolioDd(init,mark(t+60_000,7100,"loss29"));
  const x=evaluateSourceOnlyProjectedStopReserve({...baseline,dd,atMs:t+60_000});
  assert.equal(x.status,"BLOCKED");
  assert.equal(x.reason,"PROJECTED_STOP_PLUS_GAP_DD30_RESERVE_BLOCK");
  assert.equal(x.minimumEquityUsd,7000);
  assert.ok(x.projectedAfterStopEquityUsd!<7000);
  assert.equal(x.orderAuthority,false);
});

test("reserve includes all existing owner STOP-to-mark losses, gap and closing fees",()=>{
  const dd=advancePortfolioDd(init,mark(t+60_000,7900,"dd21"));
  const open=[{id:"IDLE",side:"LONG" as const,entryPrice:100,markPrice:90,
    protectiveStopPrice:85,entryNotionalUsd:12000,stopProofKnown:true}];
  const x=evaluateSourceOnlyProjectedStopReserve({...baseline,dd,atMs:t+60_000,openPositions:open});
  assert.equal(x.status,"BLOCKED");
  assert.equal(x.reason,"PROJECTED_STOP_PLUS_GAP_DD30_RESERVE_BLOCK");
  assert.ok(x.projectedOtherStopLossUsd!>800);
});

test("stale, signed-owner absence and tampered account mark BLOCK regardless of reserve arithmetic",()=>{
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,allOwnersReconciled:false}).reason,
    "SOURCE_ONLY_FOREIGN_OWNERS_OR_POSITIONS_NOT_RECONCILED");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,atMs:t+240_000}).reason,
    "PORTFOLIO_DD_STALE_OR_INVALID");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,releaseSha:"c".repeat(40)}).reason,
    "PORTFOLIO_DD_MARK_UNAVAILABLE");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,dd:undefined}).status,"BLOCKED");
  const dd=advancePortfolioDd(init,mark(t+60_000,7100,"loss29"));
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,dd:{...dd,currentDd:0},atMs:t+60_000}).status,"BLOCKED");
});

test("open STOP not proven, reversed, triggered, duplicate and missing are all fail-closed",()=>{
  const good={id:"other",side:"SHORT" as const,entryPrice:100,markPrice:104,
    protectiveStopPrice:108,entryNotionalUsd:1000,stopProofKnown:true};
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,openPositions:[{...good,stopProofKnown:false}]}).reason,
    "SOURCE_ONLY_UNPROTECTED_OR_DUPLICATE_OPEN_POSITION");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,openPositions:[{...good,markPrice:110}]}).reason,
    "SOURCE_ONLY_OPEN_STOP_ALREADY_BREACHED");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,openPositions:[good,good]}).status,"BLOCKED");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,openPositions:[{...good,protectiveStopPrice:95}]}).status,"BLOCKED");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,openPositions:undefined as any}).status,"BLOCKED");
});

test("candidate gross, STOP direction and adverse scenario assumptions cannot be malformed",()=>{
  for(const altered of [{gross:Infinity},{gross:-1},{gross:4},{entryPriceProxy:0},
    {protectiveStopPrice:99},{protectiveStopPrice:NaN},{id:""}]){
    const x=evaluateSourceOnlyProjectedStopReserve({...baseline,candidate:{...candidate,...altered}});
    assert.equal(x.status,"BLOCKED");
  }
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,gapReservePct:-.01}).status,"BLOCKED");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,roundTripCostBps:Infinity}).status,"BLOCKED");
  assert.equal(evaluateSourceOnlyProjectedStopReserve({...baseline,ddLimit:0}).status,"BLOCKED");
});

test("time-weighted net deposits do not erase cumulative 20% DD, and helper does not grant LIVE",()=>{
  const dd1=advancePortfolioDd(init,mark(t+60_000,8000,"down20"));
  const dd2=advancePortfolioDd(dd1,mark(t+120_000,13000,"plus5000",5000));
  const x=evaluateSourceOnlyProjectedStopReserve({...baseline,dd:dd2,atMs:t+120_000});
  assert.ok(Math.abs(dd2.maximumDd-.2)<1e-12);
  assert.ok(Math.abs(x.normalizedPeakEquivalentUsd!-16250)<1e-10);
  assert.equal(x.orderAuthority,false);
  assert.equal(x.liveRiskProof,false);
});
