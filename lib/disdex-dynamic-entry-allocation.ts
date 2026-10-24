export type DynamicAssetClass = "CRYPTO" | "STOCK";

export type DynamicBtPriorMetrics = {
    returnPct: number;
    profitFactor: number;
    winRatePct: number;
    maxDrawdownPct: number;
    tradeCount: number;
    observationDays: number;
};

export type DynamicEntryCandidate = {
    id: string;
    strategy: string;
    symbol: string;
    side: "LONG" | "SHORT";
    assetClass: DynamicAssetClass;
    marketFitScore: number;
    /** Causal producer provenance; optional for existing research callers. */
    scoreSource?: string;
    signalTs?: number;
    idempotencyKey?: string;
    targetGross: number;
    minGross: number;
    maxGross: number;
    minNotionalUsd?: number;
    btPrior?: DynamicBtPriorMetrics;
    btPriorVersion?: string;
    correlationPenalty?: number;
    concentrationPenalty?: number;
    stalePenalty?: number;
};

export type DynamicEntryAllocation = DynamicEntryCandidate & {
    btPriorBonus: number;
    finalScore: number;
    allocatedGross: number;
};

export type DynamicEntryAllocationResult = {
    allocations: DynamicEntryAllocation[];
    rejected: Array<{ id: string; reason: string }>;
    residual: { cryptoGross: number; stockGross: number; totalGross: number };
};

const DEFAULT_MAX_BT_BONUS = 10;
const MIN_CONFIDENT_TRADES = 50;
const FULL_OBSERVATION_DAYS = 90;

function normalized(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function safe(value: number | undefined): number {
    return Number.isFinite(value) ? value! : 0;
}

export function calculateBtPriorBonus(input: DynamicBtPriorMetrics, maxBonus = DEFAULT_MAX_BT_BONUS): number {
    const performance =
        0.3 * normalized(input.returnPct / 50) +
        0.25 * normalized((input.profitFactor - 1) / 2) +
        0.2 * normalized((input.winRatePct - 50) / 30) +
        0.25 * normalized(1 - input.maxDrawdownPct / 50);
    const tradeConfidence = normalized(input.tradeCount / MIN_CONFIDENT_TRADES);
    const observationConfidence = normalized(input.observationDays / FULL_OBSERVATION_DAYS);
    const cap = Number.isFinite(maxBonus) ? Math.max(0, maxBonus) : 0;
    return cap * performance * tradeConfidence * observationConfidence;
}

export function scoreDynamicEntryCandidate(input: DynamicEntryCandidate, maxBonus = DEFAULT_MAX_BT_BONUS): { btPriorBonus: number; finalScore: number } {
    const btPriorBonus = input.btPrior ? calculateBtPriorBonus(input.btPrior, maxBonus) : 0;
    const finalScore = safe(input.marketFitScore) + btPriorBonus
        - Math.max(0, safe(input.correlationPenalty))
        - Math.max(0, safe(input.concentrationPenalty))
        - Math.max(0, safe(input.stalePenalty));
    return { btPriorBonus, finalScore };
}

type ScoredCandidate = {
    candidate: DynamicEntryCandidate;
    btPriorBonus: number;
    finalScore: number;
    minimumGross: number;
    targetGross: number;
    allocatedGross: number;
};

function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
    return b.finalScore - a.finalScore || a.candidate.id.localeCompare(b.candidate.id);
}

export function allocateDynamicEntryGross(input: {
    candidates: readonly DynamicEntryCandidate[];
    cryptoGrossAvailable: number;
    stockGrossAvailable: number;
    totalGrossAvailable: number;
    equityUsd: number;
    maxBtBonus?: number;
}): DynamicEntryAllocationResult {
    const cryptoCapacity = Math.max(0, safe(input.cryptoGrossAvailable));
    const stockCapacity = Math.max(0, safe(input.stockGrossAvailable));
    const totalCapacity = Math.max(0, safe(input.totalGrossAvailable));
    const classCapacity: Record<DynamicAssetClass, number> = { CRYPTO: cryptoCapacity, STOCK: stockCapacity };
    const rejected: DynamicEntryAllocationResult["rejected"] = [];
    const eligible: ScoredCandidate[] = [];

    for (const candidate of input.candidates) {
        const score = scoreDynamicEntryCandidate(candidate, input.maxBtBonus);
        const invalidNotional = candidate.minNotionalUsd !== undefined
            && (!Number.isFinite(candidate.minNotionalUsd) || candidate.minNotionalUsd < 0
                || (candidate.minNotionalUsd > 0 && (!Number.isFinite(input.equityUsd) || input.equityUsd <= 0)));
        const notionalGross = invalidNotional
            ? Number.POSITIVE_INFINITY
            : candidate.minNotionalUsd === undefined || candidate.minNotionalUsd === 0
                ? 0
                : candidate.minNotionalUsd / input.equityUsd;
        const minimumGross = Math.max(safe(candidate.minGross), notionalGross);
        const reason = candidate.minNotionalUsd !== undefined && notionalGross > safe(candidate.minGross)
            ? "MIN_NOTIONAL_NOT_MET"
            : "MIN_GROSS_NOT_MET";

        if (!Number.isFinite(minimumGross) || minimumGross <= 0 || safe(candidate.maxGross) < minimumGross || classCapacity[candidate.assetClass] <= 0 || totalCapacity <= 0) {
            rejected.push({ id: candidate.id, reason });
            continue;
        }
        eligible.push({
            candidate,
            ...score,
            minimumGross,
            targetGross: Math.min(safe(candidate.targetGross), safe(candidate.maxGross)),
            allocatedGross: 0,
        });
    }

    eligible.sort(compareCandidates);
    let totalRemaining = totalCapacity;
    const classRemaining: Record<DynamicAssetClass, number> = { ...classCapacity };
    const admitted: ScoredCandidate[] = [];

    for (const item of eligible) {
        const { assetClass } = item.candidate;
        if (item.minimumGross > totalRemaining + 1e-12 || item.minimumGross > classRemaining[assetClass] + 1e-12) {
            rejected.push({ id: item.candidate.id, reason: item.minimumGross > safe(item.candidate.minGross) ? "MIN_NOTIONAL_NOT_MET" : "MIN_GROSS_NOT_MET" });
            continue;
        }
        item.allocatedGross = item.minimumGross;
        totalRemaining -= item.minimumGross;
        classRemaining[assetClass] -= item.minimumGross;
        admitted.push(item);
    }

    // Weighted water filling; saturated targets/maxima and class pools release
    // their unused share for the remaining eligible candidates on the next pass.
    for (let pass = 0; pass < admitted.length && totalRemaining > 1e-12; pass += 1) {
        const open = admitted.filter((item) => item.allocatedGross < Math.min(item.targetGross, safe(item.candidate.maxGross)) - 1e-12
            && classRemaining[item.candidate.assetClass] > 1e-12
            && item.finalScore > 0);
        const weightSum = open.reduce((sum, item) => sum + item.finalScore * Math.max(0, item.targetGross - item.allocatedGross), 0);
        if (open.length === 0 || weightSum <= 0) break;

        const proposals = open.map((item) => ({
            item,
            gross: totalRemaining * item.finalScore * Math.max(0, item.targetGross - item.allocatedGross) / weightSum,
        }));
        const classProposals: Record<DynamicAssetClass, number> = { CRYPTO: 0, STOCK: 0 };
        for (const proposal of proposals) classProposals[proposal.item.candidate.assetClass] += proposal.gross;

        const classScale: Record<DynamicAssetClass, number> = {
            CRYPTO: classProposals.CRYPTO > classRemaining.CRYPTO ? classRemaining.CRYPTO / classProposals.CRYPTO : 1,
            STOCK: classProposals.STOCK > classRemaining.STOCK ? classRemaining.STOCK / classProposals.STOCK : 1,
        };
        let distributed = 0;
        for (const { item, gross } of proposals) {
            const amount = Math.min(
                gross * classScale[item.candidate.assetClass],
                Math.max(0, Math.min(item.targetGross, safe(item.candidate.maxGross)) - item.allocatedGross),
            );
            item.allocatedGross += amount;
            classRemaining[item.candidate.assetClass] -= amount;
            distributed += amount;
        }
        totalRemaining -= distributed;
        if (distributed <= 1e-12) break;
    }

    const allocations = admitted.map((item) => ({
        ...item.candidate,
        btPriorBonus: item.btPriorBonus,
        finalScore: item.finalScore,
        allocatedGross: item.allocatedGross,
    }));
    rejected.sort((a, b) => a.id.localeCompare(b.id));
    const cryptoGross = allocations.filter((item) => item.assetClass === "CRYPTO").reduce((sum, item) => sum + item.allocatedGross, 0);
    const stockGross = allocations.filter((item) => item.assetClass === "STOCK").reduce((sum, item) => sum + item.allocatedGross, 0);

    return {
        allocations,
        rejected,
        residual: {
            cryptoGross: Math.max(0, cryptoCapacity - cryptoGross),
            stockGross: Math.max(0, stockCapacity - stockGross),
            totalGross: Math.max(0, totalCapacity - cryptoGross - stockGross),
        },
    };
}
