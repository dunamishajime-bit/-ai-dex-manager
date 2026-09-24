"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, CheckCircle2, CircleDashed, RefreshCw, ShieldCheck } from "lucide-react";

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

function pct(value?: number) {
  return value === undefined || !Number.isFinite(value) ? "未取得" : (value * 100).toFixed(2) + "%";
}

function gateTone(pass: boolean) {
  return pass
    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
    : "border-rose-400/30 bg-rose-500/10 text-rose-100";
}

/** Monitoring only: GET FET state and public market data; never calls a trading mutation endpoint. */
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
  const signal = snapshot?.signal;
  const heading = (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-base font-bold text-white">
        <Activity className="h-5 w-5 shrink-0 text-gold-100" />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">FET BRK48 LONG</span>
      </div>
      <span className={"max-w-full rounded-full border px-3 py-1 text-xs font-semibold " + statusTone(status)}>
        {statusName(status)}
      </span>
    </div>
  );

  if (compact) {
    return (
      <section className="panel-gold min-w-0 overflow-hidden rounded-[24px] p-4">
        {heading}
        <p className="mt-2 break-words text-xs leading-5 text-white/70 [overflow-wrap:anywhere]">
          {error || snapshot?.reason || "FET実stateを読込中です。"}
        </p>
        <div className="mt-2 grid min-w-0 gap-2 text-xs text-white/65 sm:grid-cols-3">
          <span className="min-w-0 break-words">最大Gross: {amount(snapshot?.maximumGross, "x")}</span>
          <span className="min-w-0 break-words">使用Gross: {amount(snapshot?.position?.gross, "x")}</span>
          <span className="min-w-0 break-words">BRK48 Gate: {signal?.signalEligible ? "成立" : signal?.available ? "待機" : "未取得"}</span>
        </div>
        <Link href="/decision-status/fet" className="mt-3 inline-flex max-w-full break-words text-xs font-bold text-gold-100 hover:underline">
          FETの判定・損益・建玉詳細を見る →
        </Link>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <section className="panel-gold min-w-0 overflow-hidden rounded-[28px] p-4 md:p-5">
        {heading}
        <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3 text-xs text-white/60">
          <span className="flex min-w-0 items-start gap-2 break-words [overflow-wrap:anywhere]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            読み取り専用 / 発注・取消・建玉変更なし
          </span>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 hover:bg-white/[0.06]">
            <RefreshCw className="h-4 w-4 shrink-0" />再読込
          </button>
        </div>
        <p className="mt-3 break-words rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm leading-6 text-white/80 [overflow-wrap:anywhere]">
          {error || snapshot?.reason || "FET実stateを読込中です。"}
        </p>

        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
            ["現在のBRK48判定", signal?.signalEligible ? "LONG発火条件成立" : signal?.available ? "WAIT" : "未取得"],
            ["次回判定", date(signal?.nextDecisionAt)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
              <div className="text-[10px] text-white/45">{label}</div>
              <div className="mt-1 min-w-0 break-words text-sm font-semibold text-white/85 [overflow-wrap:anywhere]">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-gold min-w-0 overflow-hidden rounded-[28px] p-4 md:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-black text-white [overflow-wrap:anywhere]">FET BRK48 LONG 現在判定</h2>
            <p className="mt-1 break-words text-xs leading-5 text-white/55 [overflow-wrap:anywhere]">
              本番configの閾値とAster公開1時間足から、発注を行わずに現在の3つのGateを再計算します。
            </p>
          </div>
          <span className={"max-w-full rounded-full border px-3 py-1 text-xs font-bold " + (signal?.signalEligible ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : "border-white/15 bg-white/[0.04] text-white/70")}>
            {signal?.signalEligible ? "LONG READY" : "WAIT"}
          </span>
        </div>

        <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-3">
          {(signal?.gates || []).map((gate) => (
            <article key={gate.key} className={"min-w-0 rounded-2xl border p-4 " + gateTone(gate.pass)}>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 break-words font-bold [overflow-wrap:anywhere]">{gate.label}</div>
                {gate.pass ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <CircleDashed className="h-5 w-5 shrink-0" />}
              </div>
              <div className="mt-3 min-w-0 break-words text-lg font-black [overflow-wrap:anywhere]">{gate.value}</div>
              <div className="mt-2 min-w-0 break-words text-[11px] opacity-75 [overflow-wrap:anywhere]">基準: {gate.threshold}</div>
              <p className="mt-2 min-w-0 break-words text-xs leading-5 opacity-90 [overflow-wrap:anywhere]">{gate.reason}</p>
            </article>
          ))}
          {signal && !signal.gates.length ? (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100 lg:col-span-3">
              {signal.signalReason}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/45">Breakout距離</div>
            <div className="mt-2 break-words text-xl font-black text-white">{pct(signal?.breakoutDistancePct)}</div>
            <div className="mt-1 break-words text-[11px] text-white/45">Close {amount(signal?.latestClose)} / 48h High {amount(signal?.prior48hHigh)}</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/45">Volume Ratio</div>
            <div className="mt-2 break-words text-xl font-black text-white">{amount(signal?.volumeRatio, "x")}</div>
            <div className="mt-1 break-words text-[11px] text-white/45">必要 {amount(signal?.minimumVolumeRatio, "x")} / 過去72h中央値基準</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/45">保有時間 / 初期STOP</div>
            <div className="mt-2 break-words text-xl font-black text-white">{signal?.holdHours ?? "—"}h / {pct(signal?.hardStopPct)}</div>
            <div className="mt-1 break-words text-[11px] text-white/45">新規約定後の基本保護</div>
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-white/45">利益保護</div>
            <div className="mt-2 break-words text-xl font-black text-white">+{pct(signal?.profitFloorTriggerPct)} → +{pct(signal?.profitFloorStopPct)}</div>
            <div className="mt-1 break-words text-[11px] text-white/45">利益到達後にSTOPを利益側へ引上げ</div>
          </div>
        </div>

        <p className="mt-4 min-w-0 break-words rounded-xl border border-sky-400/15 bg-sky-400/[0.05] px-3 py-2 text-xs leading-5 text-white/65 [overflow-wrap:anywhere]">
          判定結果: {signal?.signalReason || "公開market data判定を取得中です。"} / Reference: {date(signal?.referenceTs)}
        </p>
      </section>

      <section className="panel-gold min-w-0 overflow-hidden rounded-[28px] p-4 md:p-5">
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
            <h3 className="text-sm font-bold text-white">FET建玉・保護STOP</h3>
            {snapshot?.position ? (
              <div className="mt-3 min-w-0 space-y-2 break-words text-sm text-white/75 [overflow-wrap:anywhere]">
                <p>数量: {snapshot.position.quantity} FET / 方向: LONG</p>
                <p>エントリー: {amount(snapshot.position.entryPrice, " USDT")}</p>
                <p>Hard Stop: {amount(snapshot.position.hardStop, " USDT")}</p>
                <p>Gross: {amount(snapshot.position.gross, "x")}</p>
                <p>予定終了: {date(snapshot.position.exitTs)}</p>
                <p>Protection mode: {snapshot.position.protectionMode || "未取得"}</p>
                <p>Profit floor armed: {snapshot.position.profitFloorArmedAt ? date(snapshot.position.profitFloorArmedAt) : "未発動 / 未取得"}</p>
                <p>保護注文ID記録: {snapshot.position.stopOrderIdRecorded ? "あり（Aster実注文の照合は別途必要）" : "なし・要確認"}</p>
              </div>
            ) : (
              <p className="mt-3 break-words text-sm text-white/60">{snapshot ? "FETの保有建玉はstateに記録されていません。" : "取得待ち"}</p>
            )}
          </div>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
            <h3 className="text-sm font-bold text-white">注文・判定の注意</h3>
            <p className="mt-3 break-words text-sm leading-6 text-white/75 [overflow-wrap:anywhere]">
              {snapshot?.pending
                ? "未解決注文: " + snapshot.pending.action + " / " + snapshot.pending.reason
                : "Pending注文: " + (snapshot ? "記録なし" : "未取得")}
            </p>
            <p className="mt-3 break-words text-xs leading-6 text-amber-100/80 [overflow-wrap:anywhere]">
              LIVE表示には最新stateとrunner-healthのservice identity確認が必要です。NRestarts=0・Aster実建玉・reduceOnly保護注文のread-backは別途必要です。
              この画面では未検証項目をLIVE完了とみなしません。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
