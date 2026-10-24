import type { CurrentProductionRuntime } from "@/lib/server/current-production-runtime";

const RUNTIME_SHA_RE = /^[0-9a-f]{40}$/i;
const HEARTBEAT_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const REQUIRED_RUNTIME_UNITS = ["v12", "pengu", "quality102", "v52", "fet", "hype"] as const;
const REQUIRED_RELEASE_SHAS = REQUIRED_RUNTIME_UNITS;
const REQUIRED_CAPS = [
  "v12BaseGross", "v12DynamicGross", "v12PerPositionGross", "penguGross", "quality102Gross",
  "cryptoGross", "stockGross", "totalGross", "v52V11Gross", "v52V50Gross",
  "sharedCryptoDailyLossPct", "stockDailyLossPct",
] as const;
const REQUIRED_V12_NUMBERS = [
  "maximumPositions", "neutralScoreThreshold", "strongRegimeThresholdPct", "strongRegimeQualityScoreMinimum",
  "strongRegimeQualityScoreMaximum", "strongRegimeQualityMinimumAtrRatio", "relaxedRegimeMinimumMomentumPct",
  "relaxedRegimeMinimumAtrRatio",
] as const;
const REQUIRED_PENGU_NUMBERS = [
  "hardStopCooldownHours", "recoveryInitialGross", "recoveryRsiDelta6Min", "recoveryEma168DistanceMinPct",
  "recoveryBtcReturn6hMinPct", "recoveryHardStopPct", "recoveryTrailActivationPct", "recoveryTrailRetracePct",
  "recoveryMaxHoldHours", "recoveryPartialAfterHours", "recoveryPartialGross", "longMultiplier", "lowGross",
] as const;
const REQUIRED_QUALITY_FAMILIES = ["HIGH_VOL", "MR", "BRK", "REV", "PB"] as const;
const REQUIRED_V52_NUMBERS = [
  "maximumHoldingHours", "minimumEntryBasisBps", "convergenceBps", "basisStopMultiple", "minimumNetEdgeBps",
  "maximumRoundTripCostBps", "maximumSpreadBps", "slotGross", "stockAggregateGross",
] as const;

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyTexts(value: AnyRecord, keys: readonly string[]) {
  return keys.every((key) => isNonEmptyText(value[key]));
}

function hasFiniteNumbers(value: AnyRecord, keys: readonly string[]) {
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isValidSha(value: unknown, expected?: string) {
  return typeof value === "string" && RUNTIME_SHA_RE.test(value.trim()) && (expected === undefined || value.trim() === expected);
}

function isFreshHeartbeat(value: unknown, now: number) {
  return typeof value === "number" && Number.isFinite(value) && value <= now && now - value <= HEARTBEAT_MAX_AGE_MS;
}

export function isHealthyCurrentRuntime(value: unknown, now = Date.now()): value is CurrentProductionRuntime {
  if (!isRecord(value)) return false;
  if ("error" in value || value.ok !== true || value.status !== "LIVE" || value.needsReview !== false || value.readOnly !== true || value.tradingMutation !== 0 || value.source !== "VPS_CURRENT_RUNTIME") return false;

  const releaseSha = typeof value.releaseSha === "string" ? value.releaseSha.trim() : "";
  const checkedAt = typeof value.checkedAt === "string" ? Date.parse(value.checkedAt) : Number.NaN;
  if (!RUNTIME_SHA_RE.test(releaseSha) || !Number.isFinite(checkedAt) || checkedAt > now) return false;

  const releaseShas = value.productionReleaseShas;
  if (!isRecord(releaseShas) || !REQUIRED_RELEASE_SHAS.every((key) => isValidSha(releaseShas[key], releaseSha))) return false;

  const lineage = value.runtimeLineage;
  if (!isRecord(lineage) || lineage.synchronized !== true || !isRecord(lineage.units)) return false;
  for (const unitName of REQUIRED_RUNTIME_UNITS) {
    const unit = lineage.units[unitName];
    if (!isRecord(unit) || "error" in unit || unit.matchesCurrent !== true || !isValidSha(unit.runtimeSha, releaseSha) || !isFreshHeartbeat(unit.updatedAt, now)) return false;
    if (unit.expectedSha !== undefined && !isValidSha(unit.expectedSha, releaseSha)) return false;
  }

  const caps = value.caps;
  if (!isRecord(caps) || !hasFiniteNumbers(caps, REQUIRED_CAPS)) return false;

  const v12 = value.v12;
  if (!isRecord(v12) || !hasNonEmptyTexts(v12, ["strategyId"]) || !hasFiniteNumbers(v12, REQUIRED_V12_NUMBERS)) return false;

  const pengu = value.pengu;
  if (!isRecord(pengu) || !hasNonEmptyTexts(pengu, ["strategyId", "recoveryRule", "recoveryPriority"]) || !hasFiniteNumbers(pengu, REQUIRED_PENGU_NUMBERS)) return false;

  const quality102 = value.quality102;
  if (!isRecord(quality102) || !hasNonEmptyTexts(quality102, ["selectorMode"]) || !isRecord(quality102.familyGross) || !hasFiniteNumbers(quality102.familyGross, REQUIRED_QUALITY_FAMILIES)) return false;

  const v52 = value.v52;
  if (!isRecord(v52) || !hasNonEmptyTexts(v52, ["policyId", "strategy"]) || !hasFiniteNumbers(v52, REQUIRED_V52_NUMBERS) || !Array.isArray(v52.windowsNy) || v52.windowsNy.length === 0 || !v52.windowsNy.every(isNonEmptyText)) return false;

  return true;
}

export function parseProductionRuntimeResponse(responseOk: boolean, value: unknown, now = Date.now()): CurrentProductionRuntime {
  if (responseOk && isHealthyCurrentRuntime(value, now)) return value;
  const candidate = isRecord(value) ? value : null;
  const reason = typeof candidate?.error === "string" ? candidate.error : "Production runtime unavailable; manual review required.";
  throw new Error(reason);
}

export function productionRuntimeStrategyLabel(runtime: CurrentProductionRuntime | null | undefined, now = Date.now()) {
  if (!isHealthyCurrentRuntime(runtime, now)) return "現在ランタイム未取得 / 手動確認";
  return [runtime.v12.strategyId, runtime.pengu.strategyId, runtime.v52.strategy].filter(Boolean).join(" / ") || "現在ランタイム構成未取得 / 手動確認";
}
