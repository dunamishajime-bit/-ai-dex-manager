import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { observePinnedDisplay } from "@/lib/server/pinned-runtime-display";
import type { RunnerPinId } from "@/lib/server/runner-pin-manifest";
import { loadReadOnlyRunnerPins } from "@/lib/server/read-only-runner-pin-telemetry";
import { loadPinnedHypeTickObservation } from "@/lib/server/hype-pinned-tick-observability";

const SHA_RE = /^[0-9a-f]{40}$/i;
const LEGACY_V12_HEARTBEAT_PATH = "/var/lib/disdex/runner-health/heartbeats/v12-x1-all.json";
const V12_V4_HEARTBEAT_PATH = "/var/lib/disdex/v12-v4/heartbeat.json";
const HEARTBEAT_PATHS = Object.freeze({
  v12: LEGACY_V12_HEARTBEAT_PATH,
  pengu: "/var/lib/disdex/runner-health/heartbeats/pengu-v8.json",
  quality102: "/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json",
  v52: "/var/lib/disdex/runner-health/heartbeats/v52.json",
  fet: "/var/lib/disdex/fet-brk48-residual/state.json",
  hype: "/var/lib/disdex/runner-health/heartbeats/hype-trend-long.json",
  idle: "/var/lib/disdex/runner-health/heartbeats/idle-priority-short.json",
});

export type CurrentProductionRuntime = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  checkedAt: string;
  source: "VPS_CURRENT_RUNTIME";
  releaseSha: string;
  capsSource?: "PINNED_SOURCE_AND_PROCESS";
  capsEffectiveVerified?: boolean;
  sharedHoldActive?: boolean | null;
  v4Policy?: { policyId: string; routeCount: number; entryDrawdownPct: number };
  // Source-backed display-only policy caps; legacy v12 fields are compatibility only.
  fetMaximumGross?: number;
  hypeMaximumGross?: number;
  productionReleaseShas: {
    v12: string;
    pengu: string;
    quality102: string;
    v52: string;
    fet: string;
    hype: string;
    idle: string;
  };
  runtimeLineage: {
    synchronized: boolean;
    units: Record<"v12" | "pengu" | "quality102" | "v52" | "fet" | "hype" | "idle", {
      runtimeSha?: string;
      expectedSha?: string;
      mode?: string;
      safetyState?: string;
      liveEnabled?: boolean;
      mainPid?: number;
      updatedAt?: number;
      healthReason?: string;
      matchesCurrent: boolean;
      processActive?: boolean;
      monitorOnly?: boolean;
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

export function extractObjectNumber(source: string, key: string): number {
  const pattern = new RegExp(`\\b${key}\\s*:\\s*([-+]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?)`);
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

async function loadRuntimeLineage(
  releaseSha: string,
  observations: Record<RuntimeUnitKey, Awaited<ReturnType<typeof observePinnedDisplay>>>,
  productionReleaseShas: CurrentProductionRuntime["productionReleaseShas"],
): Promise<CurrentProductionRuntime["runtimeLineage"]> {
  const units = {} as CurrentProductionRuntime["runtimeLineage"]["units"];
  const v12PrimaryMode = "V4";
  const expectedByUnit: Record<RuntimeUnitKey, string> = {
    v12: productionReleaseShas.v12,
    pengu: productionReleaseShas.pengu,
    quality102: productionReleaseShas.quality102,
    v52: productionReleaseShas.v52,
    fet: productionReleaseShas.fet,
    hype: productionReleaseShas.hype,
    idle: productionReleaseShas.idle,
  };
  const heartbeatPaths = {
    ...HEARTBEAT_PATHS,
    v12: v12PrimaryMode === "V4" ? V12_V4_HEARTBEAT_PATH : LEGACY_V12_HEARTBEAT_PATH,
  };
  for (const [unit, path] of Object.entries(heartbeatPaths) as Array<[RuntimeUnitKey, string]>) {
    try {
      const observation = observations[unit];
      if (observation.monitorOnly || !observation.processActive) {
        // Never export env or raw state; those are internal telemetry inputs.
        const {env: _env, monitorState: _state, ...safe} = observation;
        units[unit] = safe;
        continue;
      }
      // HYPE uses an independently pinned runner. The old shared heartbeat
      // writer still follows the parent SHA, so validate the real pinned
      // process + natural decision tick for *display only* instead.
      if (unit === "hype") {
        units.hype = await loadPinnedHypeTickObservation(expectedByUnit.hype);
        continue;
      }
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const runtimeSha = typeof raw.runtimeSha === "string" ? raw.runtimeSha.trim()
        : unit === "fet" && typeof raw.runtimeCommitSha === "string" ? raw.runtimeCommitSha.trim() : undefined;
      const pinnedSha = expectedByUnit[unit];
      const expectedSha = typeof raw.expectedSha === "string" && raw.expectedSha.trim()
        ? raw.expectedSha.trim()
        : pinnedSha;
      units[unit] = {
        runtimeSha,
        expectedSha,
        mode: typeof raw.mode === "string" ? raw.mode : undefined,
        safetyState: typeof raw.safetyState === "string" ? raw.safetyState : undefined,
        liveEnabled: typeof raw.liveEnabled === "boolean"
          ? raw.liveEnabled
          : unit === "v12" && v12PrimaryMode === "V4"
            ? raw.mode === "LIVE" && raw.operationMode === "CERTIFIED"
            : undefined,
        mainPid: Number.isFinite(Number(raw.mainPid)) ? Number(raw.mainPid) : undefined,
        updatedAt: Number.isFinite(Number(raw.heartbeatAt))
          ? Number(raw.heartbeatAt)
          : Number.isFinite(Number(raw.updatedAt))
            ? Number(raw.updatedAt)
            : undefined,
        healthReason: typeof raw.healthReason === "string" ? raw.healthReason : undefined,
        processActive: true,
        matchesCurrent: runtimeSha === pinnedSha && expectedSha === pinnedSha && Number(raw.mainPid) === observation.mainPid,

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
  const pins = await loadReadOnlyRunnerPins();
  const ids: Record<RuntimeUnitKey, RunnerPinId> = {
    v12:"V12_V4",pengu:"PENGU_V8",quality102:"QUALITY102_CAUSAL_V1",
    v52:"V52",fet:"FET_BRK48_RESIDUAL",hype:"HYPE_TREND_LONG",idle:"IDLE_PRIORITY_SHORT",
  };
  const productionReleaseShas = Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,pins.runners[id].sha])) as CurrentProductionRuntime["productionReleaseShas"];
  const releaseSha = productionReleaseShas.v12;
  // Validate the exact immutable source for each runner, not the retired
  // parent current symlink or the unrelated HP build SHA.
  const roots = Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,pins.runners[id].releaseRoot])) as Record<RuntimeUnitKey,string>;
  await Promise.all(Object.entries(ids).map(async ([key,id])=>{
    const marker=(await readFile(join(pins.runners[id].releaseRoot,".disdex-release-sha"),"utf8")).trim();
    if (!SHA_RE.test(marker) || marker!==pins.runners[id].sha) throw new Error("PINNED_RUNTIME_MARKER_MISMATCH:"+key);
  }));
  const observations = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([key,id])=>[key,await observePinnedDisplay(id,pins.runners[id])]))) as Record<RuntimeUnitKey,Awaited<ReturnType<typeof observePinnedDisplay>>>;
  const q102Source = await readFile(join(roots.quality102,"config","integratedProductionRiskPolicy.ts"),"utf8");
  const v12Risk = await readFile(join(roots.v12,"config","integratedProductionRiskPolicy.ts"),"utf8");
  const penguRisk = await readFile(join(roots.pengu,"config","integratedProductionRiskPolicy.ts"),"utf8");
  // Keep the older API compatibility fields, while current lineage is V4.
  const v12Source = await readFile(join(roots.v12,"config","v12X1AllRuntime.ts"),"utf8");
  const v4Risk=await readFile(join(roots.v12,"config","v12V4AdoptionRiskPolicy.ts"),"utf8");
  const v4Contract=await readFile(join(roots.v12,"lib","v12-v4-hp-contract.ts"),"utf8");
  const dd=v4Risk.match(/export const V12_V4_MAXIMUM_DRAWDOWN\s*=\s*([0-9.]+);/);
  const policyId=extractObjectText(v4Contract,"policyId");
  const routeCount=extractObjectNumber(v4Contract,"expectedRouteCount");
  const v4Policy=dd && Number.isFinite(Number(dd[1])) ? {policyId,routeCount,entryDrawdownPct:Number(dd[1])*100} : undefined;
  const fetRisk=await readFile(join(roots.fet,"config","integratedProductionRiskPolicy.ts"),"utf8");
  const hypeSource=await readFile(join(roots.hype,"config","hypeTrendLongPolicy.ts"),"utf8");
  let sharedHoldActive:boolean|null=null;
  try {
    const hold=JSON.parse(await readFile("/var/lib/disdex/shared/kill-switch.json","utf8"));
    if (typeof hold.active==="boolean") sharedHoldActive=hold.active;
  } catch {}

  const penguSource = await readFile(join(roots.pengu,"config","penguDualLsV2Runtime.ts"),"utf8");
  const penguRecoverySource = await readFile(join(roots.pengu,"config","penguRecoveryV8.ts"),"utf8");
  const runtimeLineage=await loadRuntimeLineage(releaseSha,observations,productionReleaseShas);
  const v52Raw=JSON.parse(await readFile(join(roots.v52,"config","v52V50Runtime.json"),"utf8")) as Record<string,unknown>;
  // Actual process values win over configured defaults. The provenance bit
  // makes absence of process evidence explicit rather than inventing a value.
  let capsEffectiveVerified = true;
  function cap(unit:RuntimeUnitKey,key:string,configured:number) {
    const raw=observations[unit].env[key];
    if (raw===undefined) {capsEffectiveVerified=false;return configured;}
    const value=Number(raw);
    if (!Number.isFinite(value)) {capsEffectiveVerified=false;return configured;}
    return value;
  }
  const windowsNy = Array.isArray(v52Raw.windowsNy)
    ? v52Raw.windowsNy.map((value) => String(value)).filter(Boolean)
    : [];
  if (!windowsNy.length) throw new Error("CURRENT_V52_RUNTIME_WINDOWS_MISSING");

  const stockDailyLossPct = extractObjectNumber(v12Risk, "stockDailyLossPct");
  const v12PerPositionGross = extractObjectNumber(v12Risk, "v12PerPositionGrossCap");

  const caps = {
      v12BaseGross: cap("v12","V12_BASE_GROSS_CAP",extractObjectNumber(v12Risk,"v12BaseAggregateGross")),
      v12DynamicGross: cap("v12","V12_DYNAMIC_GROSS_CAP",extractObjectNumber(v12Risk,"v12DynamicAggregateGrossCap")),
      v12PerPositionGross,
      penguGross: cap("pengu","PENGU_DUAL_LS_V2_MAX_GROSS",extractObjectNumber(penguRisk,"penguMaximumGross")),
      quality102Gross: cap("quality102","QUALITY102_CAUSAL_V1_MAX_GROSS",extractObjectNumber(q102Source,"q102CausalV4MaximumGross")),
      cryptoGross: cap("v12","CRYPTO_GROSS_CAP",extractObjectNumber(v12Risk,"cryptoGrossCap")),
      stockGross: cap("v52","DISDEX_V52_STOCK_GROSS_CAP",v52Number(v52Raw.stockAggregateGross,"stockAggregateGross")),
      totalGross: cap("v12","TOTAL_GROSS_CAP",extractObjectNumber(v12Risk,"totalGrossCap")),
      v52V11Gross: cap("v52","DISDEX_V52_V11_GROSS_CAP",v52Number(v52Raw.slotGross,"slotGross")),
      v52V50Gross: cap("v52","DISDEX_V52_V50_GROSS_CAP",v52Number(v52Raw.slotGross,"slotGross")),
      sharedCryptoDailyLossPct: cap("v12","DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT",extractObjectNumber(v12Risk,"cryptoDailyLossPct")),
      stockDailyLossPct,
  };
  const hypeMaximumGross=cap("hype","HYPE_LONG_MAX_GROSS",extractObjectNumber(hypeSource,"maximumGross"));
  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    checkedAt,
    source: "VPS_CURRENT_RUNTIME",
    releaseSha,
    productionReleaseShas,
    runtimeLineage,
    capsSource: "PINNED_SOURCE_AND_PROCESS",
    capsEffectiveVerified,
    sharedHoldActive,
    v4Policy,
    fetMaximumGross:extractObjectNumber(fetRisk,"fetResidualMaximumGross"),
    hypeMaximumGross,
    caps,
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
      selectorMode: observations.quality102.env.QUALITY102_CAUSAL_V1_SELECTOR_MODE || "UNVERIFIED",
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
