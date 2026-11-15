import assert from "node:assert/strict";
import {SyntheticMarket5m,SYNTHETIC_FEED_SYMBOLS,SYNTHETIC_FEED_SYMBOLS_V2}
 from "../lib/bt-verification/synthetic-market";
import {probeSyntheticIdleAt}
 from "../lib/bt-verification/pinned-native-idle/probe";

assert.equal(SYNTHETIC_FEED_SYMBOLS.length,23);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V2.length,24);
assert.equal(SYNTHETIC_FEED_SYMBOLS_V2.at(-1),"TIAUSDT",
 "Versioned addition must be appended, never rewrite the original symbol order");
const window={start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-10T00:00:00Z"};
const v1=new SyntheticMarket5m(4,"down",window);
const explicitV1=new SyntheticMarket5m(4,"down",{...window,version:"v1"});
const v2=new SyntheticMarket5m(4,"down",{...window,version:"v2"});
const v2Same=new SyntheticMarket5m(4,"down",{...window,version:"v2"});
assert.equal(v1.description.schema,"disdex-bt-synthetic-feed-v1");
assert.equal(v2.description.schema,"disdex-bt-synthetic-feed-v2");
assert.equal(v1.description.symbols.length,23);
assert.equal(v2.description.symbols.length,24);
assert.equal(v2.description.researchParity,false);
assert.equal(v2.description.venueExecution,false);
assert.throws(()=>v1.historyH1("TIAUSDT",10),/INVALID/);
let ticks=0, tiaBars=0,tiaPastWarmup=0,tiaInsufficient=0,tiaNativeRejected=0,tiaAccepted=0;
let tiaInvalid=0,lastCloseTime=0;
for(;;){
 const a=v1.step(),b=explicitV1.step(),c=v2.step(),d=v2Same.step();
 if(!a||!b||!c||!d){assert.equal(a,null);assert.equal(b,null);assert.equal(c,null);assert.equal(d,null);break}
 assert.deepEqual(a,b,"Explicit v1 never changes original v1 seeded stream");
 assert.deepEqual(c,d,"Version v2 is reproducible by seed/scenario");
 assert.equal(a.quotes.length,23);assert.equal(c.quotes.length,24);
 assert.equal(a.quotes.find(q=>q.symbol==="TIAUSDT"),undefined);
 const tia=c.quotes.find(q=>q.symbol==="TIAUSDT");
 assert.ok(tia&&tia.category==="crypto"&&tia.tradable&&tia.price>0);
 assert.ok(!c.quotes.some(q=>!Number.isFinite(q.price)||q.price<=0));
 assert.ok(c.completedM5.some(x=>x.symbol==="TIAUSDT"));
 assert.equal(c.completedM5.length,a.completedM5.length+1);
 for(const x of c.completedH1.filter(x=>x.symbol==="TIAUSDT")){
  tiaBars++;
  assert.equal(x.ticks,12);
  assert.equal(Date.parse(x.closedAt),Date.parse(c.observedAt));
  assert.ok(Date.parse(x.closedAt)>lastCloseTime);
  lastCloseTime=Date.parse(x.closedAt);
  const probe=probeSyntheticIdleAt(v2,c.observedAt).find(x=>x.symbol==="TIAUSDT")!;
  assert.equal(probe.noOrdersEver,true);
  assert.equal(probe.nativeEntryCandidate,probe.nativeSignal?.accepted??false);
  assert.notEqual(probe.status,"MISSING_SYMBOL");
  if(probe.status==="HISTORY_INSUFFICIENT")tiaInsufficient++;
  else if(probe.status==="NATIVE_REJECTED")tiaNativeRejected++;
  else if(probe.status==="RESEARCH_PRELIMINARY_PASSED")tiaAccepted++;
  else tiaInvalid++;
  if(tiaBars>73)tiaPastWarmup++;
 }
 ticks++;
}
assert.equal(ticks,216*12);
assert.equal(tiaBars,216);
assert.equal(tiaInsufficient,72);
assert.ok(tiaPastWarmup>120);
assert.ok(tiaNativeRejected+tiaAccepted>120);
assert.equal(tiaInvalid,0);
assert.equal(v2.historyH1("TIAUSDT",73).length,73);
const oldV1=new SyntheticMarket5m(4,"down",window);
for(let i=0;i<72*12;i++)oldV1.step();
const v1Probe=probeSyntheticIdleAt(oldV1,oldV1.now).find(p=>p.symbol==="TIAUSDT");
assert.equal(v1Probe?.status,"MISSING_SYMBOL",
 "Explicit v1 TIA blockage must stay unchanged");
assert.throws(()=>new SyntheticMarket5m(4,"trend",{...window,version:"v4" as never}),/SYNTHETIC_VERSION_INVALID/);
console.log("PASS opt-in v2 24-symbol feed with native TIA Shadow, unchanged v1 seeds",JSON.stringify({
 ticks,tiaBars,tiaInsufficient,tiaNativeRejected,tiaAccepted,tiaInvalid,execution:false
}));
