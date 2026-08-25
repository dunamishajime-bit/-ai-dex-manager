import { PENGU_DUAL_LS_V2 } from "@/config/penguDualLsV2Runtime";
import type {
    PenguDualLsV2Features,
    PenguDualLsV2Position,
    PenguDualLsV2ShortV20State,
    PenguDualLsV2SizingState,
} from "@/lib/pengu-dual-ls-v2";

/** Frozen research lineage for COUNTERWIND_VOL_TARGET_FAILURE_EXIT. */
export const PENGU_SHORT_V20_PRE_REGISTRATION_SHA = "ad7cedb3cafaf9f9680e390112f72375d84b50ac" as const;
export const PENGU_SHORT_V20_CANDIDATE = "COUNTERWIND_VOL_TARGET_FAILURE_EXIT" as const;

export type PenguShortV20Action =
    | { kind: "VOL_TARGET_FAILURE_EXIT"; referenceTs: number; exitPrice: number }
    | { kind: "DEADLINE_EXIT"; referenceTs: number; exitPrice: number }
    | { kind: "THESIS_RESUMED"; referenceTs: number };

export interface PenguShortV20AdvanceResult {
    state: PenguDualLsV2ShortV20State;
    action?: PenguShortV20Action;
}

export function calculatePenguShortV20NetReturn(input: {
    entryPrice: number;
    exitPrice: number;
    requestedGross: number;
    fundingReturn: number;
    costPerSide: number;
}) {
    const values = [input.entryPrice, input.exitPrice, input.requestedGross, input.fundingReturn, input.costPerSide];
    if (!values.every(Number.isFinite) || input.entryPrice <= 0 || input.exitPrice <= 0 || input.requestedGross < 0 || input.costPerSide < 0) {
        throw new Error("PENGU Short V20 return calculation requires valid finite inputs.");
    }
    const raw = input.entryPrice / input.exitPrice - 1;
    const netUnitReturn = raw + input.fundingReturn - 2 * input.costPerSide;
    return { raw, netUnitReturn, accountReturn: input.requestedGross * netUnitReturn };
}

export function classifyPenguShortV20SizingState(requestedGross: number): PenguDualLsV2SizingState {
    if (requestedGross === PENGU_DUAL_LS_V2.sizing.grossCap) return "CAP";
    if (requestedGross === PENGU_DUAL_LS_V2.sizing.grossFloor) return "FLOOR";
    return "VOL_TARGET";
}

export function createPenguShortV20State(input: {
    entryPrice: number;
    requestedGross: number;
    entryAtr24Ratio: number;
    btcEma168Distance: number;
    btcReturn24h: number;
}): PenguDualLsV2ShortV20State {
    if (![input.entryPrice, input.requestedGross, input.entryAtr24Ratio, input.btcEma168Distance, input.btcReturn24h].every(Number.isFinite)) {
        throw new Error("PENGU Short V20 state requires finite entry features.");
    }
    return {
        version: "SHORT_V20",
        preRegistrationSha: PENGU_SHORT_V20_PRE_REGISTRATION_SHA,
        requestedGross: input.requestedGross,
        sizingState: classifyPenguShortV20SizingState(input.requestedGross),
        entryAtr24Ratio: input.entryAtr24Ratio,
        counterwind: input.btcEma168Distance >= 0 || input.btcReturn24h >= 0,
        armed: false,
        progressed: false,
        lowWater: input.entryPrice,
        phase: "TRACKING",
    };
}

/**
 * Advances only the frozen V20 Short transformation. Baseline hard-stop,
 * trailing-stop and max-hold checks remain in the V2 engine and are evaluated
 * separately. The caller must pass only completed H1 features.
 */
export function advancePenguShortV20(
    position: Pick<PenguDualLsV2Position, "entryPrice" | "entryTs"> & { shortV20: PenguDualLsV2ShortV20State },
    features: PenguDualLsV2Features,
): PenguShortV20AdvanceResult {
    const state = { ...position.shortV20 };
    if (!state.counterwind || state.phase === "RESUMED") return { state };

    if (state.phase === "PROBATION") {
        // V20's sole rule change: VOL_TARGET failures use the restored V11
        // next-H1-open full exit. The current completed H1 confirms the prior
        // failure; this bar's open is the executable exit timestamp/price.
        if (state.sizingState === "VOL_TARGET" && state.failureConfirmedTs !== undefined && features.referenceTs > state.failureConfirmedTs) {
            return {
                state,
                action: { kind: "VOL_TARGET_FAILURE_EXIT", referenceTs: features.referenceTs, exitPrice: features.open },
            };
        }

        // CAP/FLOOR retain frozen V18 probation-to-deadline behavior.
        const deadlineTs = position.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * 3_600_000;
        if (features.referenceTs >= deadlineTs) {
            return { state, action: { kind: "DEADLINE_EXIT", referenceTs: features.referenceTs, exitPrice: features.open } };
        }
        // Close-confirmed thesis resumption has priority over any later
        // probation action and does not create an extra leg or order.
        if (features.close < state.lowWater && features.close < features.ema72 && features.btcReturn24h >= 0) {
            state.phase = "RESUMED";
            state.thesisResumedTs = features.referenceTs;
            return { state, action: { kind: "THESIS_RESUMED", referenceTs: features.referenceTs } };
        }
        return { state };
    }

    // This is the exact V18 progression/failure sequence inherited by V20.
    state.lowWater = Math.min(state.lowWater, features.low);
    const unit = Math.min(state.entryAtr24Ratio, PENGU_DUAL_LS_V2.short.hardStopPct / 2);
    const arm = unit;
    const goal = Math.min(2 * unit, PENGU_DUAL_LS_V2.short.hardStopPct);
    const failLevel = unit / 2;
    const mfe = 1 - state.lowWater / position.entryPrice;
    if (!state.armed && !state.progressed && mfe >= arm) state.armed = true;
    if (state.armed && mfe >= goal) {
        state.progressed = true;
        state.armed = false;
    }
    if (state.armed && !state.progressed && (1 - features.close / position.entryPrice) <= failLevel) {
        state.phase = "PROBATION";
        state.failureConfirmedTs = features.referenceTs;
    }
    return { state };
}
