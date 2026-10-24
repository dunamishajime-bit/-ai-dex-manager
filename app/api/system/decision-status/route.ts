import { NextRequest, NextResponse } from "next/server";
import { loadDecisionStatus, type DecisionStatusSnapshot } from "@/lib/server/disdex-decision-status";
import { loadV12DecisionObservability } from "@/lib/server/v12-decision-observability";
import { loadV52Top2Observability } from "@/lib/server/v52-top2-observability";
import { loadPenguRuntimeObservability } from "@/lib/server/pengu-runtime-observability";
import { loadQuality102RuntimeObservability } from "@/lib/server/quality102-runtime-observability";
import { loadV12V4HpObservability } from "@/lib/server/v12-v4-hp-observability";
import { isCurrentProductionRuntimeHealthy, isFreshRuntimeTimestamp, isRuntimeLineageUnitHealthy, RUNNER_FRESHNESS_MS } from "@/lib/server/current-production-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export type V12RuntimeFreshnessInput = {
  runtime: {
    ok: boolean;
    status?: "LIVE" | "UNAVAILABLE";
    releaseSha?: string;
    runtimeLineage?: { synchronized: boolean; units?: { v12?: { runtimeSha?: string; matchesCurrent: boolean; updatedAt?: number; error?: string } } };
  } | null;
  runnerState?: { releaseSha?: string; updatedAt?: number; mode?: string; killSwitch?: { active?: boolean } } | null;
  now?: number;
};

export function isV12RuntimeFresh({ runtime, runnerState, now = Date.now() }: V12RuntimeFreshnessInput): boolean {
  const releaseSha = runtime?.releaseSha;
  const lineageUnit = runtime?.runtimeLineage?.units?.v12;
  return Boolean(
    runtime?.ok === true
    && runtime.status === "LIVE"
    && runtime.runtimeLineage?.synchronized === true
    && releaseSha
    && runnerState?.releaseSha === releaseSha
    && isRuntimeLineageUnitHealthy(lineageUnit, now)
    && isFreshRuntimeTimestamp(runnerState.updatedAt, now, RUNNER_FRESHNESS_MS)
    && runnerState.mode?.toLowerCase() === "live"
    && runnerState.killSwitch?.active !== true,
  );
}

export type DecisionStatusRouteDependencies = {
  loadDecisionStatus: typeof loadDecisionStatus;
  loadV12DecisionObservability: typeof loadV12DecisionObservability;
  loadV52Top2Observability: typeof loadV52Top2Observability;
  loadPenguRuntimeObservability: typeof loadPenguRuntimeObservability;
  loadQuality102RuntimeObservability: typeof loadQuality102RuntimeObservability;
  loadV12V4HpObservability: typeof loadV12V4HpObservability;
};

type DecisionStatusObservers = {
  v12Observability: Omit<Awaited<ReturnType<typeof loadV12DecisionObservability>>, "ok"> & { ok: boolean; runtimeStatus?: "LIVE" | "UNAVAILABLE" };
  v52Top2Observability: Awaited<ReturnType<typeof loadV52Top2Observability>>;
  penguRuntime: Awaited<ReturnType<typeof loadPenguRuntimeObservability>>;
  quality102Runtime: Awaited<ReturnType<typeof loadQuality102RuntimeObservability>>;
  v12V4: Awaited<ReturnType<typeof loadV12V4HpObservability>>;
};

function unavailableRuntime(runtime: DecisionStatusSnapshot["runtime"], reason: string): DecisionStatusSnapshot["runtime"] {
  return {
    ...runtime,
    units: runtime.units.map((unit) => ({
      ...unit,
      label: `${unit.id} unavailable`,
      status: "UNAVAILABLE" as const,
      releaseSha: "UNAVAILABLE",
      venue: "Production runtime unavailable",
      timeframe: "Production runtime unavailable; needs manual review.",
      entryPolicy: "Production runtime unavailable; needs manual review.",
      protection: "Production runtime unavailable; needs manual review.",
      note: "Current production runtime lineage is unavailable; manual review required.",
      reason,
      updatedAt: undefined,
    })),
  };
}

function failClosedObservers(observers: DecisionStatusObservers, reason: string): DecisionStatusObservers & { runtimeStatus: "UNAVAILABLE" } {
  return {
    runtimeStatus: "UNAVAILABLE",
    v12Observability: {
      ...observers.v12Observability,
      ok: false,
      runtimeStatus: "UNAVAILABLE",
      decisionDetailsAvailable: false,
      decision: null,
      runnerState: null,
      sharedRisk: null,
      v12Positions: [],
      recentFills: [],
      errors: [...observers.v12Observability.errors, reason],
      warnings: [...observers.v12Observability.warnings, "Current production runtime lineage is unavailable."],
    },
    v52Top2Observability: {
      ...observers.v52Top2Observability,
      ok: false,
      status: "UNAVAILABLE" as const,
      updatedAt: undefined,
      reason,
      errors: [...observers.v52Top2Observability.errors, reason],
    },
    penguRuntime: {
      ...observers.penguRuntime,
      status: "UNAVAILABLE" as const,
      updatedAt: undefined,
      reason,
    },
    quality102Runtime: {
      ...observers.quality102Runtime,
      ok: false,
      status: "UNAVAILABLE" as const,
      updatedAt: undefined,
      reason,
      errors: [...observers.quality102Runtime.errors, reason],
    },
    v12V4: {
      ...observers.v12V4,
      displayStatus: "UNAVAILABLE" as const,
      actual: {
        ...observers.v12V4.actual,
        currentReleaseSha: null,
        activeRunnerId: null,
        activeRunnerState: "unavailable",
        activeRunnerSha: null,
        v4ReleaseSha: null,
        heartbeatSha: null,
        orderEnabled: null,
      },
      timestamps: { ...observers.v12V4.timestamps, heartbeatUpdatedAt: null, decisionTs: null, capturedAtMs: null },
      freshness: { heartbeat: false, decision: false },
      errors: [...observers.v12V4.errors, reason],
    },
  };
}

export function overlayDecisionStatusRuntime(snapshot: DecisionStatusSnapshot, observers: DecisionStatusObservers) {
  if (!isCurrentProductionRuntimeHealthy(snapshot.productionRuntime)) {
    const reason = snapshot.error || "Current production runtime lineage unavailable; manual review required.";
    return { ...snapshot, ok: false, error: reason, runtime: unavailableRuntime(snapshot.runtime, reason), ...failClosedObservers(observers, reason) };
  }

  const v12UpdatedAt = observers.v12Observability.runnerState?.updatedAt;
  const v12Fresh = observers.v12Observability.wiring.runnerStateConfigured && isV12RuntimeFresh({ runtime: snapshot.productionRuntime ?? null, runnerState: observers.v12Observability.runnerState, now: Date.now() });
  const v12Status = !observers.v12Observability.wiring.runnerStateConfigured ? "UNAVAILABLE" : v12Fresh ? "LIVE" : "STALE";
  const runtime = {
    ...snapshot.runtime,
    units: snapshot.runtime.units.map((unit) => {
      if (unit.id === "V12_X1.00_ALL") return { ...unit, status: v12Status as typeof unit.status, updatedAt: v12UpdatedAt, reason: v12Fresh ? "V12 runner state更新済み、mode=LIVE、Kill Switch inactive、current runtime SHA一致を確認しました。" : observers.v12Observability.errors[0] || "V12 runner stateが未接続・停止・古い、またはruntime SHA/lineageが不一致のためLIVE確認できません。" };
      if (unit.id === "PENGU_DUAL_LS_V2_FINAL") return { ...unit, status: observers.penguRuntime.status, updatedAt: observers.penguRuntime.updatedAt, reason: observers.penguRuntime.reason };
      if (unit.id === "QUALITY102_CAUSAL_V1") return { ...unit, status: observers.quality102Runtime.status, updatedAt: observers.quality102Runtime.updatedAt, reason: observers.quality102Runtime.reason };
      if (!snapshot.v52.marketOpen) return { ...unit, status: "UNCONFIRMED" as const, updatedAt: observers.v52Top2Observability.updatedAt, reason: "米国株式市場の対象時間外です。V52は市場時間外のため意図的停止で、新規判定・発注は行いません。" };
      return { ...unit, status: observers.v52Top2Observability.status === "LIVE" ? "LIVE" : observers.v52Top2Observability.status === "STALE" ? "STALE" : "UNAVAILABLE", updatedAt: observers.v52Top2Observability.updatedAt, reason: observers.v52Top2Observability.errors[0] || observers.v52Top2Observability.reason || (observers.v52Top2Observability.status === "LIVE" ? "V52 runner state更新済み、Kill Switch inactiveを確認しました。" : "V52 runner stateがLIVE確認条件を満たしていません。") };
    }),
  };
  return { ...snapshot, runtime, v12V4: observers.v12V4, v12Observability: observers.v12Observability, v52Top2Observability: observers.v52Top2Observability, penguRuntime: observers.penguRuntime, quality102Runtime: observers.quality102Runtime };
}

const defaultDependencies: DecisionStatusRouteDependencies = {
  loadDecisionStatus,
  loadV12DecisionObservability,
  loadV52Top2Observability,
  loadPenguRuntimeObservability,
  loadQuality102RuntimeObservability,
  loadV12V4HpObservability,
};

export function createDecisionStatusGet(dependencies: DecisionStatusRouteDependencies = defaultDependencies) {
  return async function GET(req: NextRequest) {
    if (req.cookies.get("disdex_auth")?.value !== "1") return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, error: "ログインが必要です。" }, { status: 401, headers });
    try {
      const snapshot = await dependencies.loadDecisionStatus({ force: req.nextUrl.searchParams.get("refresh") === "1" });
      let v12Observability;
      try {
        v12Observability = await dependencies.loadV12DecisionObservability();
      } catch (observabilityError) {
        v12Observability = {
          ok: true as const,
          readOnly: true as const,
          tradingMutation: 0 as const,
          capturedAt: new Date().toISOString(),
          decisionDetailsAvailable: false,
          decision: null,
          runnerState: null,
          sharedRisk: null,
          executionTrace: {
            currentStage: "unavailable",
            currentStageLabel: "候補データ未取得",
            summary: "実Runnerの詳細観測を取得できませんでした。",
            nextAction: "VPS状態ファイルとUIサービスの接続を確認してください。",
            steps: [{ key: "candidate", label: "1. 候補選定", state: "unknown" as const, detail: observabilityError instanceof Error ? observabilityError.message : "観測データ取得失敗" }],
          },
          v12Positions: [],
          recentFills: [],
          wiring: { runnerStateConfigured: false, decisionSnapshotConfigured: false },
          errors: [observabilityError instanceof Error ? observabilityError.message : "V12 observability failed."],
          warnings: [],
        };
      }
      const [v52Top2Observability, penguRuntime, quality102Runtime, v12V4] = await Promise.all([
        dependencies.loadV52Top2Observability(),
        dependencies.loadPenguRuntimeObservability(),
        dependencies.loadQuality102RuntimeObservability(),
        dependencies.loadV12V4HpObservability(),
      ]);
      const body = overlayDecisionStatusRuntime(snapshot, { v12Observability, v52Top2Observability, penguRuntime, quality102Runtime, v12V4 });
      return NextResponse.json(body, { headers });
    } catch (error) {
      return NextResponse.json({ ok: false, status: "UNAVAILABLE", needsReview: true, readOnly: true, tradingMutation: 0, error: error instanceof Error ? error.message : "判定データを取得できません。" }, { headers, status: 503 });
    }
  };
}

export const GET = createDecisionStatusGet();
