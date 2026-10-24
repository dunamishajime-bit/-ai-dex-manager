import { scoreDynamicEntryCandidate, type DynamicBtPriorMetrics, type DynamicEntryCandidate } from "./disdex-dynamic-entry-allocation";
import type { StrictPortfolioIntent, StrictStrategy } from "./disdex-strict-portfolio-planner";

export type LiveEntryApprovalSource = "REGISTRY_ALLOCATION" | "STRICT_PLANNER_APPROVAL" | "V12_RESIDUAL_APPROVAL";

export type LiveEntryCandidate = DynamicEntryCandidate & {
    strategy: StrictStrategy;
    idempotencyKey: string;
    signalTs: number;
    scoreSource: string;
    btPriorVersion?: string;
};

export function liveEntryScore(
    strategy: StrictStrategy,
    diagnostics?: { volumeRatio?: number; return72h?: number; score?: number; rel24?: number; ret12?: number },
): { value: number; source: string } {
    if (strategy === "FET_RESIDUAL" && Number.isFinite(diagnostics?.volumeRatio) && Number.isFinite(diagnostics?.return72h)) {
        return {
            value: Math.max(0, Math.min(100, 50 + 5 * diagnostics!.volumeRatio! + 100 * diagnostics!.return72h!)),
            source: "FET_COMPLETED_BREAKOUT_VOLUME_RETURN_V1",
        };
    }
    if (strategy === "V12" && Number.isFinite(diagnostics?.score)) {
        return { value: Math.max(0, diagnostics!.score!), source: "V12_COMPLETED_SIGNAL_SCORE_V1" };
    }
    if (strategy === "IDLE_PRIORITY_SHORT" && Number.isFinite(diagnostics?.rel24) && Number.isFinite(diagnostics?.ret12)) {
        return { value: Math.round((Math.abs(diagnostics!.rel24!) + Math.abs(diagnostics!.ret12!)) * 10_000) / 100,
            source: "IDLE_COMPLETED_REL24_RET12_V1" };
    }
    return { value: 50, source: "NEUTRAL_NO_COMPARABLE_LIVE_SCORE_V1" };
}

/** Scores are causal signal diagnostics or a named neutral fallback. BT data is optional and must name its frozen version. */
export function buildLiveEntryCandidate(input: {
    idempotencyKey: string;
    strategy: StrictStrategy;
    symbol: string;
    side: "LONG" | "SHORT";
    signalTs: number;
    score: { value: number; source: string };
    targetGross: number;
    minGross: number;
    maxGross: number;
    assetClass?: "CRYPTO" | "STOCK";
    btPrior?: { version: string; metrics: DynamicBtPriorMetrics };
}): LiveEntryCandidate {
    if (!input.idempotencyKey.trim() || !input.symbol.trim() || !input.score.source.trim()
        || !Number.isFinite(input.signalTs) || input.signalTs <= 0
        || !Number.isFinite(input.score.value)
        || !Number.isFinite(input.targetGross) || input.targetGross <= 0
        || !Number.isFinite(input.minGross) || input.minGross <= 0
        || !Number.isFinite(input.maxGross) || input.maxGross < input.minGross
        || (input.btPrior && !input.btPrior.version.trim())) throw new Error("LIVE_ENTRY_CANDIDATE_INVALID");
    return {
        id: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        strategy: input.strategy,
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        assetClass: input.assetClass ?? "CRYPTO",
        signalTs: input.signalTs,
        scoreSource: input.score.source,
        marketFitScore: input.score.value,
        targetGross: input.targetGross,
        minGross: input.minGross,
        maxGross: input.maxGross,
        ...(input.btPrior ? { btPriorVersion: input.btPrior.version, btPrior: input.btPrior.metrics } : {}),
    };
}

export function strictIntentForLiveCandidate(candidate: LiveEntryCandidate, equityUsd: number): StrictPortfolioIntent & LiveEntryCandidate {
    if (!Number.isFinite(equityUsd) || equityUsd <= 0) throw new Error("LIVE_ENTRY_EQUITY_INVALID");
    return {
        ...candidate,
        gross: candidate.targetGross,
        requestedGross: candidate.targetGross,
        notionalUsd: candidate.targetGross * equityUsd,
        btPriorBonus: scoreDynamicEntryCandidate(candidate).btPriorBonus,
    };
}

/** A planner decision is usable only for the exact candidate and snapshot that produced it. */
export function requireApprovedLiveGross(input: {
    candidate: LiveEntryCandidate;
    approved: Pick<StrictPortfolioIntent, "idempotencyKey" | "strategy" | "symbol" | "side" | "signalTs" | "gross" | "notionalUsd"> | undefined;
    now: number;
    snapshotAt: number;
    approvedAt: number;
    maxAgeMs: number;
}): number {
    const { candidate, approved, now, snapshotAt, approvedAt, maxAgeMs } = input;
    if (!approved) throw new Error("LIVE_ENTRY_APPROVAL_MISSING");
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || !Number.isFinite(now)
        || !Number.isFinite(approvedAt) || approvedAt <= 0 || approvedAt > now || now - approvedAt > maxAgeMs) {
        throw new Error("LIVE_ENTRY_APPROVAL_STALE");
    }
    if (!Number.isFinite(snapshotAt) || snapshotAt <= 0 || snapshotAt > now || now - snapshotAt > maxAgeMs) {
        throw new Error("LIVE_ENTRY_SNAPSHOT_STALE");
    }
    if (snapshotAt > approvedAt || approved.idempotencyKey !== candidate.idempotencyKey
        || approved.strategy !== candidate.strategy || approved.symbol.toUpperCase() !== candidate.symbol
        || approved.side !== candidate.side || approved.signalTs !== candidate.signalTs
        || !Number.isFinite(approved.gross) || !Number.isFinite(approved.notionalUsd) || approved.notionalUsd <= 0
        || approved.gross > candidate.targetGross + 1e-9 || approved.gross > candidate.maxGross + 1e-9) {
        throw new Error("LIVE_ENTRY_APPROVAL_INCOMPATIBLE");
    }
    if (approved.gross + 1e-9 < candidate.minGross) throw new Error("LIVE_ENTRY_APPROVAL_BELOW_MINIMUM");
    return approved.gross;
}

/** Recheck a reserved order's original notional against a later locked venue snapshot. */
export function requireCompatibleExecutionSnapshot(input: {
    approvedGross: number;
    approvalEquity: number;
    currentEquity: number;
    approvedAt: number;
    now: number;
    maxAgeMs: number;
    approvalPositions: ReadonlyArray<{ symbol: string; side: string; quantity: number }>;
    currentPositions: ReadonlyArray<{ symbol: string; side: string; quantity: number }>;
    cryptoGrossAvailable: number;
    totalGrossAvailable: number;
}): number {
    if (!Number.isFinite(input.approvedAt) || input.approvedAt <= 0 || input.approvedAt > input.now
        || !Number.isFinite(input.maxAgeMs) || input.maxAgeMs <= 0
        || input.now - input.approvedAt > input.maxAgeMs) throw new Error("LIVE_ENTRY_APPROVAL_STALE");
    const positions = (rows: typeof input.approvalPositions) => rows
        .filter((row) => Math.abs(row.quantity) > 1e-9)
        .map((row) => `${row.symbol.toUpperCase()}|${row.side}|${row.quantity}`)
        .sort().join(";");
    const approvedNotional = input.approvedGross * input.approvalEquity;
    if (!Number.isFinite(approvedNotional) || approvedNotional <= 0
        || !Number.isFinite(input.currentEquity) || input.currentEquity <= 0
        || input.currentEquity + 1e-9 < input.approvalEquity
        || !Number.isFinite(input.cryptoGrossAvailable) || !Number.isFinite(input.totalGrossAvailable)
        || input.cryptoGrossAvailable + 1e-9 < approvedNotional / input.currentEquity
        || input.totalGrossAvailable + 1e-9 < approvedNotional / input.currentEquity
        || positions(input.approvalPositions) !== positions(input.currentPositions)) {
        throw new Error("LIVE_ENTRY_SNAPSHOT_INCOMPATIBLE");
    }
    return approvedNotional;
}
