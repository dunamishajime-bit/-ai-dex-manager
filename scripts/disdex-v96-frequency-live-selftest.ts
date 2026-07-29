import assert from "node:assert/strict";
import { DISDEX_V96_ALLOCATION, DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import {
    buildDisDexV35Signal,
    type DisDexPenguRule,
    type DisDexV35Candle,
    type DisDexV35CoreSymbol,
} from "../lib/disdex-v35-signal-engine";
import { buildDisDexV96CoreTargetSeries } from "../lib/disdex-v96-core-signal";

const HOUR = 3_600_000;
const BAR_12H = 12 * HOUR;
const CORE_SYMBOLS: DisDexV35CoreSymbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
const DISABLED_PENGU_RULE: DisDexPenguRule = {
    id: "V96_FREQUENCY_SELFTEST",
    family: "TREND",
    fast: 1,
    slow: 2,
    threshold: 0,
    volumeFloor: 0,
    btcFilter: "NONE",
    decisionHours: 6,
    holdHours: 24,
    enabled: false,
};

function history() {
    const start = Date.UTC(2023, 0, 1);
    const count = 170;
    const core12h = Object.fromEntries(CORE_SYMBOLS.map((symbol, symbolIndex) => {
        const rows: DisDexV35Candle[] = [];
        let price = 100 + symbolIndex * 10;
        for (let index = 0; index < count; index += 1) {
            const growth = 0.0025 + symbolIndex * 0.0004;
            const close = price * (1 + growth);
            const volume = 1_000_000 * 0.986 ** index;
            rows.push({
                openTime: start + index * BAR_12H,
                closeTime: start + (index + 1) * BAR_12H - 1,
                open: price,
                high: close * 1.002,
                low: price * 0.998,
                close,
                volume,
            });
            price = close;
        }
        return [symbol, rows];
    })) as Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
    const now = start + (count + 1) * BAR_12H;
    return { core12h, now };
}

function gross(weights: Record<string, number> | Partial<Record<DisDexV35CoreSymbol, number>>) {
    return Object.values(weights).reduce((sum, value) => sum + Math.abs(Number(value) || 0), 0);
}

function main() {
    assert.equal(DISDEX_V96_ALLOCATION.productionRevision, "CORE_VOLUME50_TURNOVER075_LIVE_R1");
    assert.equal(DISDEX_V96_ALLOCATION.historicalResearchPr, 73);
    assert.equal(DISDEX_V96_ALLOCATION.corePolicy.componentVolumeFloor, 0.50);
    assert.equal(DISDEX_V96_ALLOCATION.corePolicy.weightBandTolerancePct, 5);
    assert.equal(DISDEX_V96_ALLOCATION.corePolicy.portfolioRebalanceThresholdPct, 7.5);
    assert.equal(DISDEX_V96_ALLOCATION.corePolicy.forcedRefreshBars, 12);
    assert.equal(DISDEX_V96_ALLOCATION.penguTargetGross, 1.15);
    assert.equal(DISDEX_V96_ALLOCATION.totalGrossCap, 2);
    assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross, 0.15);
    assert.equal(DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct, 5);
    assert.equal(DISDEX_V96_RUNTIME.minimumOrderNotionalUsd, 5);
    assert.equal(DISDEX_V96_RUNTIME.rebalanceTolerancePct, 1);
    assert.equal(DISDEX_V96_RUNTIME.closeUnmanagedPositions, false);

    const fixture = history();
    const v96 = buildDisDexV96CoreTargetSeries(fixture.core12h);
    const latestTs = v96.times.at(-1);
    assert.ok(latestTs !== undefined);
    const v96Target = v96.targets.get(latestTs!) || {};
    assert.ok(gross(v96Target) > 0, "V96 Volume50 must admit the declining-volume trend fixture.");

    const genericV35 = buildDisDexV35Signal({
        core12h: fixture.core12h,
        btc1h: [],
        pengu1h: [],
    }, DISABLED_PENGU_RULE, fixture.now);
    assert.equal(
        gross(genericV35.coreTargetBeforeV35),
        0,
        "The shared V35 Volume70 signal must remain unchanged; V96 relaxation is isolated.",
    );

    console.log(JSON.stringify({
        status: "DISDEX_V96_VOLUME50_TURNOVER075_LIVE_SELFTEST_PASS",
        productionRevision: DISDEX_V96_ALLOCATION.productionRevision,
        componentVolumeFloor: DISDEX_V96_ALLOCATION.corePolicy.componentVolumeFloor,
        portfolioRebalanceThresholdPct: DISDEX_V96_ALLOCATION.corePolicy.portfolioRebalanceThresholdPct,
        sharedV35Unchanged: true,
        penguRulesChanged: false,
        grossCap: DISDEX_V96_ALLOCATION.totalGrossCap,
    }));
}

main();
