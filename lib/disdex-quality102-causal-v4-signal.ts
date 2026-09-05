import { QUALITY102_CAUSAL_V1 } from "../config/disdexQuality102CausalV1Runtime";
import {
    evaluateQuality102CausalV4ImprovementGate,
} from "./disdex-quality102-causal-selector";
import {
    buildQuality102CausalV1Signal,
    type Quality102CausalV1Signal,
    type Quality102CausalV1SignalInput,
} from "./disdex-quality102-causal-v1-signal";
import {
    generateQuality102CausalV4S34Candidates,
    type Quality102CausalV4S34Candidate,
} from "./disdex-quality102-causal-v4-s34";

const HOUR_MS = 3_600_000;
const LAYER_RANK = Object.freeze({ S3: 1, S4: 2 });
const FAMILY_RANK = Object.freeze({ BRK: 1, PB: 2, MR: 3, REV: 4 });

function currentHour(now: number): number {
    return Math.floor(now / HOUR_MS) * HOUR_MS;
}

function idleSignal(base: Quality102CausalV1Signal, reason: string, referenceTs = base.referenceTs): Quality102CausalV1Signal {
    return {
        strategyId: "QUALITY102_CAUSAL_V1",
        referenceTs,
        side: 0,
        requestedGross: 0,
        reason,
        dataCutoffTs: base.dataCutoffTs,
        brkEnabled: true,
    };
}

function selectedS34(input: Quality102CausalV1SignalInput): Quality102CausalV4S34Candidate | undefined {
    const entryTs = currentHour(input.decisionTs);
    const candidates: Quality102CausalV4S34Candidate[] = [];
    for (const [symbol, rows] of Object.entries(input.history.candlesBySymbol)) {
        if (symbol === "BTCUSDT") continue;
        const entryOpen = input.history.entryOpenBySymbol?.[symbol];
        if (!entryOpen) throw new Error(`QUALITY102_CAUSAL_V4_ENTRY_OPEN_MISSING:${symbol}`);
        if (entryOpen.timestampMs !== entryTs) throw new Error(`QUALITY102_CAUSAL_V4_ENTRY_OPEN_STALE:${symbol}`);
        candidates.push(...generateQuality102CausalV4S34Candidates({ symbol, rows, entryOpen }));
    }
    candidates.sort((a, b) => LAYER_RANK[a.layer] - LAYER_RANK[b.layer]
        || FAMILY_RANK[a.family] - FAMILY_RANK[b.family]
        || b.margin - a.margin
        || a.key.localeCompare(b.key));
    return candidates[0];
}

function materializeS34(candidate: Quality102CausalV4S34Candidate): Quality102CausalV1Signal {
    return {
        strategyId: "QUALITY102_CAUSAL_V1",
        referenceTs: candidate.entryTs,
        side: candidate.side,
        symbol: candidate.symbol,
        family: candidate.family,
        variant: candidate.variant,
        layer: candidate.layer,
        requestedGross: QUALITY102_CAUSAL_V1.maximumGross,
        reason: "QUALITY102_CAUSAL_V4_NATURAL_SIGNAL",
        dataCutoffTs: candidate.dataCutoffTs,
        hardStop: candidate.hardStop,
        maxHoldHours: candidate.maxHoldHours,
        exitPolicy: candidate.exitPolicy,
        brkEnabled: true,
    };
}

export interface Quality102CausalV4SignalOptions {
    readonly highVolSymbols?: readonly string[];
}

function highVolInput(input: Quality102CausalV1SignalInput, options: Quality102CausalV4SignalOptions): Quality102CausalV1SignalInput {
    if (!options.highVolSymbols) return input;
    const allowed = new Set(options.highVolSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
    if (!allowed.size) throw new Error("QUALITY102_CAUSAL_V4_HIGH_VOL_UNIVERSE_REQUIRED");
    const candlesBySymbol = Object.fromEntries(Object.entries(input.history.candlesBySymbol)
        .filter(([symbol]) => allowed.has(symbol.toUpperCase()) || symbol.toUpperCase() === "BTCUSDT"));
    for (const symbol of allowed) {
        if (!candlesBySymbol[symbol]) throw new Error(`QUALITY102_CAUSAL_V4_HIGH_VOL_HISTORY_MISSING:${symbol}`);
    }
    const entryOpenBySymbol = input.history.entryOpenBySymbol
        ? Object.fromEntries(Object.entries(input.history.entryOpenBySymbol)
            .filter(([symbol]) => allowed.has(symbol.toUpperCase()) || symbol.toUpperCase() === "BTCUSDT"))
        : undefined;
    return { ...input, history: { candlesBySymbol, ...(entryOpenBySymbol ? { entryOpenBySymbol } : {}) } };
}

export function buildQuality102CausalV4Signal(
    input: Quality102CausalV1SignalInput,
    options: Quality102CausalV4SignalOptions = {},
): Quality102CausalV1Signal {
    const legacy = buildQuality102CausalV1Signal(highVolInput(input, options));
    const occupied = input.sleeveOccupancy.activePosition || input.sleeveOccupancy.unresolvedPendingEntry;
    if (occupied) return { ...legacy, brkEnabled: true };
    const entryTs = currentHour(input.decisionTs);
    if (input.sleeveOccupancy.basePositionActive) return idleSignal(legacy, "QUALITY102_CAUSAL_V4_BASE_NOT_IDLE", entryTs);

    if (legacy.side !== 0 && legacy.symbol) {
        const entryOpen = input.history.entryOpenBySymbol?.[legacy.symbol];
        if (!entryOpen) throw new Error(`QUALITY102_CAUSAL_V4_ENTRY_OPEN_MISSING:${legacy.symbol}`);
        if (entryOpen.timestampMs !== entryTs) throw new Error(`QUALITY102_CAUSAL_V4_ENTRY_OPEN_STALE:${legacy.symbol}`);
        return {
            ...legacy,
            referenceTs: entryTs,
            family: "HIGH_VOL",
            requestedGross: QUALITY102_CAUSAL_V1.maximumGross,
            exitPolicy: "HIGH_VOL_TRAIL72",
            maxHoldHours: 72,
            brkEnabled: true,
        };
    }

    const candidate = selectedS34(input);
    if (!candidate) return idleSignal(legacy, "QUALITY102_CAUSAL_V4_NO_SIGNAL", entryTs);
    const improvement = evaluateQuality102CausalV4ImprovementGate({
        family: candidate.family,
        side: candidate.side,
        ret14: candidate.ret14,
    });
    if (!improvement.accepted) {
        return idleSignal(legacy, "QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL", entryTs);
    }
    return materializeS34(candidate);
}
