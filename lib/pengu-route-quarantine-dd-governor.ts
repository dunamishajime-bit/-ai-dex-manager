export const PENGU_ROUTE_QUARANTINE_HOURS = 60 as const;
export const PENGU_REALIZED_DD_THRESHOLD = 0.17 as const;
export const PENGU_REALIZED_DD_HOLD_HOURS = 72 as const;

const HOUR_MS = 3_600_000;

export type PenguRiskRoute = "BASE_V64_LONG" | "SHORT_V20" | "RECOVERY_V8";

export interface PenguRiskOverlayState {
    version: 1;
    routeQuarantineUntilTs: Partial<Record<PenguRiskRoute, number>>;
    realizedEquity: number;
    realizedPeak: number;
    realizedDrawdown: number;
    globalEntryHoldUntilTs: number;
    lastClosedTradeTs?: number;
    lastHardStopTs?: Partial<Record<PenguRiskRoute, number>>;
}

export type PenguRiskGateDecision =
    | { allowed: true; reason: "PENGU_RISK_OVERLAY_CLEAR" }
    | { allowed: false; reason: "PENGU_ROUTE_QUARANTINED" | "PENGU_REALIZED_DD_HOLD" | "PENGU_RISK_OVERLAY_INVALID"; untilTs?: number };

export function createPenguRiskOverlayState(): PenguRiskOverlayState {
    return {
        version: 1,
        routeQuarantineUntilTs: {},
        realizedEquity: 1,
        realizedPeak: 1,
        realizedDrawdown: 0,
        globalEntryHoldUntilTs: 0,
    };
}

function finiteNonNegative(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isValidPenguRiskOverlayState(value: unknown): value is PenguRiskOverlayState {
    if (!value || typeof value !== "object") return false;
    const raw = value as Partial<PenguRiskOverlayState>;
    const realizedEquity = raw.realizedEquity;
    const realizedPeak = raw.realizedPeak;
    if (raw.version !== 1
        || typeof realizedEquity !== "number" || !Number.isFinite(realizedEquity) || realizedEquity <= 0
        || typeof realizedPeak !== "number" || !Number.isFinite(realizedPeak) || realizedPeak < realizedEquity
        || !finiteNonNegative(raw.globalEntryHoldUntilTs)) return false;
    if (typeof raw.realizedDrawdown !== "number" || !Number.isFinite(raw.realizedDrawdown) || raw.realizedDrawdown < -1 || raw.realizedDrawdown > 0) return false;
    const routeMap = raw.routeQuarantineUntilTs;
    if (!routeMap || typeof routeMap !== "object") return false;
    for (const value of Object.values(routeMap)) if (!finiteNonNegative(value)) return false;
    if (raw.lastHardStopTs !== undefined) {
        if (!raw.lastHardStopTs || typeof raw.lastHardStopTs !== "object") return false;
        for (const value of Object.values(raw.lastHardStopTs)) if (!finiteNonNegative(value)) return false;
    }
    if (raw.lastClosedTradeTs !== undefined && !finiteNonNegative(raw.lastClosedTradeTs)) return false;
    return true;
}

export function normalizePenguRiskOverlayState(value: unknown): PenguRiskOverlayState {
    if (value === undefined) return createPenguRiskOverlayState();
    if (!isValidPenguRiskOverlayState(value)) throw new Error("PENGU_RISK_OVERLAY_INVALID");
    const raw = value as PenguRiskOverlayState;
    return {
        version: 1,
        routeQuarantineUntilTs: { ...raw.routeQuarantineUntilTs },
        realizedEquity: raw.realizedEquity,
        realizedPeak: raw.realizedPeak,
        realizedDrawdown: raw.realizedDrawdown,
        globalEntryHoldUntilTs: raw.globalEntryHoldUntilTs,
        lastClosedTradeTs: raw.lastClosedTradeTs,
        lastHardStopTs: raw.lastHardStopTs ? { ...raw.lastHardStopTs } : undefined,
    };
}

export function recordPenguHardStop(state: PenguRiskOverlayState, route: PenguRiskRoute, closedAtTs: number): PenguRiskOverlayState {
    if (!isValidPenguRiskOverlayState(state) || !finiteNonNegative(closedAtTs)) return state;
    const untilTs = closedAtTs + PENGU_ROUTE_QUARANTINE_HOURS * HOUR_MS;
    return {
        ...state,
        routeQuarantineUntilTs: {
            ...state.routeQuarantineUntilTs,
            [route]: Math.max(state.routeQuarantineUntilTs[route] || 0, untilTs),
        },
        lastHardStopTs: { ...(state.lastHardStopTs || {}), [route]: closedAtTs },
    };
}

export function recordPenguClosedTrade(state: PenguRiskOverlayState, _route: PenguRiskRoute, accountReturn: number, closedAtTs: number): PenguRiskOverlayState {
    if (!isValidPenguRiskOverlayState(state) || !Number.isFinite(accountReturn) || !finiteNonNegative(closedAtTs)) return state;
    const realizedEquity = state.realizedEquity * (1 + accountReturn);
    if (!(realizedEquity > 0) || !Number.isFinite(realizedEquity)) return state;
    const realizedPeak = Math.max(state.realizedPeak, realizedEquity);
    const realizedDrawdown = realizedEquity / realizedPeak - 1;
    const globalEntryHoldUntilTs = realizedDrawdown <= -PENGU_REALIZED_DD_THRESHOLD
        ? Math.max(state.globalEntryHoldUntilTs, closedAtTs + PENGU_REALIZED_DD_HOLD_HOURS * HOUR_MS)
        : state.globalEntryHoldUntilTs;
    return {
        ...state,
        realizedEquity,
        realizedPeak,
        realizedDrawdown,
        globalEntryHoldUntilTs,
        lastClosedTradeTs: closedAtTs,
    };
}

export function evaluatePenguNewEntryGate(state: PenguRiskOverlayState, route: PenguRiskRoute, nowTs: number): PenguRiskGateDecision {
    if (!isValidPenguRiskOverlayState(state) || !finiteNonNegative(nowTs)) return { allowed: false, reason: "PENGU_RISK_OVERLAY_INVALID" };
    const routeUntil = state.routeQuarantineUntilTs[route] || 0;
    if (nowTs < routeUntil) return { allowed: false, reason: "PENGU_ROUTE_QUARANTINED", untilTs: routeUntil };
    if (nowTs < state.globalEntryHoldUntilTs) return { allowed: false, reason: "PENGU_REALIZED_DD_HOLD", untilTs: state.globalEntryHoldUntilTs };
    return { allowed: true, reason: "PENGU_RISK_OVERLAY_CLEAR" };
}

export function routeForPenguEntryVersion(entryVersion: "LONG_V2_FINAL" | "SHORT_V20" | "RECOVERY_V8" | undefined): PenguRiskRoute {
    if (entryVersion === "SHORT_V20") return "SHORT_V20";
    if (entryVersion === "RECOVERY_V8") return "RECOVERY_V8";
    return "BASE_V64_LONG";
}
