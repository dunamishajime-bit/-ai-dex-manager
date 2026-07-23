import {
    buildDisDexV35Signal,
    type DisDexPenguRule,
    type DisDexV35Candle,
    type DisDexV35CoreSymbol,
    type DisDexV35SignalResult,
} from "@/lib/disdex-v35-signal-engine";
import {
    resolveDisDexV35Allocation,
    type DisDexV35Regime,
} from "@/lib/disdex-resilient-profit-main-v35";
import type { DisDexPenguV46History } from "@/lib/pengu-dual-engine-v46";
import {
    runDisDexV95CoreController,
    type DisDexV95CoreFrame,
    type DisDexV95CoreWeightMap,
} from "@/lib/disdex-v95-core-controller";
import { buildDisDexV96CoreTargetSeries } from "@/lib/disdex-v96-core-signal";

const CORE_SYMBOLS: DisDexV35CoreSymbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
const MINIMUM_CORE_HISTORY_BARS = 140;

const DISABLED_PENGU_RULE: DisDexPenguRule = {
    id: "V95_CORE_ONLY",
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

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function gross(weights: DisDexV95CoreWeightMap) {
    return Object.values(weights).reduce((sum, weight) => sum + Math.abs(finite(weight)), 0);
}

function regimeFor(weights: DisDexV95CoreWeightMap): DisDexV35Regime {
    if (Object.values(weights).some((weight) => finite(weight) > 0)) return "BULL";
    if (Object.values(weights).some((weight) => finite(weight) < 0)) return "BEAR";
    return "FLAT";
}

function completedRows(rows: DisDexV35Candle[], now: number) {
    return [...rows]
        .filter((row) => row.openTime > 0 && row.closeTime > row.openTime && row.closeTime < now && row.close > 0)
        .sort((left, right) => left.openTime - right.openTime)
        .filter((row, index, source) => index === 0 || row.openTime !== source[index - 1].openTime);
}

function commonCoreHistory(history: DisDexPenguV46History, now: number) {
    const rows = Object.fromEntries(
        CORE_SYMBOLS.map((symbol) => [symbol, completedRows(history.core12h[symbol], now)]),
    ) as Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
    const maps = Object.fromEntries(
        CORE_SYMBOLS.map((symbol) => [symbol, new Map(rows[symbol].map((row) => [row.openTime, row]))]),
    ) as Record<DisDexV35CoreSymbol, Map<number, DisDexV35Candle>>;
    const times = rows.BTCUSDT
        .map((row) => row.openTime)
        .filter((ts) => CORE_SYMBOLS.every((symbol) => maps[symbol].has(ts)))
        .sort((left, right) => left - right);
    return { rows, maps, times };
}

function prefixAt(
    rows: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    referenceTs: number,
) {
    return Object.fromEntries(
        CORE_SYMBOLS.map((symbol) => [symbol, rows[symbol].filter((row) => row.openTime <= referenceTs)]),
    ) as Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
}

function nextSymbolReturns(
    maps: Record<DisDexV35CoreSymbol, Map<number, DisDexV35Candle>>,
    times: number[],
    index: number,
): DisDexV95CoreWeightMap {
    const currentTs = times[index];
    const nextTs = times[index + 1];
    if (nextTs === undefined) return {};
    return Object.fromEntries(CORE_SYMBOLS.map((symbol) => {
        const current = maps[symbol].get(currentTs);
        const next = maps[symbol].get(nextTs);
        const value = current && next && current.close > 0 ? next.close / current.close - 1 : 0;
        return [symbol, value];
    }));
}

function withV96CoreTarget(
    diagnosticCore: DisDexV35SignalResult,
    target: DisDexV95CoreWeightMap,
): DisDexV35SignalResult {
    const coreGross = gross(target);
    const regime = regimeFor(target);
    const allocation = resolveDisDexV35Allocation({
        regime,
        coreGross,
        penguSignalActive: false,
        features: {
            btcCloseAboveSma20d: diagnosticCore.diagnostics.btcCloseAboveSma20d,
            btcMomentum20dPct: diagnosticCore.diagnostics.btcMomentum20dPct,
            btcMomentum3dPct: diagnosticCore.diagnostics.btcMomentum3dPct,
            btcShock1dPct: diagnosticCore.diagnostics.btcShock1dPct,
            coreDownsideVolatilitySkew: diagnosticCore.diagnostics.coreDownsideVolatilitySkew,
        },
    });
    const coreScale = coreGross > 0 ? allocation.finalCoreGross / coreGross : 0;
    const targetWeights = Object.fromEntries(
        Object.entries(target)
            .map(([symbol, weight]) => [symbol, finite(weight) * coreScale])
            .filter(([, weight]) => Math.abs(finite(weight)) > 1e-8),
    ) as DisDexV35SignalResult["targetWeights"];
    return {
        ...diagnosticCore,
        regime,
        coreTargetBeforeV35: target,
        coreGrossBeforeV35: coreGross,
        penguSide: 0,
        penguEntryTs: undefined,
        penguExitTs: undefined,
        allocation,
        targetWeights,
    };
}

export interface DisDexV95CoreSignal {
    strategyId: "V35_WEIGHT_BAND_PLUS_FIXED_STRONG_V95";
    referenceTs: number;
    rawCore: DisDexV35SignalResult;
    targetWeights: DisDexV95CoreWeightMap;
    finalGross: number;
    controller: ReturnType<typeof runDisDexV95CoreController>;
    replayedBars: number;
    chronology: {
        usesCompleted12hBarsOnly: true;
        latestCompletedOpenTime: number;
        latestCompletedCloseTime: number;
        nextUnobservedReturnForcedToZero: true;
    };
}

export function buildDisDexV95CoreSignal(
    history: DisDexPenguV46History,
    now = Date.now(),
): DisDexV95CoreSignal {
    const common = commonCoreHistory(history, now);
    if (common.times.length < MINIMUM_CORE_HISTORY_BARS) {
        throw new Error(`V95 core history is insufficient: ${common.times.length} completed common 12h bars.`);
    }
    const v96Targets = buildDisDexV96CoreTargetSeries(common.rows).targets;

    const frames: DisDexV95CoreFrame[] = [];
    let latestCore: DisDexV35SignalResult | undefined;
    for (let index = MINIMUM_CORE_HISTORY_BARS - 1; index < common.times.length; index += 1) {
        const referenceTs = common.times[index];
        const diagnosticCore = buildDisDexV35Signal({
            core12h: prefixAt(common.rows, referenceTs),
            btc1h: [],
            pengu1h: [],
        }, DISABLED_PENGU_RULE, now);
        const core = withV96CoreTarget(
            diagnosticCore,
            (v96Targets.get(referenceTs) || {}) as DisDexV95CoreWeightMap,
        );
        const rawGross = Math.max(0, finite(core.coreGrossBeforeV35));
        const v35Scale = rawGross > 0
            ? Math.max(0, finite(core.allocation.finalCoreGross) / rawGross)
            : 0;
        frames.push({
            referenceTs: core.referenceTs,
            rawTarget: core.coreTargetBeforeV35 as DisDexV95CoreWeightMap,
            v35Scale,
            symbolReturns: nextSymbolReturns(common.maps, common.times, index),
            regime: core.regime === "BULL" ? 1 : core.regime === "BEAR" ? -1 : 0,
            features: {
                closeAboveSma20: core.diagnostics.btcCloseAboveSma20d,
                mom20: core.diagnostics.btcMomentum20dPct,
                mom3: core.diagnostics.btcMomentum3dPct,
                shock: core.diagnostics.btcShock1dPct,
                skew: core.diagnostics.coreDownsideVolatilitySkew,
            },
        });
        latestCore = core;
    }

    if (!latestCore || !frames.length) throw new Error("V95 core replay produced no frames.");
    const controller = runDisDexV95CoreController(frames);
    const latestCandle = common.maps.BTCUSDT.get(common.times.at(-1)!);
    if (!latestCandle) throw new Error("V95 latest completed BTC 12h candle is missing.");
    return {
        strategyId: "V35_WEIGHT_BAND_PLUS_FIXED_STRONG_V95",
        referenceTs: latestCore.referenceTs,
        rawCore: latestCore,
        targetWeights: controller.finalTarget,
        finalGross: controller.finalGross,
        controller,
        replayedBars: frames.length,
        chronology: {
            usesCompleted12hBarsOnly: true,
            latestCompletedOpenTime: latestCandle.openTime,
            latestCompletedCloseTime: latestCandle.closeTime,
            nextUnobservedReturnForcedToZero: true,
        },
    };
}
