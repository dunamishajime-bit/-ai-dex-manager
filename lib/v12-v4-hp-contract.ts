/** Display-only V12 V4 contract pinned to the verified V4 source branch. */
export const V12_V4_HP_TARGET = Object.freeze({
  policyId: "V2_M150_D05_CORE_NATIVE",
  expectedRouteCount: 41,
});

// Coverage manifest copied from docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json
// at research/v4-independent-venue-lifecycle-20261010 (bd47341c...). These IDs
// are a source inventory only; they are not a live priority/ranking contract.
export const V12_V4_HP_ROUTE_IDS = Object.freeze([
  "CONT_SHORT_MID_AGE24_48",
  "FAILED_BREAK_REV_SHORT_6H",
  "REC_G1_MID_REL_LOWVOL",
  "REC_G2_EARLY_BTC_OPPOSE_VOL",
  "REC_G3_LATE_BTC_REL",
  "REC_G4_MATURE_REL_RANGE",
  "REC_G5_SLOW_TREND",
  "REC_X01_TIME_24H",
  "REC_X02_TIME_36H",
  "REC_X03_TIME_12H",
  "REC_X04_TIME_24H",
  "REC_X05_TIME_36H",
  "REC_X06_TIME_12H",
  "REC_X07_TIME_6H",
  "REC_X08_TIME_48H",
  "REC_X09_TIME_48H",
  "REC_X10_TIME_48H",
  "REC_X11_TIME_48H",
  "REC_X12_TIME_12H",
  "REC_X13_TP1.5_SL1_H24",
  "REC_X14_TIME_48H",
  "REC_Y01_REV_D0_T72",
  "REC_Y02_REV_D0_T12",
  "REC_Y03_REV_D0_T36",
  "REC_Y04_REV_D2_T36",
  "REC_Y05_REV_D2_T9",
  "REC_Y06_REV_D0_T72",
  "REC_Y07_REV_D0_T72",
  "REC_Y08_REV_D0_T6",
  "REC_Y09_REV_D2_T24",
  "REC_Y10_REV_D2_T24",
  "REC_Y11_REV_D0_T36",
  "REC_Y12_REV_D0_T24",
  "REC_Y13_REV_D2_T36",
  "REC_Y15_REV_D0_T3",
  "REC_Y16_REV_D0_T6",
  "REC_Y17_REV_D1_T3",
  "REC_Y18_REV_D2_T18",
  "REC_Y19_REV_D1_TP2_SL1_H36",
  "REC_Z14_ORIG_D2_T6",
  "REC_Z21_ORIG_D2_TP1_SL1_H24",
] as const);

export type V12V4HpDisplayStatus =
  | "LIVE_VERIFIED"
  | "STAGED_NOT_LIVE"
  | "SHADOW"
  | "STALE"
  | "SHA_MISMATCH"
  | "SOURCE_ERROR"
  | "UNAVAILABLE";

export type V12V4HpCandidate = {
  symbol: string;
  route: string;
  family: string | null;
  side: string | null;
  eligibleEntryTs: number | null;
  sourceRank: number | null;
  rankingEligible: false;
  rankingExclusion: "RESEARCH_PRIORITY_NOT_LIVE_RANK";
  score: number | null;
  scoreKind: "UNAVAILABLE";
  scoreLabel: "V4 decision source has no verified native score";
  features: Record<string, number | boolean>;
};

export type V12V4HpFilteredCandidate = {
  symbol: string;
  route: string;
  side: string | null;
  eligibleEntryTs: number | null;
  reason: string;
};

export type V12V4HpSnapshot = {
  schema: "v12-v4-hp-status/v1";
  target: { policyId: typeof V12_V4_HP_TARGET.policyId; expectedRouteCount: 41 };
  displayStatus: V12V4HpDisplayStatus;
  actual: {
    currentReleaseSha: string | null;
    activeRunnerId: string | null;
    activeRunnerState: string;
    activeRunnerSha: string | null;
    v4RunnerMode: "CERTIFIED" | "CANARY" | "SHADOW" | "UNKNOWN";
    v12PrimaryMode: "V4" | "LEGACY" | "UNKNOWN";
    legacyV12RunnerActive: boolean | null;
    v4ReleaseSha: string | null;
    heartbeatSha: string | null;
    orderEnabled: boolean | null;
  };
  timestamps: {
    checkedAt: number;
    heartbeatUpdatedAt: number | null;
    decisionTs: number | null;
    capturedAtMs: number | null;
  };
  freshness: { heartbeat: boolean; decision: boolean };
  candidates: V12V4HpCandidate[];
  filtered: V12V4HpFilteredCandidate[];
  routeCoverage: {
    expected: number;
    observed: number;
    candidateCount: number | null;
    filteredCount: number | null;
    unobserved: string[];
    completeness: false;
    semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE";
  };
  errors: string[];
  readOnly: true;
  tradingMutation: 0;
};
