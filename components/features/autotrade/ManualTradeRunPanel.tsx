"use client";

import { useState } from "react";
import { Play, RefreshCw, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

type ManualWalletResult = {
  status: "skipped" | "noop" | "traded" | "error";
  reason: string;
  currentSymbol: string;
  desiredSymbol: string;
};

type ManualRunResponse = {
  ok: boolean;
  summary?: {
    triggerLabel?: string;
    executedAt: string;
    decisionTime: string;
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    reason: string;
    walletResults: ManualWalletResult[];
  };
  error?: string;
};

function sideLabel(side?: "trend" | "range" | "cash") {
  if (side === "trend") return "トレンド";
  if (side === "range") return "レンジ";
  if (side === "cash") return "待機";
  return "-";
}

function summarizeCounts(results: ManualWalletResult[] = []) {
  return results.reduce(
    (acc, item) => {
      if (item.status === "traded") acc.traded += 1;
      if (item.status === "noop") acc.noop += 1;
      if (item.status === "skipped") acc.skipped += 1;
      if (item.status === "error") acc.error += 1;
      return acc;
    },
    { traded: 0, noop: 0, skipped: 0, error: 0 },
  );
}

export function ManualTradeRunPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ManualRunResponse | null>(null);

  async function runManualDecision() {
    if (running) return;
    setRunning(true);
    setResult(null);

    try {
      const res = await fetch("/api/system/auto-trade/manual-run", {
        method: "POST",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ManualRunResponse | null;
      const next = json || { ok: false, error: "手動トレード判定の結果を読み取れませんでした。" };
      setResult(next);

      if (next.ok) {
        window.dispatchEvent(new Event("auto-trade-history-refresh"));
        window.dispatchEvent(new Event("auto-trade-live-decision-refresh"));
      }
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "手動トレード判定の実行に失敗しました。",
      });
    } finally {
      setRunning(false);
    }
  }

  const counts = summarizeCounts(result?.summary?.walletResults);

  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Zap className="h-4 w-4 text-gold-100" />
            手動トレード判定
          </div>
          <p className="mt-2 max-w-3xl text-[12px] leading-6 text-white/76">
            12Hの自動売買ロジックを、今このタイミングで1回だけ実行します。条件が揃っていればそのまま発注し、
            結果は自動売買実行履歴に「手動トレード判定」として残します。
          </p>
          <p className="mt-1 text-[11px] leading-5 text-white/58">
            手動でエントリーしたポジションも、次回の12H定期判定では通常の12Hエントリーポジションとして扱います。
          </p>
        </div>
        <button
          type="button"
          onClick={runManualDecision}
          disabled={running}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm font-black transition",
            running
              ? "cursor-wait border-white/10 bg-white/[0.04] text-white/50"
              : "border-gold-400/45 bg-gold-400/15 text-gold-50 hover:border-gold-300/70 hover:bg-gold-400/24",
          )}
        >
          {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "判定中..." : "今すぐ12H判定を実行"}
        </button>
      </div>

      {result ? (
        <div
          className={cn(
            "mt-4 rounded-[18px] border px-4 py-4 text-sm",
            result.ok ? "border-profit/30 bg-profit/10 text-white" : "border-loss/35 bg-loss/10 text-loss",
          )}
        >
          {result.ok && result.summary ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-gold-400/30 bg-gold-400/10 px-2.5 py-1 text-[10px] font-bold text-gold-100">
                  {result.summary.triggerLabel || "手動トレード判定"}
                </span>
                <span className="font-bold text-white">
                  {result.summary.desiredSymbol} / {sideLabel(result.summary.desiredSide)}
                </span>
                <span className="text-white/70">
                  発注 {counts.traded} / 維持 {counts.noop} / 見送り {counts.skipped} / エラー {counts.error}
                </span>
              </div>
              <div className="text-[12px] leading-6 text-white/78">
                判定時刻: {new Date(result.summary.decisionTime).toLocaleString("ja-JP")} / 実行時刻:{" "}
                {new Date(result.summary.executedAt).toLocaleString("ja-JP")}
              </div>
              {result.summary.walletResults[0]?.reason ? (
                <div className="text-[12px] leading-6 text-white/78">結果: {result.summary.walletResults[0].reason}</div>
              ) : null}
            </div>
          ) : (
            <div>{result.error || "手動トレード判定の実行に失敗しました。"}</div>
          )}
        </div>
      ) : null}
    </section>
  );
}
