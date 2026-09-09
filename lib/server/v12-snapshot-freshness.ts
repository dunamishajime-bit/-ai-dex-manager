export function v12DecisionSnapshotIsCurrent(
  decisionReferenceTs: number | undefined,
  runnerReferenceTs: number | undefined,
): boolean {
  if (!Number.isFinite(decisionReferenceTs) || !Number.isFinite(runnerReferenceTs)) return true;
  return Number(decisionReferenceTs) >= Number(runnerReferenceTs);
}
