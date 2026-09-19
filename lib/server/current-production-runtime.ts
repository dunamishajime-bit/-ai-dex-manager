import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CURRENT_MARKER = "/home/deploy/disdex-trading/current/.disdex-release-sha";
const CURRENT_RELEASE_ROOT = "/home/deploy/disdex-trading/current";
const RUNTIME_ENV_ROOT = "/etc/disdex/current-runtime";
const SHA_RE = /^[0-9a-f]{40}$/i;
const HEARTBEAT_PATHS = Object.freeze({
  v12: "/var/lib/disdex/runner-health/heartbeats/v12-x1-all.json",
  pengu: "/var/lib/disdex/runner-health/heartbeats/pengu-v8.json",
  quality102: "/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json",
  v52: "/var/lib/disdex/runner-health/heartbeats/v52.json",
});

type EnvMap = Record<string, string>;

export type CurrentProductionRuntime = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  checkedAt: string;
  source: "VPS_CURRENT_RUNTIME";
  releaseSha: string;
  productionReleaseShas: {
    v12: string;
    pengu: string;
    quality102: string;
    v52: string;
  };
  runtimeLineage: {
    synchronized: boolean;
    units: Record<"v12" | "pengu" | "quality102" | "v52", {
      runtimeSha?: string;
      expectedSha?: string;
      mode?: string;
      safetyState?: string;
      matchesCurrent: boolean;
      error?: string;
    }>;
  };
  caps: {
    v12BaseGross: number;
    v12DynamicGross: number;
    v12PerPositionGross: number;
    penguGross: number;
    quality102Gross: number;
    cryptoGross: number;
    stockGross: number;
    totalGross: number;
    v52V11Gross: number;
    v52V50Gross: number;
    sharedCryptoDailyLossPct: number;
    stockDailyLossPct: number;
  };
  v12: {
    strategyId: string;
    maximumPositions: number;
    neutralScoreThreshold: number;
    strongRegimeThresholdPct: number;
    strongRegimeQualityScoreMinimum: number;
    strongRegimeQualityScoreMaximum: number;
    strongRegimeQualityMinimumAtrRatio: number;
    relaxedRegimeMinimumMomentumPct: number;
    relaxedRegimeMinimumAtrRatio: number;
  };
  pengu: {
    strategyId: string;
    hardStopCooldownHours: number;
    recoveryRule: string;
    recoveryPriority: string;
    recoveryInitialGross: number;
    recoveryRsiDelta6Min: number;
    recoveryEma168DistanceMinPct: number;
    recoveryBtcReturn6hMinPct: number;
    recoveryHardStopPct: number;
    recoveryTrailActivationPct: number;
    recoveryTrailRetracePct: number;
    recoveryMaxHoldHours: number;
    recoveryPartialAfterHours: number;
    recoveryPartialGross: number;
    longMultiplier: number;
    lowGross: number;
  };
  quality102: {
    selectorMode: string;
    familyGross: {
      HIGH_VOL: number;
      MR: number;
      BRK: number;
      REV: number;
      PB: number;
    };
  };
  v52: {
    policyId: string;
    strategy: string;
    maximumHoldingHours: number;
    minimumEntryBasisBps: number;
    convergenceBps: number;
    basisStopMultiple: number;
    minimumNetEdgeBps: number;
    maximumRoundTripCostBps: number;
    maximumSpreadBps: number;
    slotGross: number;
    stockAggregateGross: number;
    windowsNy: string[];
  };
};

function parseEnv(text: string): EnvMap {
  const result: EnvMap = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function requiredNumber(env: EnvMap, name: string): number {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) throw new Error(`CURRENT_RUNTIME_ENV_INVALID_NUMBER:${name}:${env[name] ?? "MISSING"}`);
  return value;
}

function requiredText(env: EnvMap, name: string): string {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`CURRENT_RUNTIME_ENV_MISSING:${name}`);
  return value;
}

function extractObjectNumber(source: string, key: string): number {
  const pattern = new RegExp(`\\b${key}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const match = source.match(pattern);
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`CURRENT_RUNTIME_SOURCE_VALUE_MISSING:${key}`);
  return value;
}

function extractObjectText(source: string, key: string): string {
  const pattern = new RegExp(`\\b${key}\\s*:\\s*["']([^"']+)["']`);
  const match = source.match(pattern);
  if (!match?.[1]) throw new Error(`CURRENT_RUNTIME_SOURCE_TEXT_MISSING:${key}`);
  return match[1];
}

function v52Number(value: unknown, key: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`CURRENT_V52_RUNTIME_INVALID:${key}`);
  return parsed;
}

type RuntimeUnitKey = keyof typeof HEARTBEAT_PATHS;

async function loadRuntimeLineage(releaseSha: string): Promise<CurrentProductionRuntime["runtimeLineage"]> {
  const units = {} as CurrentProductionRuntime["runtimeLineage"]["units"];
  for (const [unit, path] of Object.entries(HEARTBEAT_PATHS) as Array<[RuntimeUnitKey, string]>) {
    try {
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const runtimeSha = typeof raw.runtimeSha === "string" ? raw.runtimeSha.trim() : undefined;
      const expectedSha = typeof raw.expectedSha === "string" ? raw.expectedSha.trim() : undefined;
      units[unit] = {
        runtimeSha,
        expectedSha,
        mode: typeof raw.mode === "string" ? raw.mode : undefined,
        safetyState: typeof raw.safetyState === "string" ? raw.safetyState : undefined,
        matchesCurrent: runtimeSha === releaseSha && expectedSha === releaseSha,
      };
    } catch (error) {
      units[unit] = {
        matchesCurrent: false,
        error: error instanceof Error ? error.message : "HEARTBEAT_UNAVAILABLE",
      };
    }
  }
  return {
    synchronized: Object.values(units).every((unit) => unit.matchesCurrent),
    units,
  };
}

export async function loadCurrentProductionRuntime(): Promise<CurrentProductionRuntime> {
  const checkedAt = new Date().toISOString();
  const releaseSha = (await readFile(CURRENT_MARKER, "utf8")).trim();
  if (!SHA_RE.test(releaseSha)) throw new Error(`CURRENT_RUNTIME_SHA_INVALID:${releaseSha || "EMPTY"}`);

  const envPath = join(RUNTIME_ENV_ROOT, `${releaseSha}.env`);
  const env = parseEnv(await readFile(envPath, "utf8"));
  const envRelease = requiredText(env, "DISDEX_RELEASE_SHA");
  const runtimeCommit = requiredText(env, "DISDEX_RUNTIME_COMMIT_SHA");
  if (envRelease !== releaseSha || runtimeCommit !== releaseSha) {
    throw new Error(`CURRENT_RUNTIME_SHA_MISMATCH:MARKER_${releaseSha}:ENV_${envRelease}:RUNTIME_${runtimeCommit}`);
  }

  const q102Source = await readFile(join(CURRENT_RELEASE_ROOT, "config", "integratedProductionRiskPolicy.ts"), "utf8");
  const v12Source = await readFile(join(CURRENT_RELEASE_ROOT, "config", "v12X1AllRuntime.ts"), "utf8");
  const penguSource = await readFile(join(CURRENT_RELEASE_ROOT, "config", "penguDualLsV2Runtime.ts"), "utf8");
  const penguRecoverySource = await readFile(join(CURRENT_RELEASE_ROOT, "config", "penguRecoveryV8.ts"), "utf8");
  const runtimeLineage = await loadRuntimeLineage(releaseSha);
  const v52Raw = JSON.parse(await readFile(join(CURRENT_RELEASE_ROOT, "config", "v52V50Runtime.json"), "utf8")) as Record<string, unknown>;
  const windowsNy = Array.isArray(v52Raw.windowsNy)
    ? v52Raw.windowsNy.map((value) => String(value)).filter(Boolean)
    : [];
  if (!windowsNy.length) throw new Error("CURRENT_V52_RUNTIME_WINDOWS_MISSING");

  const stockDailyLossPct = extractObjectNumber(q102Source, "stockDailyLossPct");
  const v12PerPositionGross = extractObjectNumber(q102Source, "v12PerPositionGrossCap");

  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    checkedAt,
    source: "VPS_CURRENT_RUNTIME",
    releaseSha,
    productionReleaseShas: {
      v12: releaseSha,
      pengu: releaseSha,
      quality102: releaseSha,
      v52: releaseSha,
    },
    runtimeLineage,
    caps: {
      v12BaseGross: requiredNumber(env, "V12_BASE_GROSS_CAP"),
      v12DynamicGross: requiredNumber(env, "V12_DYNAMIC_GROSS_CAP"),
      v12PerPositionGross,
      penguGross: requiredNumber(env, "PENGU_GROSS_CAP"),
      quality102Gross: requiredNumber(env, "QUALITY102_CAUSAL_V1_MAX_GROSS"),
      cryptoGross: requiredNumber(env, "CRYPTO_GROSS_CAP"),
      stockGross: requiredNumber(env, "STOCK_GROSS_CAP"),
      totalGross: requiredNumber(env, "TOTAL_GROSS_CAP"),
      v52V11Gross: requiredNumber(env, "DISDEX_V52_V11_GROSS_CAP"),
      v52V50Gross: requiredNumber(env, "DISDEX_V52_V50_GROSS_CAP"),
      sharedCryptoDailyLossPct: requiredNumber(env, "DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT"),
      stockDailyLossPct,
    },
    v12: {
      strategyId: extractObjectText(v12Source, "strategyId"),
      maximumPositions: extractObjectNumber(v12Source, "maximumPositions"),
      neutralScoreThreshold: extractObjectNumber(v12Source, "neutralScoreThreshold"),
      strongRegimeThresholdPct: extractObjectNumber(v12Source, "strongRegimeThresholdPct"),
      strongRegimeQualityScoreMinimum: extractObjectNumber(v12Source, "strongRegimeQualityScoreMinimum"),
      strongRegimeQualityScoreMaximum: extractObjectNumber(v12Source, "strongRegimeQualityScoreMaximum"),
      strongRegimeQualityMinimumAtrRatio: extractObjectNumber(v12Source, "strongRegimeQualityMinimumAtrRatio"),
      relaxedRegimeMinimumMomentumPct: extractObjectNumber(v12Source, "relaxedRegimeMinimumMomentumPct"),
      relaxedRegimeMinimumAtrRatio: extractObjectNumber(v12Source, "relaxedRegimeMinimumAtrRatio"),
    },
    pengu: {
      strategyId: extractObjectText(penguSource, "id"),
      hardStopCooldownHours: extractObjectNumber(penguSource, "hardStopCooldownHours"),
      recoveryRule: extractObjectText(penguRecoverySource, "rule"),
      recoveryPriority: extractObjectText(penguRecoverySource, "priority"),
      recoveryInitialGross: extractObjectNumber(penguRecoverySource, "initialGross"),
      recoveryRsiDelta6Min: extractObjectNumber(penguRecoverySource, "rsiDelta6Min"),
      recoveryEma168DistanceMinPct: extractObjectNumber(penguRecoverySource, "ema168DistanceMinPct"),
      recoveryBtcReturn6hMinPct: extractObjectNumber(penguRecoverySource, "btcReturn6hMinPct"),
      recoveryHardStopPct: extractObjectNumber(penguRecoverySource, "hardStopPct"),
      recoveryTrailActivationPct: extractObjectNumber(penguRecoverySource, "trailActivationPct"),
      recoveryTrailRetracePct: extractObjectNumber(penguRecoverySource, "trailRetracePct"),
      recoveryMaxHoldHours: extractObjectNumber(penguRecoverySource, "maxHoldHours"),
      recoveryPartialAfterHours: extractObjectNumber(penguRecoverySource, "afterHours"),
      recoveryPartialGross: extractObjectNumber(penguRecoverySource, "gross"),
      longMultiplier: extractObjectNumber(penguRecoverySource, "longMultiplier"),
      lowGross: extractObjectNumber(penguRecoverySource, "lowGross"),
    },
    quality102: {
      selectorMode: requiredText(env, "QUALITY102_CAUSAL_V1_SELECTOR_MODE"),
      familyGross: {
        HIGH_VOL: extractObjectNumber(q102Source, "HIGH_VOL"),
        MR: extractObjectNumber(q102Source, "MR"),
        BRK: extractObjectNumber(q102Source, "BRK"),
        REV: extractObjectNumber(q102Source, "REV"),
        PB: extractObjectNumber(q102Source, "PB"),
      },
    },
    v52: {
      policyId: String(v52Raw.policyId || ""),
      strategy: String(v52Raw.strategy || ""),
      maximumHoldingHours: v52Number(v52Raw.maximumHoldingHours, "maximumHoldingHours"),
      minimumEntryBasisBps: v52Number(v52Raw.minimumEntryBasisBps, "minimumEntryBasisBps"),
      convergenceBps: v52Number(v52Raw.convergenceBps, "convergenceBps"),
      basisStopMultiple: v52Number(v52Raw.basisStopMultiple, "basisStopMultiple"),
      minimumNetEdgeBps: v52Number(v52Raw.minimumNetEdgeBps, "minimumNetEdgeBps"),
      maximumRoundTripCostBps: v52Number(v52Raw.maximumRoundTripCostBps, "maximumRoundTripCostBps"),
      maximumSpreadBps: v52Number(v52Raw.maximumSpreadBps, "maximumSpreadBps"),
      slotGross: v52Number(v52Raw.slotGross, "slotGross"),
      stockAggregateGross: v52Number(v52Raw.stockAggregateGross, "stockAggregateGross"),
      windowsNy,
    },
  };
}
