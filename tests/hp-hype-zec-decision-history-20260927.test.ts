import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveTradeHistoryAttribution, getTradeHistoryAttributionTone } from "@/lib/trade-history-attribution";
import { liveTradeFromOfficialHistoryEntry } from "@/lib/server/live-performance-analytics";
import { evaluateHypeZecMarketGates, parseHypeZecPolicyFromSource } from "@/lib/server/hype-zec-runtime-observability";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

const fakePolicy=(strategy:"HYPE_LONG"|"ZEC_LONG")=>strategy+": Object.freeze({ signal: Object.freeze({\n"+
  ["btcMinMoveBps: 3","btcMinAccelBps: -1","btcMaxMoveBps: 45","symbolMinMoveBps: 8",
  "symbolMinAccelBps: -1","symbolMaxDistanceBps: 65","breakoutBps: 8",
  "breakoutConfirmMinutes: 5","holdMinutes: 25","stopLossPct: 0.0045",
  "takeProfitPct: 0.018","trailActivationPct: 0.008","trailRetracePct: 0.004"].join(",\n")+"\n}),";
test("parse policy exclusively from exact production source rather than UI invented thresholds",()=>{
  const p=parseHypeZecPolicyFromSource(fakePolicy("HYPE_LONG"),"HYPE_LONG");
  assert.equal(p?.symbolMinMoveBps,8);
  assert.equal(p?.breakoutConfirmMinutes,5);
  assert.equal(parseHypeZecPolicyFromSource("not deployed","HYPE_LONG"),null);
});
test("independent gate visibility distinguishes raw candle signal from actual venue eligibility",()=>{
  const p=parseHypeZecPolicyFromSource(fakePolicy("HYPE_LONG"),"HYPE_LONG")!;
  const T=1_800_000_000_000-Math.floor(1_800_000_000_000/(15*60_000))%(1)*(15*60_000);
  const floor=Math.floor(T/(15*60_000))*(15*60_000),now=floor+2*60_000;
  const seq=(closes:number[])=>closes.map((close,i)=>({ts:floor-(closes.length-i)*15*60_000,close,high:close*1.002}));
  const btc=seq([100,100.15,100.30,100.45]);
  const hype=seq([20,20.02,20.04,20.06]);
  const zec=seq([15,15.01,15.02,15.03]);
  const r=evaluateHypeZecMarketGates({btc,hype,zec,hypeMinute:[{ts:floor+60_000,close:20.08,high:20.10}],
    zecMinute:[{ts:floor+60_000,close:15.03,high:15.04}]},"HYPE_LONG",p,now);
  assert.equal(r.gates.length,7);
  assert.deepEqual(r.gates.map(g=>g.key),["DATA_FRESHNESS","BTC_15M_MOVE","BTC_ACCEL",
    "SYMBOL_MOMENTUM","SYMBOL_ACCEL","EMA20_DISTANCE","BREAKOUT_1M"]);
  assert.equal(typeof r.accepted,"boolean");
  assert.ok(r.gates.every(g=>g.source==="PUBLIC_CANDLES"));
});
test("HYPE/ZEC official fills require explicit lineage, not symbol-only attribution",()=>{
  const unknown=deriveTradeHistoryAttribution({source:"official-fill",strategyId:"UNKNOWN",reason:"Aster official fill / HYPEUSDT"});
  assert.notEqual(unknown.evidence,"explicit");
  for (const name of ["HYPE","ZEC"] as const){
    const explicit=deriveTradeHistoryAttribution({source:"official-fill",strategyId:name,reason:"LIVE validated"});
    assert.equal(explicit.evidence,"explicit");
    assert.equal(getTradeHistoryAttributionTone(explicit),name.toLowerCase());
    const trade=liveTradeFromOfficialHistoryEntry({
      id:name,action:"BUY",sourceSymbol:"USDT",destSymbol:name,executedAt:new Date().toISOString(),
      realizedPnlUsd:0,commission:0,strategyId:name,attribution:explicit,
    } as TradeHistoryEntry);
    assert.equal(trade.logic,name);
  }
});
test("new HYPE and ZEC routes, navigation and API stay read-only",()=>{
  const read=(file:string)=>readFileSync(file,"utf8");
  const api=read("app/api/system/hype-zec-status/route.ts");
  const obs=read("lib/server/hype-zec-runtime-observability.ts");
  assert.match(api,/disdex_auth/);
  assert.match(api,/tradingMutation:0/);
  assert.doesNotMatch(api+obs,/executeMarket\(|placeStopMarket\(|cancelOrder\(/);
  for(const name of ["hype","zec"]){
    assert.match(read("app/decision-status/"+name+"/page.tsx"),/HypeZecDecisionPanel/);
    assert.match(read("components/features/HistoryAnalyticsNav.tsx"),new RegExp("/history/"+name));
  }
});
