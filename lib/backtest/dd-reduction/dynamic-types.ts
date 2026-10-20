export const DYNAMIC_STRATEGY_IDS = ["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"] as const;
export type DynamicStrategyId = (typeof DYNAMIC_STRATEGY_IDS)[number];

export const EVIDENCE_LEVELS = ["ORIGINAL_EVIDENCE", "CAUSALLY_REGENERATED", "MISSING", "UNVERIFIABLE"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const CANDIDATE_SOURCE_KINDS = ["RAW_CANDIDATE_DECISIONS", "SAVED_MARKET_DATA", "STRATEGY_ADAPTER"] as const;
export type CandidateSourceKind = (typeof CANDIDATE_SOURCE_KINDS)[number];

export type CandidateSide = "LONG" | "SHORT";
export type CandidateValidity = "VALID" | "INVALID" | "UNKNOWN";

export interface CandidateEvidence {
    readonly level: EvidenceLevel;
    readonly sourceKind: CandidateSourceKind;
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly rowNumber: number;
}

export interface DynamicCandidateEvent {
    readonly candidateId: string;
    readonly strategy: DynamicStrategyId;
    readonly ts: number;
    readonly symbol: string;
    readonly side: CandidateSide | null;
    readonly price: number | null;
    readonly validity: CandidateValidity;
    readonly accepted: boolean | null;
    readonly evidence: CandidateEvidence;
    readonly failClosed: boolean;
    readonly missingFields: readonly ("side" | "price" | "validity")[];
    readonly reason: string | null;
}

export interface CandidateSourceRecord {
    readonly kind: CandidateSourceKind;
    readonly path: string;
    readonly sourceSha256: string;
    readonly evidence: EvidenceLevel;
    readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface CandidateSourceInput {
    readonly records: readonly CandidateSourceRecord[];
    readonly feeBps?: number | readonly number[];
    readonly slippageBps?: number | readonly number[];
}

export interface CostScenario {
    readonly feeBps: number;
    readonly slippageBps: number;
}

export interface SourceHashIndexEntry {
    readonly path: string;
    readonly sha256: string;
    readonly rowCount: number;
    readonly bytes: number;
}

export interface CoverageEntry {
    readonly strategy: DynamicStrategyId;
    readonly feeBps: number;
    readonly slippageBps: number;
    readonly observedRows: number;
    readonly normalizedRows: number;
    readonly failClosedRows: number;
    readonly evidenceLevels: readonly EvidenceLevel[];
    readonly sourcePaths: readonly string[];
    readonly missingReasons: readonly string[];
}

export interface DynamicCandidateSourceResult {
    readonly events: readonly DynamicCandidateEvent[];
    readonly observedRowCount: number;
    readonly failClosedRowCount: number;
    readonly sourceHashes: readonly SourceHashIndexEntry[];
    readonly costScenarios: readonly CostScenario[];
    readonly coverageMatrix: readonly CoverageEntry[];
    readonly strategyCounts: Readonly<Record<DynamicStrategyId, number>>;
}

export interface CandidateSourceManifest {
    readonly manifestVersion: 1;
    readonly observedRowCount: number;
    readonly normalizedRowCount: number;
    readonly failClosedRowCount: number;
    readonly strategyCounts: Readonly<Record<DynamicStrategyId, number>>;
    readonly costScenarios: readonly CostScenario[];
    readonly coverageMatrix: readonly CoverageEntry[];
    readonly sourceHashes: readonly SourceHashIndexEntry[];
    readonly sha256Index: readonly SourceHashIndexEntry[];
}
