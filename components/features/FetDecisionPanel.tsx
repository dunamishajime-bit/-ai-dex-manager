"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, RefreshCw, ShieldCheck } from "lucide-react";

import type { FetRuntimeStatus } from "@/lib/server/fet-runtime-observability";

function statusName(status?: FetRuntimeStatus["status"]) {
  if (status === "LIVE") return "LIVE state更新確認";
  if (status === "STALE") return "要確認（更新停止）";
  if (status === "UNCONFIRMED") return "要確認";
  return "未取得";
}

function statusTone(status?: FetRuntimeStatus["status"]) {
  if (status === "LIVE") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (status === "STALE" || status === "UNCONFIRMED") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  return "border-rose-400/35 bg-rose-500/10 text-rose-100";
}

function date(value?: number | string) {
  if (value === undefined) return "未取得";
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString("ja-JP") : "未取得";
}

function amount(value?: number, suffix = "") {
  return value === undefined || !Number.isFinite(value) ? "未取得" : value.toFixed(4) + suffix;
}

/** Monitoring only: GET FET state; never calls a trading mutation endpoint. */
export function FetDecisionPanel({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<FetRuntimeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/system/fet-status", { cache: "no-store" });
        const data = await response.json() as FetRuntimeStatus & { error?: string };
        if (!response.ok || !data.readOnly) throw new Error(data.error || "FET稼働状態を取得できません。");
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (failure) {
        if (!cancelled) {
          setSnapshot(null);
          setError(failure instanceof Error ? failure.message : "FET稼働状態を取得できません。");
        }
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 30_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [refreshKey]);

  const status = snapshot?.status;
  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-base font-bold text-white">
        <Activity className="h-5 w-5 text-gold-100" />FET BRK48 LONG
      </div>
      <span className={"rounded-full border px-3 py-1 text-xs font-semibold " + statusTone(status)}>
        {statusName(status)}
      </span>
    </div>
  );

  if (compact) {
    return (
      <section className="panel-gold rounded-[24px] p-4">
        {heading}
        <p className="mt-2 text-xs leading-5 text-white/70">
          {error || snapshot?.reason || "FET実stateを読込中です。"}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-white/65">
          <span>最大Gross: {amount(snapshot?.maximumGross, "x")}</span>
          <span>使用Gross: {amount(snapshot?.position?.gross, "x")}</span>
          <span>state更新: {date(snapshot?.updatedAt)}</span>
        </div>
        <Link href="/decision-status/fet" className="mt-3 inline-flex text-xs font-bold text-gold-100 hover:underline">
          FETの判定・建玉詳細を見る →
        </Link>
      </section>
    );
  }

  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      {heading}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/60">
        <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />読み取り専用 / 発注・取消・建玉変更なし</span>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/[0.06]">
          <RefreshCw className="h-4 w-4" />再読込
        </button>
      </div>
      <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-white/80">
        {error || snapshot?.reason || "FET実stateを読込中です。"}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["戦略", snapshot?.strategyId || "FET_BRK48_RESIDUAL"],
          ["通貨 / 方向", "FETUSDT / LONGのみ"],
          ["最大Gross（本番設定）", amount(snapshot?.maximumGross, "x")],
          ["実建玉Gross", snapshot?.position ? amount(snapshot.position.gross, "x") : snapshot ? "建玉stateなし" : "未取得"],
          ["state更新", date(snapshot?.updatedAt)],
          ["runner-health更新", date(snapshot?.heartbeatAt)],
          ["service identity", snapshot?.serviceUnit || "未取得"],
          ["runner-health", snapshot?.heartbeatSafetyState || "未取得"],
          ["最終処理足", date(snapshot?.lastReferenceTs)],
          ["本番SHA", snapshot?.expectedRuntimeSha?.slice(0, 12) || "未取得"],
          ["FET state SHA", snapshot?.runtimeCommitSha?.slice(0, 12) || "未取得"],
          ["Kill Switch", snapshot?.killSwitchActive === false ? "inactive" : snapshot?.killSwitchActive ? "ACTIVE" : "未取得"],
          ["Operator確認", snapshot?.manualReview || "記録なし"],
          ["Pending", snapshot?.pending?.action || "記録なし"],
          ["最新シグナル", "runner stateに詳細記録なし / 推測しません"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <div className="text-[10px] text-white/45">{label}</div>
            <div className="mt-1 break-words text-sm font-semibold text-white/85">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-bold text-white">FET建玉・保護STOP</h3>
          {snapshot?.position ? (
            <div className="mt-3 space-y-2 text-sm text-white/75">
              <p>数量: {snapshot.position.quantity} FET / 方向: LONG</p>
              <p>エントリー: {amount(snapshot.position.entryPrice, " USDT")}</p>
              <p>Hard Stop: {amount(snapshot.position.hardStop, " USDT")}</p>
              <p>Gross: {amount(snapshot.position.gross, "x")}</p>
              <p>予定終了: {date(snapshot.position.exitTs)}</p>
              <p>保護注文ID記録: {snapshot.position.stopOrderIdRecorded ? "あり（Aster実注文の照合は別途必要）" : "なし・要確認"}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/60">{snapshot ? "FETの保有建玉はstateに記録されていません。" : "取得待ち"}</p>
          )}
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-bold text-white">注文・判定の注意</h3>
          <p className="mt-3 text-sm leading-6 text-white/75">
            {snapshot?.pending
              ? "未解決注文: " + snapshot.pending.action + " / " + snapshot.pending.reason
              : "Pending注文: " + (snapshot ? "記録なし" : "未取得")}
          </p>
          <p className="mt-3 text-xs leading-6 text-amber-100/80">
            LIVE表示には最新stateとrunner-healthのservice identity確認が必要です。NRestarts=0・Aster実建玉・reduceOnly保護注文のread-backは別途必要です。
            この画面では未検証項目をLIVE完了とみなしません。
          </p>
        </div>
      </div>
    </section>
  );
}
