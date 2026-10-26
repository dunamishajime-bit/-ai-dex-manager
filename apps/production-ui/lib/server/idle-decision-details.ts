export const IDLE_DECISION_DETAILS_MAX_AGE_MS = 15 * 60_000;

export type IdleDecisionDetailsAssessment = {
  fresh: boolean;
  status: "FRESH" | "STALE_OR_SHA_MISMATCH" | "UNAVAILABLE";
  updatedAt: number | null;
};

export function assessIdleDecisionDetails(details: unknown, expectedSha: string, now: number): IdleDecisionDetailsAssessment {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return { fresh: false, status: "UNAVAILABLE", updatedAt: null };
  }
  const row = details as { runtimeSha?: unknown; updatedAt?: unknown };
  const updatedAt = Number(row.updatedAt);
  const sha = String(row.runtimeSha || "").toLowerCase();
  const fresh = sha === expectedSha
    && /^[0-9a-f]{40}$/.test(expectedSha)
    && Number.isFinite(updatedAt)
    && updatedAt > 0
    && updatedAt <= now + 60_000
    && now - updatedAt <= IDLE_DECISION_DETAILS_MAX_AGE_MS;
  return {
    fresh,
    status: fresh ? "FRESH" : "STALE_OR_SHA_MISMATCH",
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
  };
}
