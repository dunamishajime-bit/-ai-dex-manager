import test from "node:test";
import assert from "node:assert/strict";
import {HOUR_MS, REQUIRED_HOURS, indexQ102History,q102HistoryAt} from "../../research/formal_five_bt/q102_window.mjs";
const T=1_750_000_000_000-Math.floor(1_750_000_000_000%HOUR_MS);
function rows(n=REQUIRED_HOURS+3,start=T){
  return Array.from({length:n},(_,i)=>({timestampMs:start+i*HOUR_MS,open:100,
    high:101,low:99,close:100.5,quoteVolume:500,baseVolume:5}));
}
const t=T+REQUIRED_HOURS*HOUR_MS;
test("181 full days and same-hour entry OPEN required",()=>{
  const idx=indexQ102History({BTCUSDT:rows(),SOLUSDT:rows()});
  const early=q102HistoryAt(idx,t-HOUR_MS);
  assert.equal(early.ready,false);
  assert.equal(early.exclusions.SOLUSDT,"181D_CONTIGUOUS_HISTORY_NOT_READY");
  const at=q102HistoryAt(idx,t);
  assert.equal(at.ready,true);
  assert.equal(at.history.candlesBySymbol.SOLUSDT.length,REQUIRED_HOURS);
  assert.equal(at.history.candlesBySymbol.SOLUSDT.at(-1).timestampMs,t-HOUR_MS);
  assert.deepEqual(at.history.entryOpenBySymbol.SOLUSDT,{timestampMs:t,open:100});
  assert.equal(Object.keys(at.history.entryOpenBySymbol).length,2);
});
test("newly listed symbols are excluded ONLY until their own causal 181-day history exists",()=>{
  const newRows=rows(REQUIRED_HOURS+1,T+60*24*HOUR_MS);
  const idx=indexQ102History({BTCUSDT:rows(REQUIRED_HOURS+70*24),SOLUSDT:rows(REQUIRED_HOURS+70*24),NEWUSDT:newRows});
  const early=q102HistoryAt(idx,t+2*HOUR_MS);
  assert.equal(early.ready,true);
  assert.ok(early.eligibleSymbols.includes("SOLUSDT"));
  assert.ok(!early.eligibleSymbols.includes("NEWUSDT"));
  const late=q102HistoryAt(idx,T+60*24*HOUR_MS+REQUIRED_HOURS*HOUR_MS);
  assert.ok(late.eligibleSymbols.includes("NEWUSDT"));
});
test("invalid completed bar or gap cannot be silently bridged",()=>{
  const malformed=rows(REQUIRED_HOURS+6);
  malformed[2].high=malformed[2].low-1;
  const gaps=rows(REQUIRED_HOURS+6);
  gaps[3].timestampMs+=HOUR_MS;
  const index=indexQ102History({BTCUSDT:rows(REQUIRED_HOURS+6),BADUSDT:malformed,GAPUSDT:gaps});
  const at=q102HistoryAt(index,t);
  assert.ok(!at.eligibleSymbols.includes("BADUSDT"));
  assert.ok(!at.eligibleSymbols.includes("GAPUSDT"));
  assert.equal(at.exclusions.BADUSDT,"181D_CONTIGUOUS_HISTORY_NOT_READY");
  assert.equal(at.exclusions.GAPUSDT,"181D_CONTIGUOUS_HISTORY_NOT_READY");
});
test("current unfinished bar high/low/close never contribute to completed-bar history",()=>{
  const good=rows();
  const current=good[REQUIRED_HOURS];
  current.high=999999;current.low=0;current.close=999999;
  const idx=indexQ102History({BTCUSDT:rows(),SOLUSDT:good});
  const at=q102HistoryAt(idx,t);
  assert.equal(at.ready,true);
  assert.equal(at.history.entryOpenBySymbol.SOLUSDT.open,100);
  assert.equal(at.history.candlesBySymbol.SOLUSDT.at(-1).timestampMs,t-HOUR_MS);
  assert.equal(at.history.candlesBySymbol.SOLUSDT.find(x=>x.high===999999),undefined);
});
test("strict BTC prerequisite is independent of partial-altcoin listing",()=>{
  const btc=rows(REQUIRED_HOURS+2);
  btc[REQUIRED_HOURS-1].open=0;
  const idx=indexQ102History({BTCUSDT:btc,SOLUSDT:rows()});
  const out=q102HistoryAt(idx,t);
  assert.equal(out.ready,false);
  assert.equal(out.exclusions.BTCUSDT,"INVALID_LATEST_1H");
});
