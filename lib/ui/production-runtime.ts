import type { CurrentProductionRuntime } from "@/lib/server/current-production-runtime";

const RUNTIME_SHA_RE = /^[0-9a-f]{40}$/i;
const REQUIRED_RUNTIME_UNITS = ["v12", "pengu", "quality102", "v52", "fet", "hype"] as const;

type RuntimeCandidate = Partial<CurrentProductionRuntime> & {
  error?: unknown;
  runtimeLineage?: Partial<CurrentProductionRuntime["runtimeLineage"]> & {
    units?: Record<string, Partial<CurrentProductionRuntime["runtimeLineage"]["units"]["v12"]>>;
  };
};

export function isHealthyCurrentRuntime(value: unknown): value is CurrentProductionRuntime {
  if (!value || typeof value !== "object") return false;
  const runtime = value as RuntimeCandidate;
  const releaseSha = typeof runtime.releaseSha === "string" ? runtime.releaseSha.trim() : "";
  const lineage = runtime.runtimeLineage;
  const units = lineage?.units;
  if (runtime.ok !== true || runtime.status !== "LIVE" || runtime.needsReview !== false || !RUNTIME_SHA_RE.test(releaseSha) || lineage?.synchronized !== true || !units) return false;

  return REQUIRED_RUNTIME_UNITS.every((unitName) => {
    const unit = units[unitName];
    const runtimeSha = typeof unit?.runtimeSha === "string" ? unit.runtimeSha.trim() : "";
    const expectedSha = unit?.expectedSha;
    return unit?.matchesCurrent === true
      && RUNTIME_SHA_RE.test(runtimeSha)
      && runtimeSha === releaseSha
      && (expectedSha === undefined || expectedSha === releaseSha);
  });
}

export function parseProductionRuntimeResponse(responseOk: boolean, value: unknown): CurrentProductionRuntime {
  if (responseOk && isHealthyCurrentRuntime(value)) return value;
  const candidate = value && typeof value === "object" ? value as { error?: unknown } : null;
  const reason = typeof candidate?.error === "string" ? candidate.error : "Production runtime unavailable; manual review required.";
  throw new Error(reason);
}

export function productionRuntimeStrategyLabel(runtime: CurrentProductionRuntime | null | undefined) {
  if (!isHealthyCurrentRuntime(runtime)) return "現在ランタイム未取得 / 手動確認";
  return [runtime.v12.strategyId, runtime.pengu.strategyId, runtime.v52.strategy].filter(Boolean).join(" / ") || "現在ランタイム構成未取得 / 手動確認";
}
