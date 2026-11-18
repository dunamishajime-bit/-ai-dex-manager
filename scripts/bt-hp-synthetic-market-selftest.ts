import assert from "node:assert/strict";
import {SyntheticMarket5m,SYNTHETIC_FEED_SYMBOLS,SYNTHETIC_DATA_REQUIREMENTS} from "../lib/bt-verification/synthetic-market";
import type {SyntheticStep,MarketCandle5m} from "../lib/bt-verification/synthetic-market";
const start="2025-10-01T00:00:00Z",end="2025-10-04T00:00:00Z";
const options={start,endExclusive:end};
const a=new SyntheticMarket5m(123,"trend",options),b=new SyntheticMarket5m(123,"trend",options);
assert.equal(SYNTHETIC_FEED_SYMBOLS.length,23);
assert.equal(a.totalTicks,3*24*12);
assert.equal(a.description.researchParity,false);
assert.equal(a.description.venueExecution,false);
assert.equal(SYNTHETIC_DATA_REQUIREMENTS.nativeEnginesConnected.length,0);
let btcBars=0,fundingCount=0,stockClosed=0,changed=0;
let lastCrypto=0;
for(let k=0;k<a.totalTicks;k++){
 const x=a.step()!,y=b.step()!;
 assert.deepEqual(x,y,"Full immutable stream must be seed-deterministic");
 assert.equal(x.tick,k+1);
 assert.ok(x.observedAt<=end);
 assert.equal(x.quotes.length,23);
 assert.equal(x.completedM5.filter(c=>c.category==="crypto").length,15);
 assert.ok(x.usdJpy>0);
 for(const q of x.quotes){
  assert.ok(q.price>0&&q.bid>0&&q.ask>=q.bid);
  assert.ok(q.volume5m>=0);
  if(q.category==="stock"&&!q.tradable){
   assert.equal(q.volume5m,0,"No fabricated stock volume outside RTH");
   stockClosed++;
  }
 }
 const btc=x.quotes.find(q=>q.symbol==="BTCUSDT")!;
 if(k&&btc.price!==lastCrypto)changed++;
 lastCrypto=btc.price;
 for(const c of [...x.completedM5,...x.completedH1]){
  assert.ok(c.open>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
  assert.ok(c.closedAt<=x.observedAt,"No future candle in current tick");
  assert.ok(c.volume>=0&&c.ticks>=1&&c.ticks<=12);
  if(c.category==="crypto"&&c.ticks===12)assert.equal(c.partialSession,false);
 }
 btcBars+=x.completedH1.filter(z=>z.symbol==="BTCUSDT").length;
 for(const f of x.funding){
  fundingCount++;assert.ok(f.symbol.endsWith("USDT")&&f.timestamp===x.observedAt);
  assert.equal(Date.parse(f.timestamp)%(8*3600000),0);
  assert.ok(Math.abs(f.rate)<=.00050001);
 }
}
assert.equal(a.step(),null);
assert.equal(btcBars,72);
assert.ok(fundingCount>0&&stockClosed>0&&changed>800);
const old=a.historyH1("BTCUSDT",5);
assert.equal(old.length,5);
old[0].close=1;
assert.notEqual(a.historyH1("BTCUSDT",5)[0].close,1,"External mutation cannot change emitted history");
assert.throws(()=>a.historyH1("BTCUSDT",-1),/INVALID/);
assert.throws(()=>new SyntheticMarket5m(-1,"trend"),/INVALID/);
assert.throws(()=>new SyntheticMarket5m(2,"unknown" as any),/INVALID/);
assert.throws(()=>new SyntheticMarket5m(2,"range",{start:end,endExclusive:start}),/INVALID/);
const different=new SyntheticMarket5m(124,"trend",options).step()!;
assert.notDeepEqual(different.quotes,a.historyH1("BTCUSDT",1));
const full=new SyntheticMarket5m(20261115,"rotation");
let fullBars=0,fullFunding=0,first="",last="",stockActive=0,partialStockBars=0,cryptoVol=0;
const ticks=full.runToEnd((tick:SyntheticStep)=>{
 if(!first)first=tick.observedAt;
 last=tick.observedAt;
 fullBars+=tick.completedH1.filter(x=>x.symbol==="BTCUSDT").length;
 fullFunding+=tick.funding.length;
 stockActive+=tick.quotes.filter(x=>x.category==="stock"&&x.tradable).length;
 partialStockBars+=tick.completedH1.filter(x=>x.category==="stock"&&x.partialSession).length;
 cryptoVol+=tick.completedM5.filter(x=>x.category==="crypto").reduce((s,x)=>s+x.volume,0);
});
assert.equal(ticks,182*24*12,"Exactly half-year 2025-10-01 to 2026-04-01");
assert.equal(fullBars,182*24);
assert.equal(first,"2025-10-01T00:05:00Z");
assert.equal(last,"2026-04-01T00:00:00Z");
assert.ok(fullFunding>0&&stockActive>0&&partialStockBars>0&&cryptoVol>0);
console.log("PASS half-year deterministic causal OHLCV source:",JSON.stringify({
 ticks,cryptoAssets:15,stocks:8,closedBtcH1:fullBars,fundingEvents:fullFunding,
 stockOpen5minObservations:stockActive,partialStockH1:partialStockBars,first,last,
 adapterStatus:"BLOCKED_NATIVE_NOT_CONNECTED"}));
