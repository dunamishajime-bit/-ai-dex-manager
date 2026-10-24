export type DecisionStatusState<T> = {
  snapshot: T | null;
  error: string | null;
};

export const DECISION_STATUS_REFRESH_MS = 30_000;

type DecisionRuntimeSnapshot = {
  ok?: unknown;
  v12V4?: { displayStatus?: unknown } | null;
};

export function applyDecisionStatusSuccess<T>(snapshot: T, error: string | null): DecisionStatusState<T> {
  return { snapshot, error };
}

export function applyDecisionStatusFailure<T>(_previous: DecisionStatusState<T>, cause: unknown): DecisionStatusState<T> {
  return {
    snapshot: null,
    error: cause instanceof Error ? cause.message : "判定データを取得できません。",
  };
}

export function isDecisionRuntimeAvailable(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const candidate = snapshot as DecisionRuntimeSnapshot;
  return candidate.ok === true && candidate.v12V4?.displayStatus === "LIVE_VERIFIED";
}
