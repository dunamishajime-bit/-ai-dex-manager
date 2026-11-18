import {test} from "node:test";
import {strict as assert} from "node:assert";
import {parseVerifiedAsterDailyClose,priorJstCalendarDay} from "../lib/bt-verification/anchor-source";
const now=new Date("2026-11-18T12:00:00.000Z");
const day="2026-11-17";
const start=Date.parse(day+"T00:00:00Z");
const row=[start,"101","111","99","103","9",start+86400000-1];
test("previous JST calendar day and genuine closed UTC candle",()=>{
  assert.equal(priorJstCalendarDay(now),day);
  assert.deepEqual(parseVerifiedAsterDailyClose("BTCUSDT",day,[row],now),
    {symbol:"BTCUSDT",utcDate:day,close:103,barCloseMs:start+86400000-1});
});
test("open daily UTC candle, stale bar or conflicting bar is rejected",()=>{
  assert.throws(()=>parseVerifiedAsterDailyClose("BTCUSDT",day,[row],new Date("2026-11-17T16:00:00Z")),/INVALID_ANCHOR_DAY|ANCHOR_DAY_NOT_CLOSED/);
  assert.throws(()=>parseVerifiedAsterDailyClose("BTCUSDT",day,[],now),/MISSING/);
  assert.throws(()=>parseVerifiedAsterDailyClose("BTCUSDT",day,[row,row],now),/DUPLICATE/);
});
test("invalid symbols and invalid closes are rejected",()=>{
  assert.throws(()=>parseVerifiedAsterDailyClose("https://evil.test",day,[row],now),/INVALID_SYMBOL/);
  assert.throws(()=>parseVerifiedAsterDailyClose("BTCUSDT",day,[[...row.slice(0,4),"0",...row.slice(5)]],now),/INVALID_ANCHOR_CLOSE/);
});