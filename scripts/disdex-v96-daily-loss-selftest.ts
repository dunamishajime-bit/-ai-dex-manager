import assert from "node:assert/strict";
import { updateDisDexV96DailyRisk } from "../lib/disdex-v96-live-risk-controls";

const DAY1 = Date.parse("2026-07-27T23:59:00.000Z");
const DAY2 = Date.parse("2026-07-28T00:01:00.000Z");

const tripped = updateDisDexV96DailyRisk({
    previous: { utcDay: "2026-07-27", dayStartEquity: 100, lastEquity: 94, lossUsd: 6, lossPct: 6, lossLimitUsd: 5, tripped: true, lastCheckedAt: DAY1 },
    equity: 99, maximumDailyLossPct: 5, now: DAY2,
});
assert.equal(tripped.tripped, false);
assert.equal(tripped.resetReason, "UTC_DAY_ROLLOVER");
assert.equal(tripped.latchName, "portfolioDailyLossLatch");

const sameDay = updateDisDexV96DailyRisk({ previous: tripped, equity: 94, maximumDailyLossPct: 5, now: DAY2 + 60_000 });
assert.equal(sameDay.tripped, true);

console.log("DISDEX_V96_DAILY_LOSS_SELFTEST_PASS");
