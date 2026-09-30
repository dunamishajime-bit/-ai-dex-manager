import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveTradeHistoryAttribution, getTradeHistoryAttributionTone } from "@/lib/trade-history-attribution";

const read=(file:string)=>readFileSync(file,"utf8");

test("Idle Priority official fills keep explicit strategy and route attribution",()=>{
  const entry=deriveTradeHistoryAttribution({
    source:"official-fill",
    strategyId:"IDLE_PRIORITY_SHORT",
    reason:"IDLE_PRIORITY_SHORT_ENTRY:IDLE_DOT_MOMENTUM_SHORT_BTCREL",
  });
  assert.equal(entry.evidence,"explicit");
  assert.equal(entry.logicLabel,"Idle Priority SHORT");
  assert.equal(entry.routeLabel,"IDLE_DOT_MOMENTUM_SHORT_BTCREL");
  assert.equal(getTradeHistoryAttributionTone(entry),"idle-priority");
});

test("Idle Priority HP endpoint is authenticated and strictly read-only",()=>{
  const api=read("app/api/system/idle-priority-status/route.ts");
  const obs=read("lib/server/idle-priority-runtime-observability.ts");
  assert.match(api,/disdex_auth/);
  assert.match(api,/tradingMutation:\s*0/);
  assert.match(obs,/runner-health\/heartbeats\/idle-priority-short\.json/);
  assert.match(obs,/disdex-idle-priority-state\/v2/);
  assert.match(obs,/mainPid/);
  assert.match(obs,/nRestarts/);
  assert.match(obs,/serviceResult/);
  assert.doesNotMatch(api+obs,/executeMarket\(|placeStopMarket\(|placeTakeProfitMarket\(|cancelOrder\(|closePosition\(/);
});

test("Idle Priority page and overview navigation are present",()=>{
  assert.match(read("app/decision-status/idle-priority/page.tsx"),/IdlePriorityDecisionPanel/);
  assert.match(read("components/features/DecisionStatusPanel.tsx"),/\/decision-status\/idle-priority/);
  assert.match(read("app/decision-status/page.tsx"),/Idle Priority/);
});

test("Idle Priority history has a dedicated strategy and visual tone",()=>{
  const page=read("app/history/page.tsx");
  assert.match(page,/IDLE_PRIORITY_SHORT/);
  assert.match(page,/case "idle-priority"/);
  assert.match(page,/Idle Priority SHORT/);
});
