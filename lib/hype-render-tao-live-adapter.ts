import {
  evaluateAdoptedHypeLongEntry,
  evaluateAdoptedHypeLongExit as evaluatePolicyHypeLongExit,
  evaluateAdoptedRenderIdleShortEntry,
  evaluateAdoptedRenderShortProfitArm as evaluatePolicyRenderShortProfitArm,
  evaluateAdoptedTaoIdleShortEntry,
  type AdoptedExitDecision,
  type AdoptedGateResult,
  type ClosedFiveMinuteClose,
} from "./hype-render-tao-adopted-policy";

export type AdoptedIdleShortSymbol = "TAOUSDT" | "RENDERUSDT";

export type LiveGateResult = AdoptedGateResult & Readonly<{
  side: "LONG" | "SHORT" | "FLAT";
}>;

/**
 * Apply the adopted HYPE gate after the native HYPE signal has passed.
 * Native rejection is terminal; this adapter never creates a signal by itself.
 */
export function gateAdoptedHypeLongEntry(input: {
  nativeAccepted: boolean;
  decisionTs: number;
  btc: readonly ClosedFiveMinuteClose[];
  hype: readonly ClosedFiveMinuteClose[];
}): LiveGateResult {
  if (!input.nativeAccepted) {
    return { accepted: false, side: "FLAT", reason: "HYPE_NATIVE_ENTRY_NOT_ACCEPTED" };
  }
  return { ...evaluateAdoptedHypeLongEntry(input), side: "LONG" };
}

/**
 * Apply only the adopted Idle SHORT additions.  The generic Idle candidate
 * and route decision remain mandatory, and a LONG candidate can never be
 * converted into a SHORT by this function.
 */
export function gateAdoptedIdleShortEntry(input: {
  symbol: AdoptedIdleShortSymbol;
  nativeAccepted: boolean;
  nativeSide: "LONG" | "SHORT" | "FLAT";
  decisionTs: number;
  tao?: readonly ClosedFiveMinuteClose[];
  btc?: readonly ClosedFiveMinuteClose[];
  render?: readonly ClosedFiveMinuteClose[];
}): LiveGateResult {
  if (!input.nativeAccepted) return { accepted: false, side: "FLAT", reason: "IDLE_NATIVE_ENTRY_NOT_ACCEPTED" };
  if (input.nativeSide !== "SHORT") return { accepted: false, side: "FLAT", reason: "IDLE_ADOPTED_SHORT_SIDE_REQUIRED" };
  const result = input.symbol === "TAOUSDT"
    ? evaluateAdoptedTaoIdleShortEntry({ decisionTs: input.decisionTs, tao: input.tao || [] })
    : evaluateAdoptedRenderIdleShortEntry({ decisionTs: input.decisionTs, btc: input.btc || [], render: input.render || [] });
  return { ...result, side: result.accepted ? "SHORT" : "FLAT" };
}

export function evaluateAdoptedHypeLongExit(input: Parameters<typeof evaluatePolicyHypeLongExit>[0]): AdoptedExitDecision {
  return evaluatePolicyHypeLongExit(input);
}

export function evaluateAdoptedRenderShortProfitArm(input: Parameters<typeof evaluatePolicyRenderShortProfitArm>[0]): AdoptedExitDecision {
  return evaluatePolicyRenderShortProfitArm(input);
}

/** For SHORT positions the lower trigger is always the more protective one. */
export function chooseMoreProtectiveRenderShortStop(existing: number | undefined, candidate: number): number {
  if (!Number.isFinite(candidate) || candidate <= 0) throw new Error("RENDER_STOP_CANDIDATE_INVALID");
  if (existing === undefined) return candidate;
  if (!Number.isFinite(existing) || existing <= 0) throw new Error("RENDER_STOP_EXISTING_INVALID");
  return Math.min(existing, candidate);
}
