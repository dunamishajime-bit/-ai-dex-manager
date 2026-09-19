import { quality102GrossForFamily } from "../config/integratedProductionRiskPolicy";
import { evaluateQuality102CausalV4ImprovementGate } from "./disdex-quality102-causal-selector";
import type { Quality102CausalV1History, Quality102CausalV1Signal } from "./disdex-quality102-causal-v1-signal";
import { buildQuality102CausalV4Signal } from "./disdex-quality102-causal-v4-signal";
import { generateQuality102CausalV4S34Candidates } from "./disdex-quality102-causal-v4-s34";

const LAYER_RANK = Object.freeze({ S3: 1, S4: 2 });
const FAMILY_RANK = Object.freeze({ BRK: 1, PB: 2, MR: 3, REV: 4 });

export interface Quality102CausalV4SymbolDecision {
    symbol: string;
    eligible: boolean;
    side: "LONG" | "SHORT" | "WAIT";
    family?: "HIGH_VOL" | "PB" | "MR" | "BRK" | "REV";
    layer?: "S1" | "S2" | "S3" | "S4";
    variant?: string;
    requestedGross: number;
    reason: string;
    selected: boolean;
    referenceTs: number;
}

export interface Quality102CausalV4DecisionSnapshot {
    schemaVersion: 1;
    strategyId: "QUALITY102_CAUSAL_V1";
    selectorMode: "CAUSAL_V4";
    runtimeCommitSha: string;
    capturedAt: string;
    decisionTs: number;
    referenceTs: number;
    selectedSymbol?: string;
    selectedFamily?: string;
    selectedReason: string;
    items: Quality102CausalV4SymbolDecision[];
}

function subsetHistory(history: Quality102CausalV1History, symbol: string): Quality102CausalV1History {
    const normalized = symbol.toUpperCase();
    const candles = history.candlesBySymbol[normalized];
    if (!candles) throw new Error(`QUALITY102_OBSERVER_HISTORY_MISSING:${normalized}`);
    const btc = history.candlesBySymbol.BTCUSDT;
    if (!btc) throw new Error("QUALITY102_OBSERVER_BTC_HISTORY_MISSING");
    const entryOpen = history.entryOpenBySymbol?.[normalized];
    return {
        candlesBySymbol: { BTCUSDT: btc, [normalized]: candles },
        ...(entryOpen ? { entryOpenBySymbol: { [normalized]: entryOpen } } : {}),
    };
}

function itemFromSignal(symbol: string, signal: Quality102CausalV1Signal): Omit<Quality102CausalV4SymbolDecision, "selected"> {
    return {
        symbol,
        eligible: signal.side !== 0 && Boolean(signal.symbol),
        side: signal.side > 0 ? "LONG" : signal.side < 0 ? "SHORT" : "WAIT",
        family: signal.family,
        layer: signal.layer,
        variant: signal.variant,
        requestedGross: signal.requestedGross,
        reason: signal.reason,
        referenceTs: signal.referenceTs,
    };
}

function nonHighVolNaturalSignal(
    history: Quality102CausalV1History,
    symbol: string,
    decisionTs: number,
): Quality102CausalV1Signal {
    const rows = history.candlesBySymbol[symbol];
    const entryOpen = history.entryOpenBySymbol?.[symbol];
    const entryTs = Math.floor(decisionTs / 3_600_000) * 3_600_000;
    if (!rows) throw new Error(`QUALITY102_OBSERVER_HISTORY_MISSING:${symbol}`);
    if (!entryOpen) throw new Error(`QUALITY102_CAUSAL_V4_ENTRY_OPEN_MISSING:${symbol}`);
    if (entryOpen.timestampMs !== entryTs) throw new Error(`QUALITY102_CAUSAL_V4_ENTRY_OPEN_STALE:${symbol}`);

    const candidates = generateQuality102CausalV4S34Candidates({ symbol, rows, entryOpen });
    candidates.sort((a, b) => LAYER_RANK[a.layer] - LAYER_RANK[b.layer]
        || FAMILY_RANK[a.family] - FAMILY_RANK[b.family]
        || b.margin - a.margin
        || a.key.localeCompare(b.key));
    const candidate = candidates[0];
    const dataCutoffTs = rows.at(-1)?.timestampMs ?? entryTs - 3_600_000;
    if (!candidate) {
        return {
            strategyId: "QUALITY102_CAUSAL_V1",
            referenceTs: entryTs,
            side: 0,
            requestedGross: 0,
            reason: "QUALITY102_CAUSAL_V4_NO_SIGNAL",
            dataCutoffTs,
            brkEnabled: true,
        };
    }
    const improvement = evaluateQuality102CausalV4ImprovementGate({
        family: candidate.family,
        side: candidate.side,
        ret14: candidate.ret14,
    });
    if (!improvement.accepted) {
        return {
            strategyId: "QUALITY102_CAUSAL_V1",
            referenceTs: entryTs,
            side: 0,
            requestedGross: 0,
            reason: "QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL",
            dataCutoffTs: candidate.dataCutoffTs,
            brkEnabled: true,
        };
    }
    return {
        strategyId: "QUALITY102_CAUSAL_V1",
        referenceTs: candidate.entryTs,
        side: candidate.side,
        symbol: candidate.symbol,
        family: candidate.family,
        variant: candidate.variant,
        layer: candidate.layer,
        requestedGross: quality102GrossForFamily(candidate.family),
        reason: "QUALITY102_CAUSAL_V4_NATURAL_SIGNAL",
        dataCutoffTs: candidate.dataCutoffTs,
        hardStop: candidate.hardStop,
        maxHoldHours: candidate.maxHoldHours,
        exitPolicy: candidate.exitPolicy,
        brkEnabled: true,
    };
}

export function buildQuality102CausalV4DecisionSnapshot(input: {
    history: Quality102CausalV1History;
    decisionTs: number;
    highVolSymbols: readonly string[];
    symbols: readonly string[];
    runtimeCommitSha: string;
}): Quality102CausalV4DecisionSnapshot {
    const highVol = new Set(input.highVolSymbols.map((symbol) => symbol.toUpperCase()));
    const globalSignal = buildQuality102CausalV4Signal({
        history: input.history,
        decisionTs: input.decisionTs,
        sleeveOccupancy: { activePosition: false, unresolvedPendingEntry: false, basePositionActive: false },
    }, { highVolSymbols: [...highVol] });

    const items = input.symbols
        .map((symbol) => symbol.toUpperCase())
        .filter((symbol) => symbol !== "BTCUSDT")
        .map((symbol) => {
            try {
                const signal = highVol.has(symbol)
                    ? buildQuality102CausalV4Signal({
                        history: subsetHistory(input.history, symbol),
                        decisionTs: input.decisionTs,
                        sleeveOccupancy: { activePosition: false, unresolvedPendingEntry: false, basePositionActive: false },
                    }, { highVolSymbols: [symbol] })
                    : nonHighVolNaturalSignal(input.history, symbol, input.decisionTs);
                return {
                    ...itemFromSignal(symbol, signal),
                    selected: globalSignal.side !== 0 && globalSignal.symbol?.toUpperCase() === symbol,
                };
            } catch (error) {
                return {
                    symbol,
                    eligible: false,
                    side: "WAIT" as const,
                    requestedGross: 0,
                    reason: `OBSERVER_ERROR:${error instanceof Error ? error.message : String(error)}`,
                    selected: false,
                    referenceTs: Math.floor(input.decisionTs / 3_600_000) * 3_600_000,
                };
            }
        });

    return {
        schemaVersion: 1,
        strategyId: "QUALITY102_CAUSAL_V1",
        selectorMode: "CAUSAL_V4",
        runtimeCommitSha: input.runtimeCommitSha,
        capturedAt: new Date(input.decisionTs).toISOString(),
        decisionTs: input.decisionTs,
        referenceTs: globalSignal.referenceTs,
        selectedSymbol: globalSignal.symbol,
        selectedFamily: globalSignal.family,
        selectedReason: globalSignal.reason,
        items,
    };
}
