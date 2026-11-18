import {test} from "node:test";
import {strict as assert} from "node:assert";
import {parseHistoricalPackManifest,parseHistoricalPack,attachHistoricalCandles} from "../lib/bt-verification/historical-symbol-pack";
import {createAnchoredChartReplay} from "../lib/bt-verification/anchored-replay";
const hash="1".repeat(64);
const day="2025-10-01T00:00:00Z",close="2025-10-01T01:00:00Z";
const coverage={start_utc:day,end_close_utc:close,bars:1,missing_hour_count:8759,
 gap_hour_count:0,front_missing_hours:0,end_missing_hours:8759,
 complete_h1_period:false,source_gzip_sha256:hash};
const manifest={schema:"disdex-historical-symbol-pack-manifest/v1",
 period_start_inclusive:day,period_end_exclusive:"2026-10-01T00:00:00Z",
 source_venue:"Aster Public Futures H1",production_parity_verified:false,
 actual_venue_execution_verified:false,requested_symbols:["BTCUSDT"],
 found_symbols:["BTCUSDT"],source_coverage:{BTCUSDT:coverage},
 packs:[{file:"aster-h1-source-pack-01.json",sha256:hash,bytes:1000,symbols:["BTCUSDT"]}]};
const pack={schema:"disdex-historical-symbol-candle-pack/v1",
 period_start_inclusive:day,period_end_exclusive:"2026-10-01T00:00:00Z",
 venue:"Aster Public Futures H1",mode:"READ_ONLY_RESEARCH_DATA_NOT_TRADE_CERTIFIED",
 symbolCandles:{BTCUSDT:[{time:day,closedAt:close,open:100,high:120,low:95,close:110}]},
 coverage:{BTCUSDT:coverage}};
test("unverified source H1 pack requires SHA-documented exact symbol coverage",()=>{
 const m=parseHistoricalPackManifest(manifest);
 const bars=parseHistoricalPack(pack,m,["BTCUSDT"]);
 assert.equal(bars.BTCUSDT[0].close,110);
});
test("market gaps are never silently classified as full coverage",()=>{
 const m=parseHistoricalPackManifest(manifest);
 assert.equal(m.source_coverage.BTCUSDT.complete_h1_period,false);
 assert.equal(m.source_coverage.BTCUSDT.missing_hour_count,8759);
});
test("bad candle, fake approval, and mismatched source sha fail closed",()=>{
 assert.throws(()=>parseHistoricalPackManifest({...manifest,production_parity_verified:true}),/INVALID/);
 assert.throws(()=>parseHistoricalPack({...pack,symbolCandles:{BTCUSDT:[{...pack.symbolCandles.BTCUSDT[0],high:101}]}},
   parseHistoricalPackManifest(manifest),["BTCUSDT"]),/CANDLE/);
 const synthetic=createAnchoredChartReplay({startDate:"2026-01-01",endDate:"2026-01-02",
  seed:1,initialJpy:10000,symbols:[{symbol:"BTCUSDT",anchorClose:100000}],
  anchorUtcDate:"2026-11-17",costBps:10,interest:"COMPOUND"});
 assert.throws(()=>attachHistoricalCandles(synthetic,parseHistoricalPackManifest(manifest),pack.symbolCandles),/REPLAY_MARKET/);
});