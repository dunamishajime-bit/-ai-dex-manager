import type { ConfirmedFiveMinuteBar } from "./disdex-exit-overlay-contract";

const EPSILON = 1e-12;
const SOFT_TOUCH_PCT = 3.5;
const SOFT_WATCH_MS = 2 * 3_600_000;
const TRAIL_ARM_PCT = 3;
const TRAIL_GIVEBACK_PCT = 1.5;

export type AvaxResidualEntryVeto = "CO_DECLINE" | "DIVERGENT_RALLY";

export function evaluateAvaxResidualEntryVeto(input: {
    avax3hPct: number;
    btc3hPct: number;
    avax6hPct: number;
    btc6hPct: number;
}): AvaxResidualEntryVeto | undefined {
    const values = [input.avax3hPct, input.btc3hPct, input.avax6hPct, input.btc6hPct];
    if (!values.every(Number.isFinite)) throw new Error("IDLE_RESIDUAL_AVAX_ENTRY_GATE_INPUT_INVALID");
    if (input.avax3hPct <= -0.5 && input.btc3hPct < 0) return "CO_DECLINE";
    if (input.avax6hPct >= 2 && input.btc6hPct < 0) return "DIVERGENT_RALLY";
    return undefined;
}

export function advanceAvaxSoftWatch(input: {
    entryPrice: number;
    bidPrice: number;
    now: number;
    firstTouchAtTs?: number;
    watchDeadlineTs?: number;
}): {
    firstTouchAtTs?: number;
    watchDeadlineTs?: number;
    action?: "SOFT_MINUS3P5_WATCH2H";
} {
    if (![input.entryPrice, input.bidPrice, input.now].every(Number.isFinite) || input.entryPrice <= 0 || input.bidPrice <= 0 || input.now <= 0) {
        throw new Error("IDLE_RESIDUAL_AVAX_SOFT_WATCH_INPUT_INVALID");
    }
    const threshold = input.entryPrice * (1 - SOFT_TOUCH_PCT / 100);
    const touched = input.bidPrice <= threshold + EPSILON;
    if (input.firstTouchAtTs === undefined || input.watchDeadlineTs === undefined) {
        return touched
            ? { firstTouchAtTs: input.now, watchDeadlineTs: input.now + SOFT_WATCH_MS }
            : {};
    }
    if (!Number.isFinite(input.firstTouchAtTs) || !Number.isFinite(input.watchDeadlineTs) || input.watchDeadlineTs < input.firstTouchAtTs) {
        throw new Error("IDLE_RESIDUAL_AVAX_SOFT_WATCH_STATE_INVALID");
    }
    if (!touched) return {};
    if (input.now >= input.watchDeadlineTs) return {
        firstTouchAtTs: input.firstTouchAtTs,
        watchDeadlineTs: input.watchDeadlineTs,
        action: "SOFT_MINUS3P5_WATCH2H",
    };
    return { firstTouchAtTs: input.firstTouchAtTs, watchDeadlineTs: input.watchDeadlineTs };
}

export type AvaxTrailState = {
    armed: boolean;
    bestClosePct?: number;
    lastConfirmed5mTs?: number;
};

export function advanceAvaxTrail(input: {
    entryPrice: number;
    armed: boolean;
    bestClosePct?: number;
    lastConfirmed5mTs?: number;
    bars: readonly ConfirmedFiveMinuteBar[];
}): { state: AvaxTrailState; action?: "AVAX_TRAIL_ARM3_GIVE1P5" } {
    if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) throw new Error("IDLE_RESIDUAL_AVAX_TRAIL_ENTRY_PRICE_INVALID");
    let state: AvaxTrailState = {
        armed: input.armed === true,
        bestClosePct: input.bestClosePct,
        lastConfirmed5mTs: input.lastConfirmed5mTs,
    };
    const sorted = [...input.bars].sort((left, right) => left.timestampMs - right.timestampMs);
    for (const bar of sorted) {
        if (![bar.timestampMs, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
            || bar.timestampMs <= 0 || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0
            || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
            throw new Error("IDLE_RESIDUAL_AVAX_TRAIL_BAR_INVALID");
        }
        if (state.lastConfirmed5mTs !== undefined && bar.timestampMs <= state.lastConfirmed5mTs) continue;
        const closePct = Math.round((bar.close / input.entryPrice - 1) * 100 * 1e12) / 1e12;
        const bestClosePct = Math.round(Math.max(state.bestClosePct ?? Number.NEGATIVE_INFINITY, closePct) * 1e12) / 1e12;
        const armed = state.armed || bestClosePct >= TRAIL_ARM_PCT - EPSILON;
        state = { armed, bestClosePct, lastConfirmed5mTs: bar.timestampMs };
        if (armed && closePct <= bestClosePct - TRAIL_GIVEBACK_PCT + EPSILON) {
            return { state, action: "AVAX_TRAIL_ARM3_GIVE1P5" };
        }
    }
    return { state };
}
