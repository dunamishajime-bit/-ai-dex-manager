import assert from "node:assert/strict";
import {createPreviewReplay,DEMO_HOURS,DEMO_WARMUP_HOURS,DEMO_TICKS_PER_HOUR,DEMO_RULES,DEMO_BASE_JPY} from "../lib/bt-verification/demo";
import {grossForFrame,validateReplay} from "../lib/bt-verification/replay";

for(const scenario of ["trend","range","down","volatile"] as const){
 const data=createPreviewReplay(123456,scenario);
 assert.equal(validateReplay(data),true,"Causal demo must satisfy strict replay schema");
 assert.equal(data.mode,"DEMO");
 assert.equal(data.engineSha,"VISUAL_DEMO_SYNTHETIC_NOT_A_BACKTEST");
 assert.equal(data.frames.length,DEMO_HOURS*DEMO_TICKS_PER_HOUR);
 assert.equal(data.btcCandles?.length,DEMO_HOURS+DEMO_WARMUP_HOURS);
 assert.equal(data.btcCandles?.[DEMO_WARMUP_HOURS-1].closedAt,data.frames[0].timestamp.slice(0,13)+":00:00Z",
   "Warmup ends at hour 00:00 before replay starts");
 assert.ok(data.btcCandles!.slice(0,DEMO_WARMUP_HOURS).every(c=>c.closedAt<=data.frames[0].timestamp),
   "All warmup candles must be completed as-of the first tick");
 assert.ok(data.frames[0].btc!==null,"First observed tick is a real changing price");
 const entries=data.frames.flatMap(f=>f.events.filter(e=>e.startsWith("ENTRY ")));
 const exits=data.frames.flatMap(f=>f.events.filter(e=>e.startsWith("EXIT ")));
 const partials=data.frames.flatMap(f=>f.events.filter(e=>e.startsWith("PARTIAL ")));
 assert.ok(entries.length>0,"At least one price-triggered entry must fire");
 assert.ok(exits.length>0,"At least one price-dependent or timed exit must happen");
 let evolvingBars=0, crossChecks=0, firedTicks=0, priceMoves=0;
 for(let i=0;i<data.frames.length;i++){
  const frame=data.frames[i],prior=data.frames[i-1];
  if(prior && frame.btc!==prior.btc)priceMoves++;
  const gross=grossForFrame(frame);
  assert.equal(gross.inconsistent,false);
  assert.ok(gross.total<=data.limits.total);
  assert.ok(frame.equity>0);
  const pnlFromMarks=frame.positions.reduce((v,p)=>v+(p.quantity??0)*((p.mark??p.entry)-p.entry)*
    (p.side==="LONG"?1:-1)*145,0);
  assert.ok(Math.abs(frame.equity-(DEMO_BASE_JPY+frame.realized+pnlFromMarks))<.08,
    "Every demo tick must reconcile marked JPY equity to realized plus current positions");
  const completed=data.btcCandles!.filter(c=>c.closedAt<=frame.timestamp);
  if(frame.formingBtcCandle){
    const c=frame.formingBtcCandle;
    assert.ok(c.time<frame.timestamp&&frame.timestamp<c.closedAt);
    assert.ok(c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
    assert.equal(c.close,frame.btc);
    assert.equal(completed.length,DEMO_WARMUP_HOURS+Math.floor(i/DEMO_TICKS_PER_HOUR));
    if(i%DEMO_TICKS_PER_HOUR>=4&&c.high>c.low)evolvingBars++;
    const earlier=data.frames.slice(i-(i%DEMO_TICKS_PER_HOUR),i);
    assert.ok(earlier.every(f=>f.btc!==null && f.btc<=c.high && f.btc>=c.low));
  }else{
    assert.equal(frame.timestamp,completed.at(-1)?.closedAt);
  }
  for(const s of frame.demoSignals??[]){
    crossChecks++;
    assert.equal(s.price,frame.btc);
    if(s.fired){
      firedTicks++;
      assert.ok(s.crossed);
      assert.ok(frame.events.some(e=>e.startsWith("ENTRY "+s.logic+" BTC")));
      assert.ok(s.threshold!==null);
      // Crossing compares ONLY the immediately preceding observed price and prior completed bars.
      const rule=DEMO_RULES.find(r=>r.logic===s.logic)!;
      const before=data.btcCandles!.filter(c=>c.closedAt<=prior!.timestamp);
      const last=before.slice(-rule.lookback);
      const threshold=rule.logic==="DEMO_Q102"?
        Number((last.reduce((n,c)=>n+c.close,0)/last.length*(1+rule.buffer)).toFixed(2)):
        Number((rule.direction==="ABOVE"?Math.max(...last.map(c=>c.high))*(1+rule.buffer):
          Math.min(...last.map(c=>c.low))*(1-rule.buffer)).toFixed(2));
      // A crossing tick at the 1h boundary never uses the bar that closes on that tick.
      const lastStrict=data.btcCandles!.filter(c=>c.closedAt<frame.timestamp).slice(-rule.lookback);
      const expected=rule.logic==="DEMO_Q102"?
        Number((lastStrict.reduce((n,c)=>n+c.close,0)/lastStrict.length*(1+rule.buffer)).toFixed(2)):
        Number((rule.direction==="ABOVE"?Math.max(...lastStrict.map(c=>c.high))*(1+rule.buffer):
          Math.min(...lastStrict.map(c=>c.low))*(1-rule.buffer)).toFixed(2));
      assert.equal(s.threshold,expected);
      const prev=prior!.btc!;
      assert.ok(s.direction==="ABOVE"?(prev<=expected&&frame.btc!>expected):(prev>=expected&&frame.btc!<expected));
    }
  }
  if(i>0 && frame.events.some(e=>e.startsWith("ENTRY ")) && !frame.demoSignals?.some(x=>x.fired)){
    assert.fail("No fixed-time or fabricated entry is allowed");
  }
 }
 assert.ok(evolvingBars>DEMO_HOURS*6,"Candles must visibly evolve within the hour");
 assert.ok(priceMoves>DEMO_HOURS*DEMO_TICKS_PER_HOUR*.95,"Ticks must update price");
 assert.ok(crossChecks===data.frames.length*DEMO_RULES.length);
 assert.ok(firedTicks===entries.length);
 assert.deepEqual(createPreviewReplay(123456,scenario),data,"Seed and scenario must be deterministic");
 console.log(JSON.stringify({scenario,entries:entries.length,exits:exits.length,partials:partials.length,
   candleSteps:data.frames.length,evolvingBars,priceMoves,
   finalEquityJPY:data.frames.at(-1)?.equity,notCanonical:true}));
}
assert.notEqual(createPreviewReplay(123456,"trend").frames.at(-1)?.equity,
 createPreviewReplay(123456,"down").frames.at(-1)?.equity,"Scenario must affect market-driven balance");
assert.notDeepEqual(createPreviewReplay(123456,"trend").frames.map(f=>f.events),
 createPreviewReplay(98765,"trend").frames.map(f=>f.events),"Different seed must alter price-triggered trades");
console.log(JSON.stringify({status:"PASS",scenarios:4,causalTickSimulation:true}));
