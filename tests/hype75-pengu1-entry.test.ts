import test from 'node:test';
import assert from 'node:assert/strict';
import { HYPE_TREND_LONG_POLICY } from '../config/hypeTrendLongPolicy';
import { buildHypeTrendSignal } from '../lib/hype-trend-long-signal';
import { buildPenguV8StrictGrossContract, isPenguFixedEntryAllocation } from '../lib/pengu-dual-ls-v2-portfolio-runner';
const H = 3600000;
function hypeBars(rate:number) {
 return Array.from({length:360},(_,i)=> {
  const close=100*Math.pow(1+rate,i)*(i===359?1.01:1);
  return {openTime:i*H,open:close,close,high:close+.01,low:close-.1,volume:1000};
 });
}
test('HYPE weaker EMA240 growth below75bps cannot enter',()=> {
 const bars=hypeBars(.00015);const s=buildHypeTrendSignal({btc:bars,hype:bars,now:360*H});
 assert.ok(s.regimeSlopeBps!==null && s.regimeSlopeBps>=25 && s.regimeSlopeBps<75);
 assert.equal(s.accepted,false);assert.equal(s.reason,'REGIME_SLOPE_NOT_MET');
 assert.equal(HYPE_TREND_LONG_POLICY.minimumRegimeSlopeBps,75);
});
test('HYPE stronger completed trend remains eligible',()=> {
 const bars=hypeBars(.0005);const s=buildHypeTrendSignal({btc:bars,hype:bars,now:360*H});
 assert.equal(s.accepted,true);assert.ok(s.regimeSlopeBps!>=75);
});
for(const oldGross of [.1875,.5,.6,1,1.25]) {
 test(`PENGU route request ${oldGross} submits full fixed1 notional with5x margin`,()=> {
  assert.deepEqual(buildPenguV8StrictGrossContract(oldGross,1000,300),{requestedGross:1,intentGross:1,intentNotionalUsd:1000});
 });
}
test('PENGU reduced allocation and lower runtime cap cannot authorize a new order',()=> {
 assert.equal(isPenguFixedEntryAllocation(1,1),true);
 assert.equal(isPenguFixedEntryAllocation(.8,1),false);
 assert.equal(isPenguFixedEntryAllocation(1,.85),false);
});
import { evaluateRecoveryV8PositionBar } from '../lib/pengu-recovery-v8';
import { FilePenguDualLsV2RunnerStateStore, createPenguDualLsV2RunnerState } from '../lib/pengu-dual-ls-v2-runner-state';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const recovery={version:'RECOVERY_V8' as const,side:1 as const,entryTs:H,entryPrice:100,quantity:100,originalQuantity:100,originalGross:1,remainingGross:1,partialDefenseTriggered:false,highWaterMark:100,protectionLifecycle:'MANUAL_REVIEW' as const};
test('Recovery V8 half-defense scales1.0 entry to0.5 and records0.5 reduction',()=>{
 const row={index:26,referenceTs:26*H,close:96,low:95.9,high:96.1,previousClose:97,troughIndex:0,troughClose:90,troughAgeHours:1,rsiDelta6:0,ema168DistancePct:0,btcReturn6hPct:0,ordinaryLongEligible:false,ordinaryShortEligible:false};
 const result=evaluateRecoveryV8PositionBar(recovery,row);
 assert.equal(result.kind,'PARTIAL_DEFENSE');assert.equal(result.updatedPosition.quantity,50);assert.equal(result.updatedPosition.remainingGross,.5);assert.equal(result.partialGross,.5);
});
test('Recovery1.0 state survives a real disk save and restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pengu-fixed1-'));const store=new FilePenguDualLsV2RunnerStateStore(join(dir,'runner.json'),'LIVE');
 const s=createPenguDualLsV2RunnerState('LIVE');s.position={side:1,entryTs:H,entryPrice:100,quantity:100,gross:1,highWaterMark:100,entryVersion:'RECOVERY_V8',recoveryV8:recovery};
 await store.save(s);const loaded=await store.load();assert.equal(loaded.position?.recoveryV8?.originalGross,1);
});
