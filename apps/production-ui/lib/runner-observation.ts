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
export type RunnerRecoveryLabel = 'UNKNOWN' | 'ATTENTION' | 'VERIFYING' | 'HEALTHY_OBSERVED';
export type RunnerRecoveryState = {
  sequence: number;
  streak: number;
  label: RunnerRecoveryLabel;
};
export type RunnerRecoverySample = {
  sequence?: number;
  healthy: boolean;
};

// Diagnostic-only recovery evidence. A repeated or missing sequence never
// advances the streak, and this state must not be used as execution authority.
export function observeRunnerRecovery(previous: RunnerRecoveryState | undefined, sample: RunnerRecoverySample): RunnerRecoveryState {
  const sequence = sample.sequence;
  const fresh = typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 0 &&
    (!previous || sequence > previous.sequence);
  const healthy = fresh && sample.healthy;
  const streak = healthy ? (previous?.streak ?? 0) + 1 : 0;
  return {
    sequence: fresh ? sequence : previous?.sequence ?? -1,
    streak,
    label: !fresh ? 'UNKNOWN' : !healthy ? 'ATTENTION' : streak >= 3 ? 'HEALTHY_OBSERVED' : 'VERIFYING',
  };
}

export function createRunnerObservationTracker() {
  const states = new Map<string, RunnerRecoveryState>();
  return {
    observe(id: string, sample: RunnerRecoverySample): RunnerRecoveryState {
      const next = observeRunnerRecovery(states.get(id), sample);
      states.set(id, next);
      return next;
    },
  };
}

export function classifyRunnerObservation(row: RunnerObservationInput, safety: SharedObservationInput, hasHeartbeat: boolean) {
  const process = row.serviceState === 'RUNNING' ? 'RUNNING' : row.serviceState === 'STOPPED' ? 'STOPPED' : 'UNVERIFIED';
  const local = row.serviceState === 'STOPPED' ? 'FAULT' : row.mismatchReason || row.serviceState === 'SHA_MISMATCH' ? 'ATTENTION' : row.serviceState !== 'RUNNING' || !hasHeartbeat || !row.heartbeatFresh || row.heartbeatSha !== row.pinSha ? 'UNVERIFIED' : row.safetyState === 'BLOCKED' ? 'ATTENTION' : 'OBSERVED';
  const protection = row.safetyState === 'BLOCKED' ? 'BLOCK_REPORTED' : safety.holdActive === true ? 'SHARED_HOLD_REPORTED' : 'AUTHORITY_UNVERIFIED';
  return { process, local, protection } as const;
}

