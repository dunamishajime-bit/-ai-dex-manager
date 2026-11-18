import {test} from "node:test";
import {strict as assert} from "node:assert";
import {compareReplayPair} from "../lib/bt-verification/compare-replays";
import {createAnchoredChartReplay} from "../lib/bt-verification/anchored-replay";
import type {Replay} from "../lib/bt-verification/replay";
const synthetic=createAnchoredChartReplay({
 startDate:"2026-01-01",endDate:"2026-01-03",seed:123,initialJpy:10000,
 symbols:[{symbol:"BTCUSDT",anchorClose:100000}],anchorUtcDate:"2026-11-17",
 costBps:30,interest:"COMPOUND"
});
const historical=(strategy:"IDLE"|"FET",cost:10|30):Replay=>({
 schema:"disdex-bt-portfolio-v1",mode:"EXTERNAL",seed:0,engineSha:"REUSABLE_STANDALONE_MODEL_UNCERTIFIED",
 frames:[{timestamp:"2025-10-01T00:00:00Z",btc:null,equity:10000,realized:0,positions:[],events:[]},
 {timestamp:"2026-09-30T23:59:59Z",btc:null,equity:10000+cost*10,realized:cost*10,positions:[],events:[]}],
 limits:{total:3.5,crypto:3,stock:1.5},
 source:{kind:"HISTORICAL_STANDALONE_MODEL_NOT_INTEGRATED",
   btcCandlesSha256:"btc-hash",fillsSha256:"fills-hash",equitySha256:"equity-hash",
   note:"2025-10-01..2026-10-01 UTC | "+strategy+" | "+cost+"bps | model only"}
});
test("same-market standalone research cost scenarios are comparable",()=>{
 const c=compareReplayPair(historical("IDLE",10),historical("IDLE",30));
 assert.equal(c.comparable,true);assert.equal(c.stats?.pnlDifference,200);
});
test("different research strategy is not comparable as identical market and engine",()=>{
 assert.equal(compareReplayPair(historical("IDLE",10),historical("FET",30)).comparable,false);
});
test("anchored data without actual fills never claims performance comparison",()=>{
 assert.equal(compareReplayPair(synthetic,synthetic).comparable,false);
});