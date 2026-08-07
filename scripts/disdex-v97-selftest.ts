import assert from "node:assert/strict";
import { DISDEX_V97_CORE, DISDEX_V97_RUNTIME, resolveDisDexV97Runtime } from "../config/disdexV97Runtime";
import { buildDisDexV97Candidates, buildDisDexV97Signal, type DisDexV97Candle, type DisDexV97History, type DisDexV97Symbol } from "../lib/disdex-v97-signal-engine";

const BAR_MS = 4 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 1);

function bars(symbol: DisDexV97Symbol): DisDexV97Candle[] {
    const rows: DisDexV97Candle[] = [];
    for (let i = 0; i < 140; i += 1) {
        let close = 100;
        if (symbol === "SOLUSDT") {
            const progress = Math.min(1, i / 137);
            close = 110 - 20 * progress;
            if (i === 138) close = 90.6;
            if (i === 139) close = 91.8;
        }
        rows.push({
            openTime: start + i * BAR_MS,
            closeTime: start + (i + 1) * BAR_MS - 1,
            open: close,
            high: close * 1.002,
            low: close * 0.998,
            close,
            volume: 100,
        });
    }
    return rows;
}

const bars4h = {} as DisDexV97History["bars4h"];
const funding = {} as DisDexV97History["funding"];
for (const symbol of DISDEX_V97_CORE.symbols) {
    bars4h[symbol] = bars(symbol);
    funding[symbol] = [];
}
const history: DisDexV97History = { bars4h, funding };
const referenceTs = bars4h.BTCUSDT.at(-1)!.openTime;
const candidates = buildDisDexV97Candidates(history, referenceTs);
assert.equal(candidates[0]?.symbol, "SOLUSDT", "synthetic V97 event should select SOLUSDT");
assert.ok((candidates[0]?.movePct || 0) <= -5);
assert.ok((candidates[0]?.bouncePct || 0) >= 1);
const signal = buildDisDexV97Signal(history, undefined, 0.75, referenceTs + BAR_MS + 1000);
assert.equal(signal.side, -1);
assert.equal(signal.symbol, "SOLUSDT");
assert.equal(signal.targetGross, 0.75);
assert.equal(signal.entryTs, referenceTs + BAR_MS);
const held = buildDisDexV97Signal(history, { symbol: "SOLUSDT", side: -1, entryTs: referenceTs - 80 * 60 * 60_000, entryPrice: 100, quantity: 1, gross: 0.75 }, 0.75, referenceTs + BAR_MS + 1000);
assert.equal(held.side, 0);
assert.equal(held.exit, undefined);
const exit = buildDisDexV97Signal(history, { symbol: "SOLUSDT", side: -1, entryTs: referenceTs - 84 * 60 * 60_000, entryPrice: 100, quantity: 1, gross: 0.75 }, 0.75, referenceTs + BAR_MS + 1000);
assert.equal(exit.exit?.reason, "HOLD_84H_COMPLETE");

const attemptedLive = resolveDisDexV97Runtime({
    DISDEX_V97_MODE: "LIVE",
    DISDEX_V97_ENABLED: "true",
    DISDEX_V97_LIVE_TRADING_ENABLED: "true",
    DISDEX_V97_LIVE_EXECUTION_ENABLED: "true",
    DISDEX_V97_MAX_GROSS: "99",
    DISDEX_V97_PORTFOLIO_GROSS_CAP: "99",
    DISDEX_V97_MAX_DAILY_LOSS_PCT: "99",
});
assert.equal(DISDEX_V97_RUNTIME.liveTradingEnabled, false);
assert.equal(attemptedLive.liveTradingEnabled, false, "env must not bypass repository V97 live gate");
assert.equal(attemptedLive.maximumGross, 1.25);
assert.equal(attemptedLive.portfolioGrossCap, 2.5);
assert.equal(attemptedLive.maximumDailyLossPct, 2);
assert.equal(attemptedLive.closeUnmanagedPositions, false);
console.log(JSON.stringify({ status: "V97_SELFTEST_PASS", selectedSynthetic: candidates[0], attemptedLive }));
