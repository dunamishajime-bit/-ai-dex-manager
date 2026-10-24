import { NextRequest, NextResponse } from "next/server";
import { loadDecisionStatus } from "@/lib/server/disdex-decision-status";
import { loadV12DecisionObservability } from "@/lib/server/v12-decision-observability";
import { loadV52Top2Observability } from "@/lib/server/v52-top2-observability";
import { loadPenguRuntimeObservability } from "@/lib/server/pengu-runtime-observability";
import { loadQuality102RuntimeObservability } from "@/lib/server/quality102-runtime-observability";
import { loadV12V4HpObservability } from "@/lib/server/v12-v4-hp-observability";
import { isFreshRuntimeTimestamp, isRuntimeLineageUnitHealthy, RUNNER_FRESHNESS_MS } from "@/lib/server/current-production-runtime";
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

export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, error: "ログインが必要です。" }, { status: 401, headers });
  try {
    const snapshot = await loadDecisionStatus({ force: req.nextUrl.searchParams.get("refresh") === "1" });
    let v12Observability;
    try {
      v12Observability = await loadV12DecisionObservability();
    } catch (observabilityError) {
      v12Observability = {
        ok: true,
        readOnly: true,
        tradingMutation: 0,
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
          steps: [{ key: "candidate", label: "1. 候補選定", state: "unknown", detail: observabilityError instanceof Error ? observabilityError.message : "観測データ取得失敗" }],
        },
        v12Positions: [],
        recentFills: [],
        wiring: { runnerStateConfigured: false, decisionSnapshotConfigured: false },
        errors: [observabilityError instanceof Error ? observabilityError.message : "V12 observability failed."],
        warnings: [],
      };
    }
    const [v52Top2Observability, penguRuntime, quality102Runtime, v12V4] = await Promise.all([
      loadV52Top2Observability(),
      loadPenguRuntimeObservability(),
      loadQuality102RuntimeObservability(),
      loadV12V4HpObservability(),
    ]);
    const v12UpdatedAt = v12Observability.runnerState?.updatedAt;
    const v12Fresh = v12Observability.wiring.runnerStateConfigured && isV12RuntimeFresh({ runtime: snapshot.productionRuntime ?? null, runnerState: v12Observability.runnerState, now: Date.now() });
    const v12Status = !snapshot.productionRuntime || !v12Observability.wiring.runnerStateConfigured ? "UNAVAILABLE" : v12Fresh ? "LIVE" : "STALE";
    const runtime = {
      ...snapshot.runtime,
      units: snapshot.runtime.units.map((unit) => {
        if (unit.id === "V12_X1.00_ALL") return { ...unit, status: v12Status as typeof unit.status, updatedAt: v12UpdatedAt, reason: v12Fresh ? "V12 runner state更新済み、mode=LIVE、Kill Switch inactive、current runtime SHA一致を確認しました。" : snapshot.productionRuntime ? v12Observability.errors[0] || "V12 runner stateが未接続・停止・古い、またはruntime SHA/lineageが不一致のためLIVE確認できません。" : "Current production runtime lineage unavailable; V12は要確認です。" };
        if (unit.id === "PENGU_DUAL_LS_V2_FINAL") return { ...unit, status: penguRuntime.status, updatedAt: penguRuntime.updatedAt, reason: penguRuntime.reason };
        if (unit.id === "QUALITY102_CAUSAL_V1") return { ...unit, status: quality102Runtime.status, updatedAt: quality102Runtime.updatedAt, reason: quality102Runtime.reason };
        if (!snapshot.v52.marketOpen) return { ...unit, status: "UNCONFIRMED" as const, updatedAt: v52Top2Observability.updatedAt, reason: "米国株式市場の対象時間外です。V52は市場時間外のため意図的停止で、新規判定・発注は行いません。" };
        return { ...unit, status: v52Top2Observability.status === "LIVE" ? "LIVE" : v52Top2Observability.status === "STALE" ? "STALE" : "UNAVAILABLE", updatedAt: v52Top2Observability.updatedAt, reason: v52Top2Observability.errors[0] || v52Top2Observability.reason || (v52Top2Observability.status === "LIVE" ? "V52 runner state更新済み、Kill Switch inactiveを確認しました。" : "V52 runner stateがLIVE確認条件を満たしていません。") };
      }),
    };
    return NextResponse.json({ ...snapshot, runtime, v12V4, v12Observability, v52Top2Observability, penguRuntime, quality102Runtime }, { headers });
  }
  catch (error) { return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, error: error instanceof Error ? error.message : "判定データを取得できません。" }, { headers, status: 503 }); }
}
