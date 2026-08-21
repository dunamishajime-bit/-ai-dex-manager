/**
 * V12 Top2 residual sizing contract.
 *
 * This module is intentionally side-effect free.  It only clips a V12
 * entry against the fresh account snapshot supplied by the caller; it never
 * preempts an existing PENGU or stock position and it never treats MTM drift
 * as an entry-cap breach.
 */

export const V12_TOP2_RESIDUAL_POLICY = Object.freeze({
    aggregateEntryGrossCap: 1.5,
    perPositionEntryGrossCap: 1.0,
    maximumPositions: 2,
    sharedCryptoGrossCap: 1.5,
    totalPortfolioGrossCap: 2.5,
});

export interface V12GrossSnapshot {
    v12Gross: number;
    penguGross: number;
    cryptoGross: number;
    stockGross: number;
    totalGross: number;
}

export interface V12ResidualCapacity {
    v12Residual: number;
    cryptoResidual: number;
    totalResidual: number;
    positionResidual: number;
}

export interface V12ResidualDecision {
    acceptedGross: number;
    capacity: V12ResidualCapacity;
    reason?: "NO_RESIDUAL" | "PER_POSITION_CAP" | "MAX_POSITIONS";
}

function nonNegative(value: unknown) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Calculate entry capacity from a single fresh portfolio snapshot.
 * `cryptoGross` is the combined V12 + PENGU gross, while `v12Gross` is the
 * V12-only entry gross.  The three residuals deliberately remain separate so
 * tests and audit logs can explain which cap blocked an order.
 */
export function v12ResidualCapacity(snapshot: V12GrossSnapshot, activeV12Positions = 0): V12ResidualCapacity {
    const v12Gross = nonNegative(snapshot.v12Gross);
    const cryptoGross = nonNegative(snapshot.cryptoGross);
    const totalGross = nonNegative(snapshot.totalGross);
    return {
        v12Residual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.aggregateEntryGrossCap - v12Gross),
        cryptoResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.sharedCryptoGrossCap - cryptoGross),
        totalResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.totalPortfolioGrossCap - totalGross),
        positionResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.maximumPositions - Math.max(0, Math.floor(activeV12Positions))),
    };
}

export function decideV12ResidualEntry(
    requestedGross: number,
    snapshot: V12GrossSnapshot,
    activeV12Positions = 0,
): V12ResidualDecision {
    const capacity = v12ResidualCapacity(snapshot, activeV12Positions);
    if (capacity.positionResidual <= 0) return { acceptedGross: 0, capacity, reason: "MAX_POSITIONS" };
    const requested = nonNegative(requestedGross);
    const acceptedGross = Math.min(
        requested,
        V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap,
        capacity.v12Residual,
        capacity.cryptoResidual,
        capacity.totalResidual,
    );
    if (!(acceptedGross > 0)) return { acceptedGross: 0, capacity, reason: "NO_RESIDUAL" };
    const clippedByPosition = requested > V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap + 1e-12;
    return { acceptedGross, capacity, reason: clippedByPosition ? "PER_POSITION_CAP" : undefined };
}
