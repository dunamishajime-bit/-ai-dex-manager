import assert from "node:assert/strict";
import { planUnifiedPortfolio } from "@/lib/disdex-unified-portfolio-routing";

const plan = planUnifiedPortfolio([
    { sleeve: "V12", symbol: "ETHUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 },
    { sleeve: "V11_EQ", symbol: "METAUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 },
    { sleeve: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", side: "SHORT", gross: 0.75, notionalUsd: 750, signalTs: 1 },
    { sleeve: "V12", symbol: "UNKNOWNUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 },
], []);
assert.equal(plan.accepted.length, 3);
assert.equal(plan.rejected[0].reason, "UNKNOWN_OR_SLEEVE_MISMATCH");
assert.equal(plan.totalGross, 2.5);
assert.equal(planUnifiedPortfolio([{ sleeve: "V12", symbol: "SOLUSDT", side: "LONG", gross: 1, notionalUsd: 1, signalTs: 1 }], [{ sleeve: "V12", symbol: "ETHUSDT", gross: 0.5 }]).rejected[0].reason, "V12_SLOT_OCCUPIED_NO_PREEMPTION");
console.log("UNIFIED_PORTFOLIO_ROUTING_SELFTEST_PASS");
