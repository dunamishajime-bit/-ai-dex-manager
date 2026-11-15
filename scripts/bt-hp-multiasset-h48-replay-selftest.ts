import assert from "node:assert/strict";
import {createMultiassetH48Replay} from "../lib/bt-verification/multiasset-h48-replay";
import {validateReplay,grossForFrame} from "../lib/bt-verification/replay";
import {H48_RESEARCH_LOGIC} from "../lib/bt-verification/h48-research-sandbox";
const started=Date.now();
for(const scenario of ["trend","range","down","volatile"] as const){
 const r=createMultiassetH48Replay(11,scenario,10);
 assert.equal(validateReplay(r),true,"Strict DIL replay input must pass");
 assert.equal(r.mode,"DEMO");
 assert.equal(r.source?.kind,"SYNTHETIC_MULTI_ASSET_H48_CANDIDATE");
 assert.ok(r.source.note?.includes("NOT a STABLE4 integrated backtest"));
 assert.equal(r.frames.length,2880);
 assert.equal(r.btcCandles?.length,336);
 assert.equal(r.frames[0].timestamp,"2025-10-01T00:05:00Z");
 assert.equal(r.frames.at(-1)?.timestamp,"2025-10-11T00:00:00Z");
 const b=createMultiassetH48Replay(11,scenario,10);
 assert.deepEqual(r,b,"Same scenario/seed must be repeatable");
 let movements=0,closedMarks=0;
 for(let i=0;i<r.frames.length;i++){
  const f=r.frames[i],h=f.h48Research!;
  assert.ok(h.ready&&h.hypePrice>0);
  assert.ok(f.syntheticFxJpy!==undefined&&f.syntheticFxJpy>0);
  const unreal=f.positions.reduce((sum,p)=>sum+(p.quantity??0)*((p.mark??p.entry)-p.entry)*f.syntheticFxJpy!,0);
  assert.ok(Math.abs(f.equity-(10000+f.realized+unreal))<.2,
    "Every tick must reconcile opening JPY + fees/funding/realized + marked FX profit");
  const expectedGross=f.positions.reduce((sum,p)=>sum+(p.quantity??0)*(p.mark??p.entry)*f.syntheticFxJpy!/f.equity,0);
  assert.ok(Math.abs(expectedGross-grossForFrame(f).total)<.00002,
    "Every tick must reconcile gross from quantity, mark, as-of model FX and equity");
  assert.equal(grossForFrame(f).inconsistent,false);
  assert.ok(f.equity>0);
  const asofEarnings=f.positions.reduce((sum,p)=>sum+(p.quantity??0)*((p.mark??p.entry)-p.entry)*1,0);
  assert.ok(Number.isFinite(asofEarnings));
  if(i&&r.frames[i-1].btc!==f.btc)movements++;
  if(f.formingBtcCandle){
   assert.ok(f.formingBtcCandle.time<f.timestamp&&f.timestamp<f.formingBtcCandle.closedAt);
   assert.equal(f.formingBtcCandle.close,f.btc);
  }else closedMarks++;
  for(const p of f.positions){
   assert.equal(p.logic,H48_RESEARCH_LOGIC);
   assert.equal(p.symbol,"HYPEUSDT");
   assert.equal(p.side,"LONG");
   assert.ok(p.gross!==null&&p.gross>0);
  }
  for(const e of f.events){
   if(e.startsWith("ENTRY ")){
    const at=e.match(/modelEntryAt=([0-9TZ:-]+)/)?.[1];
    assert.ok(at,"Model entry time must be explicit");
    assert.equal(Date.parse(f.timestamp)-Date.parse(at!),300000,"No first-tick lookahead");
    assert.equal(new Date(at!).getUTCHours()%6,0,"Research UTC 6H grid");
   }
   if(e.startsWith("RISK ")&&e.includes(" PASS ")){
    assert.equal(new Date(f.timestamp).getUTCHours()%6,0);
    assert.equal(f.timestamp.slice(14,16),"00");
   }
   if(e.startsWith("EXIT ")){
    assert.ok(e.includes("H48_TIME48_NEXTOPEN")||e.includes("H48_RESEARCH_STOP_6PCT_5MIN_OBSERVED"));
   }
   assert.ok(!e.startsWith("ENTRY V4"),"No invented formal runner");
  }
 }
 assert.ok(movements>2400&&closedMarks===240);
}
const p=createMultiassetH48Replay(11,"trend",30);
assert.equal(validateReplay(p),true);
assert.equal(p.frames.length,2880);
const fake=structuredClone(p);
fake.frames[0].h48Research!.hypePrice=-100;
assert.equal(validateReplay(fake),false,"Tampered HYPE quote must fail");
const missingFx=structuredClone(p);
delete missingFx.frames[3].syntheticFxJpy;
assert.equal(validateReplay(missingFx),false,"Source modeled FX is mandatory");
const alteredFx=structuredClone(p);
alteredFx.frames[3].syntheticFxJpy=-1;
assert.equal(validateReplay(alteredFx),false,"Invalid FX rejected");
const invalid=structuredClone(p);
invalid.mode="EXTERNAL";
assert.equal(validateReplay(invalid),false,"Research source does not transform to live evidence");
const sample=createMultiassetH48Replay(1,"trend",10);
const sampleEntries=sample.frames.filter(f=>f.events.some(x=>x.startsWith("ENTRY "+H48_RESEARCH_LOGIC)));
assert.ok(sampleEntries.length>0,"Seed1 trend gives real threshold candidate, no forced proxy fills");
assert.equal(sampleEntries[0].timestamp,"2025-10-06T06:05:00Z");
const sampleExits=sample.frames.filter(f=>f.events.some(x=>x.startsWith("EXIT "+H48_RESEARCH_LOGIC)));
assert.ok(sampleExits.length>0,"10d scenario must validate at least one real price-/time-dependent exit");
console.log("SAMPLED H48 ENTRY/EXIT",sampleEntries.length,sampleExits.length);
console.log("PASS 23-symbol input -> frozen H48 candidate, 6H grid, next-open, 6% M5 STOP, model FX/Funding, 4 regimes, "+(Date.now()-started)+"ms");
