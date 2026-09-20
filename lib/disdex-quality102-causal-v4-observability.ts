import { quality102GrossForFamily } from "../config/integratedProductionRiskPolicy";
import { evaluateQuality102CausalV4ImprovementGate } from "./disdex-quality102-causal-selector";
import {
    diagnoseQuality102HighVolSymbol,
    type Quality102CausalV1History,
    type Quality102CausalV1Signal,
    type Quality102HighVolObservabilityDiagnostic,
} from "./disdex-quality102-causal-v1-signal";
import { buildQuality102CausalV4Signal } from "./disdex-quality102-causal-v4-signal";
import { generateQuality102CausalV4S34Candidates } from "./disdex-quality102-causal-v4-s34";
import {
    diagnoseQuality102CausalV4S34Symbol,
    type Quality102S34ModelDiagnostic,
} from "./disdex-quality102-causal-v4-ranking";

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
    /** Observability-only 0-100 trigger-proximity score. Never used for trading. */
    rankingScore?: number;
    rankingRank?: number;
    rankingFamily?: "HIGH_VOL" | "PB" | "MR" | "BRK" | "REV";
    rankingLayer?: "S1" | "S2" | "S3" | "S4";
    rankingVariant?: string;
    rankingStage?: string;
    rankingReason?: string;
    diagnostics?: {
        highVol?: Quality102HighVolObservabilityDiagnostic;
        s34?: Quality102S34ModelDiagnostic[];
    };
}

export interface Quality102CausalV4DecisionSnapshot {
    schemaVersion: 1 | 2;
    rankingModelVersion?: "Q102_PROXIMITY_V1";
    rankingCapturedAt?: string;
    observerCommitSha?: string;
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


function highVolVariantLabel(diagnostic: Quality102HighVolObservabilityDiagnostic | undefined): string | undefined {
    const rule = diagnostic?.rule;
    if (!rule) return undefined;
    return `HV_LD${rule.longDrop}_LRSI${rule.longRsi}_SR${rule.shortRally}_SRSI${rule.shortRsi}_STOP${rule.hardStop}`;
}


export function augmentQuality102DecisionSnapshotWithRanking(input: {
    snapshot: Quality102CausalV4DecisionSnapshot;
    history: Quality102CausalV1History;
    highVolSymbols: readonly string[];
    observerCommitSha?: string;
    rankingCapturedAt?: string;
}): Quality102CausalV4DecisionSnapshot {
    const highVol = new Set(input.highVolSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
    const rankedItems = input.snapshot.items.map((item): Quality102CausalV4SymbolDecision => {
        const symbol = item.symbol.toUpperCase();
        try {
            const rows = input.history.candlesBySymbol[symbol];
            if (!rows?.length) throw new Error(`QUALITY102_OBSERVER_HISTORY_MISSING:${symbol}`);
            const entryOpen = input.history.entryOpenBySymbol?.[symbol];
            const dataCutoffTs = rows.at(-1)!.timestampMs;
            const highVolDiagnostic = highVol.has(symbol)
                ? diagnoseQuality102HighVolSymbol(symbol, rows, dataCutoffTs)
                : undefined;
            const s34Diagnostics = entryOpen
                ? diagnoseQuality102CausalV4S34Symbol({ symbol, rows, entryOpen })
                : [];
            const bestS34 = s34Diagnostics[0];
            const highVolScore = highVolDiagnostic?.rankingScore ?? -1;
            const s34Score = bestS34?.rankingScore ?? -1;
            const naturalEligible = item.eligible === true;

            const rankingFamily = naturalEligible && item.family
                ? item.family
                : highVolScore >= s34Score && highVolDiagnostic
                    ? "HIGH_VOL" as const
                    : bestS34?.family;
            const rankingLayer = naturalEligible && item.layer
                ? item.layer
                : rankingFamily === "HIGH_VOL"
                    ? "S1" as const
                    : bestS34?.layer;
            const rankingVariant = naturalEligible && item.variant
                ? item.variant
                : rankingFamily === "HIGH_VOL"
                    ? highVolVariantLabel(highVolDiagnostic)
                    : bestS34?.variant;
            const rankingScore = naturalEligible ? 100 : Math.max(0, highVolScore, s34Score);
            const rankingStage = naturalEligible
                ? "SIGNAL_READY"
                : rankingFamily === "HIGH_VOL"
                    ? (highVolDiagnostic?.rawMatched ? "HIGH_VOL_RAW_READY" : "HIGH_VOL_APPROACH")
                    : bestS34?.rankingStage || "NO_MODEL";
            const rankingReason = naturalEligible
                ? item.reason
                : rankingFamily === "HIGH_VOL"
                    ? highVolDiagnostic?.reason || item.reason
                    : bestS34?.reason || item.reason;

            return {
                ...item,
                rankingScore,
                ...(rankingFamily ? { rankingFamily } : {}),
                ...(rankingLayer ? { rankingLayer } : {}),
                ...(rankingVariant ? { rankingVariant } : {}),
                rankingStage,
                rankingReason,
                diagnostics: {
                    ...(highVolDiagnostic ? { highVol: highVolDiagnostic } : {}),
                    ...(s34Diagnostics.length ? { s34: s34Diagnostics } : {}),
                },
            };
        } catch (error) {
            return {
                ...item,
                rankingScore: 0,
                rankingStage: "OBSERVER_ERROR",
                rankingReason: error instanceof Error ? error.message : String(error),
            };
        }
    });

    const rankBySymbol = new Map(
        [...rankedItems]
            .sort((left, right) => (right.rankingScore ?? 0) - (left.rankingScore ?? 0) || left.symbol.localeCompare(right.symbol))
            .map((item, index) => [item.symbol, index + 1] as const),
    );

    return {
        ...input.snapshot,
        schemaVersion: 2,
        rankingModelVersion: "Q102_PROXIMITY_V1",
        rankingCapturedAt: input.rankingCapturedAt || new Date().toISOString(),
        ...(input.observerCommitSha ? { observerCommitSha: input.observerCommitSha } : {}),
        items: rankedItems.map((item) => ({ ...item, rankingRank: rankBySymbol.get(item.symbol) })),
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
