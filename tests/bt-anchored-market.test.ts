import {test} from "node:test";
import {strict as assert} from "node:assert";
import {createAnchoredMarket,observedCandlesAt} from "../lib/bt-verification/anchored-market";
const config={startDate:"2026-01-01",endDate:"2026-08-31",seed:4242,symbols:[{symbol:"BTCUSDT",anchorClose:100000},{symbol:"FETUSDT",anchorClose:1.2}]};
test("end-day closes equal supplied external anchors",()=>{
  const m=createAnchoredMarket(config);
  assert.equal(m.BTCUSDT.at(-1)?.close,100000);
  assert.equal(m.FETUSDT.at(-1)?.close,1.2);
  assert.equal(m.BTCUSDT[0].time,"2026-01-01");
  assert.equal(m.BTCUSDT.at(-1)?.time,"2026-08-31");
});
test("same seed is reproducible, other seeds vary",()=>{
  assert.deepEqual(createAnchoredMarket(config),createAnchoredMarket(config));
  assert.notDeepEqual(createAnchoredMarket(config),createAnchoredMarket({...config,seed:4243}));
});
test("OHLC is well formed, prior close links next open",()=>{
  for(const bars of Object.values(createAnchoredMarket(config))){
    bars.forEach((bar,i)=>{
      assert.ok(bar.low>0&&bar.high>=Math.max(bar.open,bar.close));
      assert.ok(bar.low<=Math.min(bar.open,bar.close));
      if(i>0)assert.equal(bar.open,bars[i-1].close);
    });
  }
});
test("replay prefix excludes future bars and terminal anchor",()=>{
  const bars=createAnchoredMarket(config).BTCUSDT;
  const prefix=observedCandlesAt(bars,"2026-01-15");
  assert.equal(prefix.at(-1)?.time,"2026-01-15");
  assert.ok(prefix.length<bars.length);
});
test("invalid anchors and dates fail closed",()=>{
  assert.throws(()=>createAnchoredMarket({...config,symbols:[{symbol:"BTCUSDT",anchorClose:0}]}),/INVALID_ANCHOR/);
  assert.throws(()=>createAnchoredMarket({...config,startDate:"2026-09-01"}),/REVERSED_PERIOD/);
  assert.throws(()=>createAnchoredMarket({...config,endDate:"2026-02-30"}),/INVALID_DATE/);
});