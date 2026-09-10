import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { STRICT_BT33404708902 } from "@/config/disdexStrictBt33404708902Runtime";

export const V12_TOP2_RESIDUAL_POLICY = Object.freeze({
    aggregateEntryGrossCap: V12_X1_ALL.aggregateEntryGrossCap,
    perPositionEntryGrossCap: V12_X1_ALL.perPositionEntryGrossCap,
    maximumPositions: V12_X1_ALL.maximumPositions,
    sharedCryptoGrossCap: STRICT_BT33404708902.cryptoGrossCap,
    totalPortfolioGrossCap: STRICT_BT33404708902.totalGrossCap,
});

export interface V12GrossSnapshot { v12Gross: number; cryptoGross: number; stockGross: number; totalGross: number; }
export interface V12ResidualDecision {
    acceptedGross: number;
    capacity: { v12Residual: number; cryptoResidual: number; totalResidual: number; positionResidual: number };
    reason?: "NO_RESIDUAL" | "PER_POSITION_CAP" | "MAX_POSITIONS";
}

function nonNegative(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function v12ResidualCapacity(snapshot: V12GrossSnapshot, activeV12Positions = 0) {
    return {
        v12Residual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.aggregateEntryGrossCap - nonNegative(snapshot.v12Gross)),
        cryptoResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.sharedCryptoGrossCap - nonNegative(snapshot.cryptoGross)),
        totalResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.totalPortfolioGrossCap - nonNegative(snapshot.totalGross)),
        positionResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.maximumPositions - Math.max(0, Math.floor(activeV12Positions))),
    };
}

export function decideV12ResidualEntry(requestedGross: number, snapshot: V12GrossSnapshot, activeV12Positions = 0): V12ResidualDecision {
    const capacity = v12ResidualCapacity(snapshot, activeV12Positions);
    if (capacity.positionResidual <= 0) return { acceptedGross: 0, capacity, reason: "MAX_POSITIONS" };
    const requested = nonNegative(requestedGross);
    const acceptedGross = Math.min(requested, V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap, capacity.v12Residual, capacity.cryptoResidual, capacity.totalResidual);
    if (!(acceptedGross > 0)) return { acceptedGross: 0, capacity, reason: "NO_RESIDUAL" };
    return { acceptedGross, capacity, reason: requested > V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap ? "PER_POSITION_CAP" : undefined };
}
