import type { ConfirmedFiveMinuteBar } from "./disdex-exit-overlay-contract";
import type { PenguDualLsV2ShortV20State } from "./pengu-dual-ls-v2";

const FIVE_MINUTE_MS = 5 * 60_000;
const THREE_HOURS_MS = 3 * 3_600_000;
const EIGHT_HOURS_MS = 8 * 3_600_000;
const EPSILON = 1e-12;

export type PenguShortV20TimedStopAction =
    | { kind: "TIMED_NEGATIVE_3H_EXIT"; referenceTs: number; lossPct: number }
    | { kind: "TIMED_NEGATIVE_8H_EXIT"; referenceTs: number; lossPct: number };

export type PenguShortV20TimedStopState = PenguDualLsV2ShortV20State & {
    timedStop3hChecked?: boolean;
    timedStop3hCheckedAtTs?: number;
    timedStop3hCheckedClose?: number;
    timedStop3hTriggered?: boolean;
    timedStop8hChecked?: boolean;
    timedStop8hCheckedAtTs?: number;
    timedStop8hCheckedClose?: number;
    timedStop8hTriggered?: boolean;
};

function finitePositive(value: unknown, code: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
    return parsed;
}

function validateBars(bars: readonly ConfirmedFiveMinuteBar[]) {
    const sorted = [...bars].sort((left, right) => left.timestampMs - right.timestampMs);
    for (let index = 0; index < sorted.length; index += 1) {
        const bar = sorted[index]!;
        finitePositive(bar.timestampMs, "PENGU_SHORT_V20_TIMED_STOP_BAR_INVALID");
        for (const value of [bar.open, bar.high, bar.low, bar.close]) {
            finitePositive(value, "PENGU_SHORT_V20_TIMED_STOP_BAR_INVALID");
        }
        if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
            throw new Error("PENGU_SHORT_V20_TIMED_STOP_BAR_INVALID");
        }
        if (index > 0) {
            const previous = sorted[index - 1]!;
            if (bar.timestampMs === previous.timestampMs) throw new Error("PENGU_SHORT_V20_TIMED_STOP_BAR_DUPLICATE");
            if (bar.timestampMs - previous.timestampMs !== FIVE_MINUTE_MS) {
                throw new Error("PENGU_SHORT_V20_TIMED_STOP_M5_GAP");
            }
        }
    }
    return sorted;
}

function lossPct(entryPrice: number, close: number) {
    return Math.round((close / entryPrice - 1) * 100 * 1e12) / 1e12;
}

/**
 * Apply the adopted PENGU SHORT V20 timed adverse-price checks.
 *
 * Each stage consumes exactly the first confirmed M5 close whose bar closes
 * at or after the stage boundary. Missing or malformed evidence throws so a
 * live runner can hold without fabricating a price or interpolating a bar.
 */
export function advancePenguShortV20TimedStops(input: {
    position: { entryTs: number; entryPrice: number };
    state: PenguShortV20TimedStopState;
    bars: readonly ConfirmedFiveMinuteBar[];
}): { state: PenguShortV20TimedStopState; action?: PenguShortV20TimedStopAction } {
    const entryTs = finitePositive(input.position.entryTs, "PENGU_SHORT_V20_TIMED_STOP_ENTRY_TS_INVALID");
    const entryPrice = finitePositive(input.position.entryPrice, "PENGU_SHORT_V20_TIMED_STOP_ENTRY_PRICE_INVALID");
    const next: PenguShortV20TimedStopState = { ...input.state };
    const sorted = validateBars(input.bars);
    const stages = [
        {
            boundaryTs: entryTs + THREE_HOURS_MS,
            thresholdPct: 2.5,
            checked: next.timedStop3hChecked === true,
            markChecked: (bar: ConfirmedFiveMinuteBar) => {
                next.timedStop3hChecked = true;
                next.timedStop3hCheckedAtTs = bar.timestampMs + FIVE_MINUTE_MS;
                next.timedStop3hCheckedClose = bar.close;
                next.timedStop3hTriggered = false;
            },
            markTriggered: () => { next.timedStop3hTriggered = true; },
            kind: "TIMED_NEGATIVE_3H_EXIT" as const,
        },
        {
            boundaryTs: entryTs + EIGHT_HOURS_MS,
            thresholdPct: 4,
            checked: next.timedStop8hChecked === true,
            markChecked: (bar: ConfirmedFiveMinuteBar) => {
                next.timedStop8hChecked = true;
                next.timedStop8hCheckedAtTs = bar.timestampMs + FIVE_MINUTE_MS;
                next.timedStop8hCheckedClose = bar.close;
                next.timedStop8hTriggered = false;
            },
            markTriggered: () => { next.timedStop8hTriggered = true; },
            kind: "TIMED_NEGATIVE_8H_EXIT" as const,
        },
    ];

    for (const stage of stages) {
        if (stage.checked) continue;
        const candidate = sorted.find((bar) => bar.timestampMs + FIVE_MINUTE_MS > stage.boundaryTs);
        if (!candidate) continue;
        const adverseLossPct = lossPct(entryPrice, candidate.close);
        if (!Number.isFinite(adverseLossPct)) throw new Error("PENGU_SHORT_V20_TIMED_STOP_BAR_INVALID");
        stage.markChecked(candidate);
        if (adverseLossPct >= stage.thresholdPct - EPSILON) {
            stage.markTriggered();
            return { state: next, action: { kind: stage.kind, referenceTs: candidate.timestampMs + FIVE_MINUTE_MS, lossPct: adverseLossPct } };
        }
    }
    return { state: next };
}
