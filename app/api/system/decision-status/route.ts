import { NextRequest, NextResponse } from "next/server";
import { loadDecisionStatus } from "@/lib/server/disdex-decision-status";
import { loadV12DecisionObservability } from "@/lib/server/v12-decision-observability";
import { loadV52Top2Observability } from "@/lib/server/v52-top2-observability";
import { loadPenguRuntimeObservability } from "@/lib/server/pengu-runtime-observability";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (req.cookies.get("disdex_auth")?.value !== "1") return NextResponse.json({ ok: false, readOnly: true, error: "ログインが必要です。" }, { status: 401 });
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
      };
    }
    const [v52Top2Observability, penguRuntime] = await Promise.all([
      loadV52Top2Observability(),
      loadPenguRuntimeObservability(),
    ]);
    const v12UpdatedAt = v12Observability.runnerState?.updatedAt;
    const v12Fresh = v12Observability.wiring.runnerStateConfigured && v12UpdatedAt !== undefined && Date.now() - v12UpdatedAt <= 3 * 60 * 60 * 1000 && v12Observability.runnerState?.mode?.toLowerCase() === "live" && v12Observability.runnerState.killSwitch?.active !== true;
    const v12Status = !v12Observability.wiring.runnerStateConfigured ? "UNAVAILABLE" : v12Fresh ? "LIVE" : "STALE";
    const runtime = {
      ...snapshot.runtime,
      units: snapshot.runtime.units.map((unit) => {
        if (unit.id === "V12_X1.00_ALL") return { ...unit, status: v12Status as typeof unit.status, updatedAt: v12UpdatedAt, reason: v12Fresh ? "V12 runner state更新済み、mode=LIVE、Kill Switch inactiveを確認しました。" : v12Observability.errors[0] || "V12 runner stateが未接続・停止・古いためLIVE確認できません。" };
        if (unit.id === "PENGU_DUAL_LS_V2_FINAL") return { ...unit, status: penguRuntime.status, updatedAt: penguRuntime.updatedAt, reason: penguRuntime.reason };
        return { ...unit, status: v52Top2Observability.status === "LIVE" ? "LIVE" : v52Top2Observability.status === "STALE" ? "STALE" : "UNAVAILABLE", updatedAt: v52Top2Observability.updatedAt, reason: v52Top2Observability.errors[0] || v52Top2Observability.reason || (v52Top2Observability.status === "LIVE" ? "V52 runner state更新済み、Kill Switch inactiveを確認しました。" : "V52 runner stateがLIVE確認条件を満たしていません。") };
      }),
    };
    return NextResponse.json({ ...snapshot, runtime, v12Observability, v52Top2Observability, penguRuntime }, { headers: { "Cache-Control": "private, no-store" } });
  }
  catch (error) { return NextResponse.json({ ok: false, readOnly: true, error: error instanceof Error ? error.message : "判定データを取得できません。" }, { status: 503 }); }
}
