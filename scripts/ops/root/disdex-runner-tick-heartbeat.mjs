export const RUNNER_TICK_HEARTBEAT_SCHEMA = "disdex-runner-tick-heartbeat/v1";

function validSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || ""));
}

function result(reason, ageMs = null, marker = null) {
  return { valid: false, fresh: false, reason, ageMs, marker };
}

export function validateRunnerTickHeartbeat(runner, marker, now) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return result("RUNNER_TICK_HEARTBEAT_MISSING");
  if (marker.schema !== RUNNER_TICK_HEARTBEAT_SCHEMA) return result("RUNNER_TICK_HEARTBEAT_SCHEMA_MISMATCH", null, marker);
  if (String(marker.runnerId || "") !== String(runner.runnerId || "")) return result("RUNNER_TICK_HEARTBEAT_RUNNER_ID_MISMATCH", null, marker);
  if (String(marker.runtimeSha || "").toLowerCase() !== String(runner.expectedSha || "").toLowerCase()) return result("RUNNER_TICK_HEARTBEAT_RUNTIME_SHA_MISMATCH", null, marker);
  if (String(marker.serviceUnit || "") !== String(runner.unit || "")) return result("RUNNER_TICK_HEARTBEAT_SERVICE_UNIT_MISMATCH", null, marker);
  if (!validSha(marker.runtimeSha) || !validSha(runner.expectedSha)) return result("RUNNER_TICK_HEARTBEAT_SHA_INVALID", null, marker);
  for (const counter of ["ordersSent", "cancelsSent", "positionChangesSent"]) {
    if (!Number.isSafeInteger(marker[counter]) || marker[counter] < 0) {
      return result("RUNNER_TICK_HEARTBEAT_COUNTER_INVALID", null, marker);
    }
  }
  if (typeof marker.status !== "string" || !marker.status.trim()) return result("RUNNER_TICK_HEARTBEAT_STATUS_INVALID", null, marker);
  if (typeof marker.reason !== "string") return result("RUNNER_TICK_HEARTBEAT_REASON_INVALID", null, marker);
  const started = marker.tickStartedAt;
  const completed = marker.tickCompletedAt;
  if (!Number.isSafeInteger(started) || started <= 0 || !Number.isSafeInteger(completed) || completed <= 0 || completed < started) {
    return result("RUNNER_TICK_HEARTBEAT_TIMESTAMP_INVALID", null, marker);
  }
  if (started > now || completed > now) return result("RUNNER_TICK_HEARTBEAT_FUTURE", Math.max(started, completed) - now, marker);
  const ageMs = Math.max(0, now - completed);
  const maxAgeMs = Number(runner.tickMaxAgeMs);
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return result("RUNNER_TICK_HEARTBEAT_MAX_AGE_INVALID", ageMs, marker);
  if (ageMs > maxAgeMs) return result("RUNNER_TICK_HEARTBEAT_STALE", ageMs, marker);
  return { valid: true, fresh: true, reason: "", ageMs, marker };
}
