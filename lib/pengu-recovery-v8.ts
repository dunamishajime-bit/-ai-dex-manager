import { PENGU_RECOVERY_V8 } from "@/config/penguRecoveryV8";
import type { PenguDualLsV2EvaluationRow } from "@/lib/pengu-dual-ls-v2";

const HOUR = 3_600_000;

export interface RecoveryV8FeatureRow {
    index: number;
    referenceTs: number;
    close: number;
    low: number;
    high: number;
    previousClose: number;
    troughIndex: number;
    troughClose: number;
    troughAgeHours: number;
    rsiDelta6: number;
    ema168DistancePct: number;
    btcReturn6hPct: number;
    ordinaryLongEligible: boolean;
    ordinaryShortEligible: boolean;
    /** Set by the full-series adapter after the deduplicated 3% cross check. */
    recoveryCross?: boolean;
    /** The base Long edge is used for BASE_LONG yield, not Recovery entry. */
    baseLongSignal?: boolean;
}

export type RecoveryV8EntryKind = "RECOVERY_V8" | "NONE";

export interface RecoveryV8EntryDecision {
    kind: RecoveryV8EntryKind;
    gross: number;
    reason: string;
    row: RecoveryV8FeatureRow;
}

export interface RecoveryV8Position {
    side: 1;
    entryTs: number;
    entryPrice: number;
    quantity: number;
    originalGross: number;
    remainingGross: number;
    partialDefenseTriggered: boolean;
    highWaterMark: number;
}

export interface RecoveryV8DurableState extends RecoveryV8Position {
    version: "RECOVERY_V8";
    originalQuantity: number;
    protectionLifecycle: "FULL_HARD_STOP" | "SPLIT_PROTECTION" | "MANUAL_REVIEW";
    fullHardStopClientOrderId?: string;
    partialStopClientOrderId?: string;
    remainingHardStopClientOrderId?: string;
    partialDefenseArmedAtTs?: number;
    actualPartialFill?: {
        filledAtTs: number;
        executedQuantity: number;
        averagePrice: number;
        triggerPrice: number;
        slippageBps: number;
        orderId?: number;
        clientOrderId?: string;
    };
}

export type RecoveryV8PositionEvent = "PARTIAL_DEFENSE" | "HARD_STOP" | "TRAILING_STOP" | "MAX_HOLD" | "YIELD_BASE_LONG";

export interface RecoveryV8PositionDecision {
    kind: "NONE" | "PARTIAL_DEFENSE" | "HARD_STOP" | "TRAILING_STOP" | "MAX_HOLD" | "YIELD_BASE_LONG";
    updatedPosition: RecoveryV8Position;
    events: RecoveryV8PositionEvent[];
    triggerPrice?: number;
    partialQuantity?: number;
    partialGross?: number;
    stopPrice?: number;
}

function finite(value: number) {
    return Number.isFinite(value);
}

function inferredRecoveryCross(row: RecoveryV8FeatureRow) {
    const level = row.troughClose * (1 + 0.03);
    return row.troughIndex >= 0
        && row.troughAgeHours >= 1
        && row.troughAgeHours <= 48
        && finite(level)
        && row.previousClose < level
        && row.close >= level;
}

export function evaluateRecoveryV8Entry(row: RecoveryV8FeatureRow): RecoveryV8EntryDecision {
    const required = [row.rsiDelta6, row.ema168DistancePct, row.btcReturn6hPct];
    const finiteFeatures = required.every(finite);
    const recoveryCross = row.recoveryCross ?? inferredRecoveryCross(row);
    const pass = finiteFeatures
        && recoveryCross
        && !row.ordinaryShortEligible
        && !row.ordinaryLongEligible
        && row.rsiDelta6 >= PENGU_RECOVERY_V8.thresholds.rsiDelta6Min
        && row.ema168DistancePct >= PENGU_RECOVERY_V8.thresholds.ema168DistanceMinPct
        && row.btcReturn6hPct >= PENGU_RECOVERY_V8.thresholds.btcReturn6hMinPct;
    return pass
        ? {
            kind: "RECOVERY_V8",
            gross: PENGU_RECOVERY_V8.initialGross,
            reason: "PENGU Recovery V8 R_BTC3: deduplicated 3% recovery cross plus RSI delta, EMA168 distance, and BTC 6h thresholds passed.",
            row,
        }
        : {
            kind: "NONE",
            gross: 0,
            reason: "PENGU Recovery V8 R_BTC3 is not eligible on this completed H1 bar.",
            row,
        };
}

function partialPosition(position: RecoveryV8Position) {
    const ratio = PENGU_RECOVERY_V8.partial.gross / PENGU_RECOVERY_V8.initialGross;
    const partialQuantity = position.quantity * ratio;
    return {
        ...position,
        quantity: position.quantity - partialQuantity,
        remainingGross: PENGU_RECOVERY_V8.partial.remainingGross,
        partialDefenseTriggered: true,
    };
}

export function evaluateRecoveryV8PositionBar(position: RecoveryV8Position, row: RecoveryV8FeatureRow): RecoveryV8PositionDecision {
    const events: RecoveryV8PositionEvent[] = [];
    let updatedPosition = {
        ...position,
        highWaterMark: Math.max(position.entryPrice, position.highWaterMark),
    };
    const partialPrice = position.entryPrice * (1 - PENGU_RECOVERY_V8.partial.stopPct);
    const hardPrice = position.entryPrice * (1 - PENGU_RECOVERY_V8.exit.hardStopPct);
    const partialEligible = !position.partialDefenseTriggered
        && row.referenceTs >= position.entryTs + PENGU_RECOVERY_V8.partial.afterHours * HOUR
        && row.low <= partialPrice;
    if (partialEligible) {
        events.push("PARTIAL_DEFENSE");
        updatedPosition = partialPosition(updatedPosition);
    }
    if (row.low <= hardPrice) {
        events.push("HARD_STOP");
        return {
            kind: "HARD_STOP",
            updatedPosition,
            events,
            triggerPrice: partialEligible ? partialPrice : undefined,
            partialQuantity: partialEligible ? position.quantity * (PENGU_RECOVERY_V8.partial.gross / PENGU_RECOVERY_V8.initialGross) : undefined,
            partialGross: partialEligible ? PENGU_RECOVERY_V8.partial.gross : undefined,
            stopPrice: hardPrice,
        };
    }
    const previousBest = updatedPosition.highWaterMark;
    if (previousBest / position.entryPrice - 1 >= PENGU_RECOVERY_V8.exit.trailActivationPct) {
        const trailingPrice = previousBest * (1 - PENGU_RECOVERY_V8.exit.trailRetracePct);
        if (row.low <= trailingPrice) {
            events.push("TRAILING_STOP");
            return { kind: "TRAILING_STOP", updatedPosition, events, stopPrice: trailingPrice };
        }
    }
    updatedPosition = { ...updatedPosition, highWaterMark: Math.max(previousBest, row.high) };
    if (row.referenceTs >= position.entryTs + (PENGU_RECOVERY_V8.exit.maxHoldHours - 1) * HOUR) {
        events.push("MAX_HOLD");
        return { kind: "MAX_HOLD", updatedPosition, events };
    }
    if (row.baseLongSignal) {
        events.push("YIELD_BASE_LONG");
        return { kind: "YIELD_BASE_LONG", updatedPosition, events };
    }
    if (partialEligible) {
        return {
            kind: "PARTIAL_DEFENSE",
            updatedPosition,
            events,
            triggerPrice: partialPrice,
            partialQuantity: position.quantity * (PENGU_RECOVERY_V8.partial.gross / PENGU_RECOVERY_V8.initialGross),
            partialGross: PENGU_RECOVERY_V8.partial.gross,
        };
    }
    return { kind: "NONE", updatedPosition, events };
}

function rollingCloseMinIndex(rows: PenguDualLsV2EvaluationRow[], endExclusive: number, lookback: number) {
    let best = -1;
    let bestClose = Number.POSITIVE_INFINITY;
    const start = Math.max(0, endExclusive - lookback);
    for (let index = start; index < endExclusive; index += 1) {
        const close = rows[index].candle.close;
        if (close <= bestClose) {
            bestClose = close;
            best = index;
        }
    }
    return best;
}

/**
 * Adapts the existing completed H1 series to the exact fixed R_BTC3 inputs.
 * No future bar is read: the trough and all feature deltas use only prior/current
 * rows, and the 3% cross is deduplicated over the preceding five bars.
 */
export function buildRecoveryV8FeatureRows(rows: PenguDualLsV2EvaluationRow[]): Array<RecoveryV8FeatureRow | undefined> {
    const rawCross = rows.map((row, index) => {
        if (!row.features || index < 72) return false;
        const troughIndex = rollingCloseMinIndex(rows, index, 72);
        if (troughIndex < 0) return false;
        const troughClose = rows[troughIndex].candle.close;
        const age = index - troughIndex;
        const level = troughClose * 1.03;
        return age >= 1 && age <= 48 && rows[index - 1].candle.close < level && row.candle.close >= level;
    });
    return rows.map((row, index) => {
        const features = row.features;
        const previous = index >= 6 ? rows[index - 6].features : undefined;
        const btcPrevious = index >= 6 ? rows[index - 6].btcCandle.close : Number.NaN;
        if (!features || !previous || !(btcPrevious > 0)) return undefined;
        const troughIndex = rollingCloseMinIndex(rows, index, 72);
        if (troughIndex < 0) return undefined;
        const troughClose = rows[troughIndex].candle.close;
        const duplicate = rawCross.slice(Math.max(0, index - 5), index).some(Boolean);
        return {
            index,
            referenceTs: row.candle.openTime,
            close: row.candle.close,
            low: row.candle.low,
            high: row.candle.high,
            previousClose: rows[index - 1]?.candle.close ?? Number.NaN,
            troughIndex,
            troughClose,
            troughAgeHours: index - troughIndex,
            rsiDelta6: features.rsi14 - previous.rsi14,
            ema168DistancePct: (row.candle.close / features.ema168 - 1) * 100,
            btcReturn6hPct: (row.btcCandle.close / btcPrevious - 1) * 100,
            ordinaryLongEligible: row.longSignal,
            ordinaryShortEligible: row.shortSignal,
            recoveryCross: rawCross[index] && !duplicate,
            baseLongSignal: row.longSignal,
        } satisfies RecoveryV8FeatureRow;
    });
}
