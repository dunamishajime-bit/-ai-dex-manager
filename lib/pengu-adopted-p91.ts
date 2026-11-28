import { H, M5, p91, type P91Input } from "./stable4-research-decision-observation";
import type { PenguDualLsV2Signal } from "./pengu-dual-ls-v2";

/** Adopted SHORT_V20 replacement, pre-live candidate selection only.
 * The input must come from the source-SHA checked Binance/Aster feed.
 * Existing position exits and non-V20 routes are not rewritten.
 */
export function selectAdoptedP91Candidate(
    base: PenguDualLsV2Signal, input: P91Input | undefined, asof: number,
    hasPosition: boolean, mode: "SHADOW" | "LIVE",
): PenguDualLsV2Signal {
    if (hasPosition || base.exit || base.updatedPosition) return base;
    const legacyShort = base.entryVersion === "SHORT_V20" || base.side === -1;
    const blocked = (reason: string): PenguDualLsV2Signal => ({
        ...base, side: 0, targetGross: 0, entryTs: undefined,
        entryVersion: undefined, reason,
    });
    const fresh = input && input.asof === asof &&
        Number.isSafeInteger(asof) && Number.isSafeInteger(input.signalTs) &&
        input.signalTs % H === 0 && asof >= input.signalTs + M5 &&
        asof <= input.signalTs + 15 * 60000;
    const decision = fresh ? p91(input!) : undefined;
    if (!decision?.pass) return legacyShort
        ? blocked("P91_LEGACY_V20_REPLACED_NO_CONFIRMED_SIGNAL") : base;
    // No invented precedence for an independently occurring Long or Recovery route.
    if (base.side === 1) return base;
    if (base.diagnostics.cooldownBlocked) return blocked("P91_COOLDOWN");
    if (!base.features || base.features.referenceTs !== input!.signalTs - H ||
        base.referenceTs !== input!.signalTs - H)
        return blocked("P91_ASTER_NATIVE_EXIT_SEED_UNVERIFIED");
    if (mode !== "SHADOW") return blocked("P91_EXACT_SOURCE_EXIT_CERT_REQUIRED");
    return {
        ...base, side: -1, targetGross: decision.gross,
        entryTs: input!.signalTs + M5, entryVersion: "SHORT_V20",
        reason: "P91_BINANCE_H1_ASTER_CLOSED_M5_SHADOW_CANDIDATE",
        diagnostics: { ...base.diagnostics, shortEligible: true, edgeTriggered: true },
    };
}
