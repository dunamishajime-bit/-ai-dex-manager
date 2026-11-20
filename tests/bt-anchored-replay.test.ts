import {test} from "node:test";
import {strict as assert} from "node:assert";
import {createAnchoredChartReplay} from "../lib/bt-verification/anchored-replay";
import {validateReplay} from "../lib/bt-verification/replay";
const config={startDate:"2026-01-01",endDate:"2026-01-08",seed:1234,initialJpy:10000,
 symbols:[{symbol:"BTCUSDT",anchorClose:100000},{symbol:"FETUSDT",anchorClose:1.2}],
 anchorUtcDate:"2026-11-17",costBps:30 as const,interest:"COMPOUND" as const};
test("anchored chart-only replay validates and never contains imaginary trades",()=>{
 const replay=createAnchoredChartReplay(config);
 assert.ok(validateReplay(replay));
 assert.equal(replay.btcCandles?.at(-1)?.close,100000);
 assert.equal(replay.symbolCandles?.FETUSDT.at(-1)?.close,1.2);
 assert.equal(replay.frames.at(-1)?.equity,10000);
 assert.equal(replay.frames.at(-1)?.positions.length,0);
 assert.equal(replay.source?.kind,"SYNTHETIC_ANCHORED_DAILY_NO_STRATEGY");
});
test("scheduled deposits are cash flows, not strategy profits",()=>{
 const replay=createAnchoredChartReplay({...config,contribution:{amountJpy:1500,frequency:"MONTHLY",day:1}});
 assert.equal(replay.frames.at(-1)?.equity,11500);
 assert.equal(replay.frames.at(-1)?.realized,0);
 assert.ok(replay.frames.some(f=>f.events.some(e=>e.startsWith("EXTERNAL DEPOSIT "))));
});
test("malformed configurations fail closed",()=>{
 assert.throws(()=>createAnchoredChartReplay({...config,initialJpy:0}),/INVALID_INITIAL/);
 assert.throws(()=>createAnchoredChartReplay({...config,symbols:[{symbol:"FETUSDT",anchorClose:1}]}),/BTC_OVERVIEW_REQUIRED/);
});