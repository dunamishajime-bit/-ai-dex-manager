import { assertStage, assertNoCredentialLikeText } from "./policy.mjs";

const METRIC_KEYS = [
  "devValDegradation",
  "sampleSufficiency",
  "foldDispersion",
  "falseStart",
  "failedInitiation",
  "failedAcceptance",
  "wrongCoreOwnership",
  "staleHold",
  "reversalRecognitionLag",
  "majorWaveEventCapture",
  "sameWindowMfeCapture",
  "exitGiveback",
  "bestTradeContribution",
  "top5Contribution",
  "pfWithoutBest",
  "stressDegradation",
  "turnover",
  "costDrag",
  "tradeStarvation",
];

function valueOrNull(source, key) {
  const value = source?.[key];
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean" ? value : null;
}

export function diagnoseCandidate(candidate, requestedStage) {
  const stage = assertStage(requestedStage);
  const source = candidate?.diagnostics?.[stage] ?? candidate?.[stage] ?? {};
  assertNoCredentialLikeText(JSON.stringify(candidate ?? {}));
  const metrics = Object.fromEntries(METRIC_KEYS.map((key) => [key, valueOrNull(source, key)]));
  return {
    candidateId: candidate?.candidateId ?? candidate?.id ?? null,
    strategyId: candidate?.strategyId ?? null,
    stage,
    status: Object.values(metrics).some((value) => value !== null) ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE",
    metrics,
    evidence: Array.isArray(source?.evidence) ? source.evidence.slice(0, 20) : [],
    confirmationAndHoldout: "INACCESSIBLE",
    researchMultiplicity: candidate?.researchMultiplicity ?? null,
  };
}

export function compareLineage(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error("LINEAGE_INPUT_INVALID");
  return items.map((item) => ({
    candidateId: item?.candidateId ?? item?.id ?? null,
    parentId: item?.parentId ?? null,
    sourceRunId: item?.sourceRunId ?? null,
    sourceArtifactId: item?.sourceArtifactId ?? null,
    sourceSha: item?.sourceSha ?? null,
    stage: item?.stage === "Confirmation" || item?.stage === "Holdout" ? "INACCESSIBLE" : item?.stage ?? null,
    multiplicity: item?.researchMultiplicity ?? null,
  }));
}

export function summarizeResearchStatus({ branch, headSha, activeRuns, completedRuns, artifactCount }) {
  return {
    mode: "research-only",
    branch,
    headSha,
    activeResearchRuns: activeRuns,
    completedResearchRuns: completedRuns,
    artifactCount,
    production: "INACCESSIBLE",
    live: "INACCESSIBLE",
    orders: "INACCESSIBLE",
    positions: "INACCESSIBLE",
    accounts: "INACCESSIBLE",
  };
}

