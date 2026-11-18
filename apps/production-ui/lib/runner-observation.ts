// Display-only classification. Never use this result as execution authority.
export type RunnerObservationInput = {
  serviceState: string;
  heartbeatFresh: boolean;
  heartbeatSha?: string;
  pinSha: string;
  safetyState?: string;
  mismatchReason?: string;
};
export type SharedObservationInput = { holdActive: boolean | null; scope?: string };
export function classifyRunnerObservation(row: RunnerObservationInput, safety: SharedObservationInput, hasHeartbeat: boolean) {
  const process = row.serviceState === 'RUNNING' ? 'RUNNING' : row.serviceState === 'STOPPED' ? 'STOPPED' : 'UNVERIFIED';
  const local = row.serviceState === 'STOPPED' ? 'FAULT' : row.mismatchReason || row.serviceState === 'SHA_MISMATCH' ? 'ATTENTION' : row.serviceState !== 'RUNNING' || !hasHeartbeat || !row.heartbeatFresh || row.heartbeatSha !== row.pinSha ? 'UNVERIFIED' : row.safetyState === 'BLOCKED' ? 'ATTENTION' : 'OBSERVED';
  const protection = row.safetyState === 'BLOCKED' ? 'BLOCK_REPORTED' : safety.holdActive === true ? 'SHARED_HOLD_REPORTED' : 'AUTHORITY_UNVERIFIED';
  return { process, local, protection } as const;
}
