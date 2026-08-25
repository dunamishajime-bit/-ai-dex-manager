import { NextRequest, NextResponse } from "next/server";
import { loadDecisionStatus } from "@/lib/server/disdex-decision-status";
import { loadV12DecisionObservability } from "@/lib/server/v12-decision-observability";
import { loadV52Top2Observability } from "@/lib/server/v52-top2-observability";
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
    const v52Top2Observability = await loadV52Top2Observability();
    return NextResponse.json({ ...snapshot, v12Observability, v52Top2Observability }, { headers: { "Cache-Control": "private, no-store" } });
  }
  catch (error) { return NextResponse.json({ ok: false, readOnly: true, error: error instanceof Error ? error.message : "判定データを取得できません。" }, { status: 503 }); }
}
