import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

export const V12_FORMAL_PRIORITY_20261003 = Object.freeze({
    normalRoundTripCostBps: 10,
    rank12DefaultGross: 1.0,
    rank12ReducedGross: 0.50,
    rank12ReducedSymbols: ["DOGE", "DOGEUSDT", "LTC", "LTCUSDT"] as const,
    rank3ResidualGross: 0.50,
    sameSymbolCooldownMs: V12_X1_ALL.timeframeHours * 3_600_000,
    q102V12HandoffFamilies: ["PB", "REV", "HIGH_VOL"] as const,
    q102V12PreemptionRankOrder: [3, 2, 1] as const,
    venueLeverage: 5,
    venueMarginType: "cross" as const,
});

export type Q102V12HandoffFamily = typeof V12_FORMAL_PRIORITY_20261003.q102V12HandoffFamilies[number];

function normalizedSymbol(symbol: string | undefined) {
    return String(symbol || "").trim().toUpperCase();
}

export function v12FormalTargetGross(input: { symbol?: string; rank?: number }): number {
    if (input.rank === 3) return V12_FORMAL_PRIORITY_20261003.rank3ResidualGross;
    const symbol = normalizedSymbol(input.symbol);
    return (V12_FORMAL_PRIORITY_20261003.rank12ReducedSymbols as readonly string[]).includes(symbol)
        ? V12_FORMAL_PRIORITY_20261003.rank12ReducedGross
        : V12_FORMAL_PRIORITY_20261003.rank12DefaultGross;
}

export function q102MayPreemptV12(family: string | undefined): family is Q102V12HandoffFamily {
    const normalized = String(family || "").trim().toUpperCase();
    return (V12_FORMAL_PRIORITY_20261003.q102V12HandoffFamilies as readonly string[]).includes(normalized);
}

export function v12SymbolCooldownUntil(
    state: { cooldownUntilTs?: number; symbolCooldownUntilTs?: Record<string, number> },
    symbol: string,
): number {
    const normalized = normalizedSymbol(symbol);
    const map = state.symbolCooldownUntilTs || {};
    const exact = Number(map[normalized] || 0);
    if (Number.isFinite(exact) && exact > 0) return exact;
    // Backward compatibility for an already-running state created before the
    // per-symbol cooldown map existed. Once the map is populated, the legacy
    // global field is no longer used for admission.
    if (!Object.keys(map).length) {
        const legacy = Number(state.cooldownUntilTs || 0);
        return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
    }
    return 0;
}

export function setV12SymbolCooldown(
    state: { cooldownUntilTs?: number; symbolCooldownUntilTs?: Record<string, number> },
    symbol: string,
    actualExitTs: number,
) {
    const exitTs = Number(actualExitTs);
    if (!Number.isFinite(exitTs) || exitTs <= 0) throw new Error("V12_ACTUAL_EXIT_TIMESTAMP_REQUIRED");
    const normalized = normalizedSymbol(symbol);
    const until = exitTs + V12_FORMAL_PRIORITY_20261003.sameSymbolCooldownMs;
    const next = { ...(state.symbolCooldownUntilTs || {}) };
    next[normalized] = Math.max(Number(next[normalized] || 0), until);
    state.symbolCooldownUntilTs = next;
    state.cooldownUntilTs = Math.max(0, ...Object.values(next).filter(Number.isFinite));
    return until;
}

export function pruneExpiredV12SymbolCooldowns(
    state: { cooldownUntilTs?: number; symbolCooldownUntilTs?: Record<string, number> },
    nowTs: number,
) {
    const now = Number(nowTs);
    const next: Record<string, number> = {};
    for (const [symbol, raw] of Object.entries(state.symbolCooldownUntilTs || {})) {
        const until = Number(raw);
        if (Number.isFinite(until) && until > now) next[symbol] = until;
    }
    state.symbolCooldownUntilTs = Object.keys(next).length ? next : undefined;
    state.cooldownUntilTs = Object.keys(next).length ? Math.max(...Object.values(next)) : undefined;
}
