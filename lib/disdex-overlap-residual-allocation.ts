/**
 * Score-based residual GROSS allocation is an overlap-only optimization.
 * A newly approved order normally retains its strict native planner size.
 * Only a verified, fresh, already-open position from a DIFFERENT strategy
 * enables score-based sharing of the remaining capacity.
 *
 * No venue positions can be inferred from pending orders, reservation intents,
 * candidates in this cycle or another candidate's planner snapshot.
 */
import {
    allocateDynamicEntryGross,
    type DynamicEntryAllocation,
    type DynamicEntryAllocationResult,
    type DynamicEntryCandidate,
    type DynamicAssetClass,
} from "./disdex-dynamic-entry-allocation";
import type { StrictEntryApproval } from "./disdex-strict-entry-approval";

const EPS = 1e-12;

export type OverlapAllocationInput = {
    candidates: readonly DynamicEntryCandidate[];
    strictPlannerApprovals: readonly StrictEntryApproval[];
    cryptoGrossAvailable: number;
    stockGrossAvailable: number;
    totalGrossAvailable: number;
    equityUsd: number;
    strategyGrossAvailable: Readonly<Record<string, number>>;
    positionGrossAvailable: Readonly<Record<string, number>>;
    now: number;
    snapshotMaxAgeMs: number;
};

function positionKey(row: Pick<DynamicEntryCandidate, "strategy" | "symbol" | "side">) {
    return row.strategy + "|" + row.symbol.toUpperCase() + "|" + row.side;
}

/** A pending reservation or another same-cycle signal is never a held position. */
export function hasFreshOtherStrategyHolding(
    candidate: Pick<DynamicEntryCandidate, "strategy">,
    approval: StrictEntryApproval,
    now: number,
    maxAgeMs: number,
): boolean {
    const snapshot = approval.snapshot;
    if (!snapshot || !Number.isFinite(snapshot.capturedAt)
        || snapshot.capturedAt > now || now - snapshot.capturedAt > maxAgeMs
        || !Array.isArray(snapshot.positions)) return false;

    return snapshot.positions.some((position) => Boolean(
        position && typeof position.strategy === "string"
        && position.strategy.trim().length > 0
        && position.strategy !== candidate.strategy
        && typeof position.id === "string" && position.id.trim().length > 0
        && Number.isFinite(position.quantity) && Math.abs(position.quantity) > EPS
        && Number.isFinite(position.updatedAt)
        && position.updatedAt > 0
        && position.updatedAt <= snapshot.capturedAt
        // The position may have been held for days; only the account snapshot
        // (not its original position-update timestamp) must be recent.
        && Array.isArray(approval.plan.activePositions)
        && approval.plan.activePositions.some((held) =>
            held.id === position.id && held.strategy === position.strategy
            && held.symbol.toUpperCase() === position.symbol.toUpperCase()
            && held.side === position.side
            && Number.isFinite(held.quantity) && Math.abs(held.quantity) > EPS),
    ));
}

function hasComparableScore(candidate: DynamicEntryCandidate) {
    if (!Number.isFinite(candidate.marketFitScore)
        || candidate.marketFitScore < 0 || candidate.marketFitScore > 100) return false;
    // Archived unitless V12 values are not comparable to 0..100 signals.
    if (candidate.scoreSource === "V12_COMPLETED_SIGNAL_SCORE_V1" && candidate.marketFitScore <= 4) return false;
    return true;
}

/**
 * Preserve original native planner approved GROSS for non-overlap candidates.
 * Evaluate scores ONLY for candidates that overlap a different held strategy.
 * All allocations remain capped by the strict planner approved gross and
 * remaining strategy/position/class/account headroom.
 */
export function allocateOverlapConditionalGross(input: OverlapAllocationInput): DynamicEntryAllocationResult {
    const byId = new Map(input.strictPlannerApprovals.map((approval) => [approval.candidateId, approval]));
    const scored: DynamicEntryCandidate[] = [];
    const native: DynamicEntryCandidate[] = [];
    const rejected: DynamicEntryAllocationResult["rejected"] = [];
    const stratRemaining: Record<string, number> = { ...input.strategyGrossAvailable };
    const positionRemaining: Record<string, number> = { ...input.positionGrossAvailable };
    const classRemaining: Record<DynamicAssetClass, number> = {
        CRYPTO: Math.max(0, input.cryptoGrossAvailable),
        STOCK: Math.max(0, input.stockGrossAvailable),
    };
    let totalRemaining = Math.max(0, input.totalGrossAvailable);

    if (!Number.isFinite(input.now) || input.now <= 0
        || !Number.isFinite(input.snapshotMaxAgeMs) || input.snapshotMaxAgeMs <= 0
        || !Number.isFinite(input.equityUsd) || input.equityUsd <= 0) {
        throw new Error("DYNAMIC_ENTRY_OVERLAP_CONTEXT_INVALID");
    }
    if (byId.size !== input.strictPlannerApprovals.length
        || input.candidates.some((candidate) => !byId.has(candidate.id))) {
        throw new Error("DYNAMIC_ENTRY_OVERLAP_NATIVE_APPROVAL_MISSING");
    }

    for (const candidate of input.candidates) {
        const approval = byId.get(candidate.id)!;
        if (hasFreshOtherStrategyHolding(candidate, approval, input.now, input.snapshotMaxAgeMs)
            && hasComparableScore(candidate)) scored.push(candidate);
        else native.push(candidate);
    }
    // The strict planner order, never the score order, determines normal entry.
    const byNativeOrder = new Map(input.strictPlannerApprovals.map((approval, i) => [approval.candidateId, i]));
    native.sort((a, b) => byNativeOrder.get(a.id)! - byNativeOrder.get(b.id)!);

    const allocations: DynamicEntryAllocation[] = [];
    for (const candidate of native) {
        const wanted = candidate.targetGross;
        const minimum = Math.max(candidate.minGross, (candidate.minNotionalUsd ?? 0) / input.equityUsd);
        const room = Math.min(
            totalRemaining,
            classRemaining[candidate.assetClass],
            stratRemaining[candidate.strategy] ?? 0,
            positionRemaining[positionKey(candidate)] ?? 0,
            candidate.maxGross,
        );
        // The native path can shrink a strict-approved lot to a hard residual
        // ceiling, just as the existing bounded registry did; it never ranks
        // or reprioritizes the candidate using a score.
        const approved = Math.min(wanted, room);
        if (!Number.isFinite(approved) || approved + EPS < minimum) {
            rejected.push({ id: candidate.id, reason: "NATIVE_APPROVED_GROSS_UNAVAILABLE" });
            continue;
        }
        allocations.push({ ...candidate, btPriorBonus: 0, finalScore: 0, allocatedGross: approved });
        totalRemaining = Math.max(0, totalRemaining - approved);
        classRemaining[candidate.assetClass] = Math.max(0, classRemaining[candidate.assetClass] - approved);
        stratRemaining[candidate.strategy] = Math.max(0, (stratRemaining[candidate.strategy] ?? 0) - approved);
        const key = positionKey(candidate);
        positionRemaining[key] = Math.max(0, (positionRemaining[key] ?? 0) - approved);
    }
    if (scored.length) {
        // Cap same-position competing scored candidates by running strict checks
        // after the shared weighted allocation. Native approvals remain hard max.
        const scoredInput = scored.map((candidate) => ({
            ...candidate,
            maxGross: Math.min(candidate.maxGross, positionRemaining[positionKey(candidate)] ?? 0),
        }));
        const result = allocateDynamicEntryGross({
            candidates: scoredInput,
            cryptoGrossAvailable: classRemaining.CRYPTO,
            stockGrossAvailable: classRemaining.STOCK,
            totalGrossAvailable: totalRemaining,
            strategyGrossAvailable: stratRemaining,
            positionGrossAvailable: positionRemaining,
            equityUsd: input.equityUsd,
        });
        rejected.push(...result.rejected);
        for (const allocation of result.allocations) {
            const key = positionKey(allocation);
            const available = Math.min(
                allocation.allocatedGross,
                stratRemaining[allocation.strategy] ?? 0,
                positionRemaining[key] ?? 0,
                classRemaining[allocation.assetClass],
                totalRemaining,
            );
            const minimum = Math.max(allocation.minGross, (allocation.minNotionalUsd ?? 0) / input.equityUsd);
            if (available + EPS < minimum) {
                rejected.push({ id: allocation.id, reason: "DYNAMIC_OVERLAP_GROSS_BELOW_MINIMUM" });
                continue;
            }
            allocations.push({ ...allocation, allocatedGross: available });
            totalRemaining = Math.max(0, totalRemaining - available);
            classRemaining[allocation.assetClass] = Math.max(0, classRemaining[allocation.assetClass] - available);
            stratRemaining[allocation.strategy] = Math.max(0, (stratRemaining[allocation.strategy] ?? 0) - available);
            positionRemaining[key] = Math.max(0, (positionRemaining[key] ?? 0) - available);
        }
    }

    rejected.sort((a, b) => a.id.localeCompare(b.id));
    return {
        allocations,
        rejected,
        residual: {
            cryptoGross: classRemaining.CRYPTO,
            stockGross: classRemaining.STOCK,
            totalGross: totalRemaining,
        },
    };
}
