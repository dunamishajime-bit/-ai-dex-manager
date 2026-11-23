import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "@/config/integratedProductionRiskPolicy";

export const V12_TOP2_RESIDUAL_POLICY = Object.freeze({
    baseAggregateGrossCap: V12_X1_ALL.aggregateEntryGrossCap,
    dynamicAggregateGrossCap: V12_X1_ALL.dynamicResidualAggregateGrossCap,
    perPositionEntryGrossCap: V12_X1_ALL.perPositionEntryGrossCap,
    maximumPositions: V12_X1_ALL.maximumPositions,
    sharedCryptoGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
    totalPortfolioGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
});

export interface V12GrossSnapshot {
    /** Current total V12 venue gross (base + dynamic). */
    v12Gross: number;
    /** Durable Base component. If omitted, all current V12 gross is treated as Base. */
    v12BaseGross?: number;
    /** Durable Dynamic component. Used for observability/invariant checks. */
    v12DynamicGross?: number;
    cryptoGross: number;
    stockGross: number;
    totalGross: number;
}

export interface V12ResidualDecision {
    acceptedGross: number;
    baseAcceptedGross: number;
    dynamicAcceptedGross: number;
    capacity: {
        baseV12Residual: number;
        dynamicV12Residual: number;
        cryptoResidual: number;
        totalResidual: number;
        positionResidual: number;
    };
    reason?: "NO_RESIDUAL" | "PER_POSITION_CAP" | "MAX_POSITIONS";
}

export interface V12EntryGrossReservationInput {
    snapshot: V12GrossSnapshot;
    /** Exposure already represented by a durable pending entry. */
    pendingBaseGross?: number;
    pendingDynamicGross?: number;
    /** Exposure reserved by another execution phase. Treated as Base conservatively. */
    reservedGross?: number;
    candidateBaseGross: number;
    candidateDynamicGross: number;
    /** Worst-case post-normalization/post-slippage gross, not the requested gross. */
    candidateWorstCaseGross: number;
}

export interface V12EntryGrossReservationResult {
    ok: boolean;
    orderAllowed: boolean;
    reason?:
        | "V12_POSITION_GROSS_OVER_CAP"
        | "V12_BASE_AGGREGATE_GROSS_OVER_CAP"
        | "V12_AGGREGATE_GROSS_OVER_CAP"
        | "V12_CRYPTO_GROSS_OVER_CAP"
        | "V12_TOTAL_GROSS_OVER_CAP";
    projectedBaseGross: number;
    projectedDynamicGross: number;
    projectedV12Gross: number;
    projectedCryptoGross: number;
    projectedTotalGross: number;
    candidateWorstCaseGross: number;
}

function nonNegative(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function components(snapshot: V12GrossSnapshot) {
    const total = nonNegative(snapshot.v12Gross);
    const explicitDynamic = snapshot.v12DynamicGross === undefined ? undefined : nonNegative(snapshot.v12DynamicGross);
    const explicitBase = snapshot.v12BaseGross === undefined ? undefined : nonNegative(snapshot.v12BaseGross);
    const dynamic = explicitDynamic ?? Math.max(0, total - (explicitBase ?? total));
    const base = explicitBase ?? Math.max(0, total - dynamic);
    if (base + dynamic > total + 1e-6 || base > V12_TOP2_RESIDUAL_POLICY.baseAggregateGrossCap + 1e-6 || total > V12_TOP2_RESIDUAL_POLICY.dynamicAggregateGrossCap + 1e-6) {
        throw new Error("V12_DYNAMIC_GROSS_SNAPSHOT_INVALID");
    }
    return { base, dynamic, total };
}

function requiredFiniteNonNegative(name: string, value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`V12_GROSS_RESERVATION_${name}_INVALID`);
    return number;
}

/**
 * Final exposure admission check immediately before an exposure order.
 *
 * The regular residual planner is intentionally kept as the sizing policy. This
 * function is a second, conservative reservation check over the actual venue
 * quantity and worst-case executable price. It prevents a fill/slippage/rounding
 * change from being discovered only after the order has already increased risk.
 */
export function validateV12EntryGrossReservation(input: V12EntryGrossReservationInput): V12EntryGrossReservationResult {
    const { base, dynamic, total } = components(input.snapshot);
    const pendingBase = requiredFiniteNonNegative("PENDING_BASE", input.pendingBaseGross ?? 0);
    const pendingDynamic = requiredFiniteNonNegative("PENDING_DYNAMIC", input.pendingDynamicGross ?? 0);
    const reserved = requiredFiniteNonNegative("RESERVED", input.reservedGross ?? 0);
    const candidateBase = requiredFiniteNonNegative("CANDIDATE_BASE", input.candidateBaseGross);
    const candidateDynamic = requiredFiniteNonNegative("CANDIDATE_DYNAMIC", input.candidateDynamicGross);
    const candidateNominal = candidateBase + candidateDynamic;
    const candidateWorstCase = Math.max(
        candidateNominal,
        requiredFiniteNonNegative("CANDIDATE_WORST_CASE", input.candidateWorstCaseGross),
    );
    const candidateBaseRatio = candidateNominal > 0 ? candidateBase / candidateNominal : 1;
    const worstCaseBase = candidateWorstCase * candidateBaseRatio;
    const worstCaseDynamic = candidateWorstCase - worstCaseBase;
    const projectedBaseGross = base + pendingBase + reserved + worstCaseBase;
    const projectedDynamicGross = dynamic + pendingDynamic + worstCaseDynamic;
    const projectedV12Gross = projectedBaseGross + projectedDynamicGross;
    const projectedCryptoGross = Math.max(0, Number(input.snapshot.cryptoGross)) + pendingBase + pendingDynamic + reserved + candidateWorstCase;
    const projectedTotalGross = Math.max(0, Number(input.snapshot.totalGross)) + pendingBase + pendingDynamic + reserved + candidateWorstCase;

    let reason: V12EntryGrossReservationResult["reason"];
    if (candidateWorstCase > V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap + 1e-9) reason = "V12_POSITION_GROSS_OVER_CAP";
    else if (projectedBaseGross > V12_TOP2_RESIDUAL_POLICY.baseAggregateGrossCap + 1e-9) reason = "V12_BASE_AGGREGATE_GROSS_OVER_CAP";
    else if (projectedV12Gross > V12_TOP2_RESIDUAL_POLICY.dynamicAggregateGrossCap + 1e-9) reason = "V12_AGGREGATE_GROSS_OVER_CAP";
    else if (projectedCryptoGross > V12_TOP2_RESIDUAL_POLICY.sharedCryptoGrossCap + 1e-9) reason = "V12_CRYPTO_GROSS_OVER_CAP";
    else if (projectedTotalGross > V12_TOP2_RESIDUAL_POLICY.totalPortfolioGrossCap + 1e-9) reason = "V12_TOTAL_GROSS_OVER_CAP";

    return {
        ok: !reason,
        orderAllowed: !reason,
        reason,
        projectedBaseGross,
        projectedDynamicGross,
        projectedV12Gross,
        projectedCryptoGross,
        projectedTotalGross,
        candidateWorstCaseGross: candidateWorstCase,
    };
}

export function v12ResidualCapacity(snapshot: V12GrossSnapshot, activeV12Positions = 0) {
    const { base, total } = components(snapshot);
    return {
        baseV12Residual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.baseAggregateGrossCap - base),
        dynamicV12Residual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.dynamicAggregateGrossCap - total),
        cryptoResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.sharedCryptoGrossCap - nonNegative(snapshot.cryptoGross)),
        totalResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.totalPortfolioGrossCap - nonNegative(snapshot.totalGross)),
        positionResidual: Math.max(0, V12_TOP2_RESIDUAL_POLICY.maximumPositions - Math.max(0, Math.floor(activeV12Positions))),
    };
}

/**
 * Admit the existing V12 request without changing the signal/risk request.
 * Base capacity is consumed first up to the configured base aggregate cap.
 * Any remaining part of the same request may use residual capacity as
 * lower-priority Dynamic notional, with total V12 bounded by the configured
 * dynamic aggregate cap.
 */
export function decideV12ResidualEntry(requestedGross: number, snapshot: V12GrossSnapshot, activeV12Positions = 0): V12ResidualDecision {
    const capacity = v12ResidualCapacity(snapshot, activeV12Positions);
    if (capacity.positionResidual <= 0) {
        return { acceptedGross: 0, baseAcceptedGross: 0, dynamicAcceptedGross: 0, capacity, reason: "MAX_POSITIONS" };
    }

    const requested = Math.min(nonNegative(requestedGross), V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap);
    const sharedResidual = Math.min(capacity.cryptoResidual, capacity.totalResidual);
    const allocatableGross = Math.min(requested, sharedResidual, capacity.dynamicV12Residual);
    const baseAcceptedGross = Math.min(allocatableGross, capacity.baseV12Residual);
    const dynamicAcceptedGross = Math.max(0, allocatableGross - baseAcceptedGross);
    const acceptedGross = baseAcceptedGross + dynamicAcceptedGross;

    if (!(acceptedGross > 0)) {
        return { acceptedGross: 0, baseAcceptedGross: 0, dynamicAcceptedGross: 0, capacity, reason: "NO_RESIDUAL" };
    }
    return {
        acceptedGross,
        baseAcceptedGross,
        dynamicAcceptedGross,
        capacity,
        reason: nonNegative(requestedGross) > V12_TOP2_RESIDUAL_POLICY.perPositionEntryGrossCap ? "PER_POSITION_CAP" : undefined,
    };
}
