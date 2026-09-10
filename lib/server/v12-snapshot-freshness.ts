export function v12DecisionSnapshotIsCurrent(
  decisionReferenceTs: number | undefined,
  runnerReferenceTs: number | undefined,
): boolean {
  if (!Number.isFinite(decisionReferenceTs) || !Number.isFinite(runnerReferenceTs)) return true;
  return Number(decisionReferenceTs) >= Number(runnerReferenceTs);
}

export const V12_RUNNER_FRESHNESS_MS = 3 * 60 * 60 * 1000;

export function v12RunnerStateIsFresh(
  updatedAt: number | undefined,
  lastReferenceTs: number | undefined,
  mode: unknown,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(lastReferenceTs)) return false;
  if (String(mode || "").toLowerCase() !== "live") return false;
  const age = now - Number(updatedAt);
  return age >= 0 && age <= V12_RUNNER_FRESHNESS_MS;
}
