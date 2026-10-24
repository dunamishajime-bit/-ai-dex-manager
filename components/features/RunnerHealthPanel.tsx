"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, HelpCircle, RefreshCw } from "lucide-react";

type Unit = {
  id: string;
  name: string;
  group: "runner" | "guard";
  state: "RUNNING" | "FAILED" | "INACTIVE" | "UNKNOWN";
  activeState: string;
  subState: string;
  result: string;
  exitCode: number | null;
  pid: number | null;
  restarts: number;
  runtimeSha: string | null;
  shaSource: string;
};
type Status = {
  ok: true;
  source: "VPS_CURRENT_SYSTEMD";
  checkedAt: string;
  releaseSha: string;
  units: Unit[];
};

const stateText: Record<Unit["state"], string> = {
  RUNNING: "起動中",
  FAILED: "異常停止",
  INACTIVE: "停止中",
  UNKNOWN: "確認不能",
};
function colorClass(state: Unit["state"]) {
  if (state === "RUNNING") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (state === "FAILED") return "border-rose-400/45 bg-rose-500/15 text-rose-100";
  return "border-amber-400/35 bg-amber-500/10 text-amber-100";
}

export function RunnerHealthPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch("/api/system/runner-health", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data.ok !== true || !Array.isArray(data.units)) {
          throw new Error(typeof data.error === "string" ? data.error : "稼働情報を取得できません");
        }
        if (mounted) { setStatus(data as Status); setError(null); }
      } catch (cause) {
        if (mounted) {
          setStatus(null);
          setError(cause instanceof Error ? cause.message : "稼働情報を取得できません");
        }
      } finally {
        busy = false;
        if (mounted) setLoading(false);
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);

  const units = status?.units ?? [];
  const liveRunners = units.filter((unit) => unit.group === "runner");
  const guards = units.filter((unit) => unit.group === "guard");
  const troubled = units.filter((unit) => unit.state !== "RUNNING");

  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5" aria-label="VPSランナー稼働状況">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-white">
            <Activity className="h-5 w-5 text-gold-100" />ランナー稼働状況
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-white/60">
            現行VPSリリースのsystemd実測。30秒更新。起動中と発注可能は別です。
          </p>
        </div>
        <Link href="/decision-status" className="rounded-full border border-gold-400/30 px-3 py-1.5 text-xs font-semibold text-gold-100 hover:bg-white/10">
          ロジック詳細・判定状況
        </Link>
      </div>
      {status ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-white/15 px-3 py-1.5 text-white/80">
              起動中 {liveRunners.filter((unit) => unit.state === "RUNNING").length}/{liveRunners.length}
            </span>
            <span className={"rounded-full border px-3 py-1.5 " + (troubled.length ? colorClass("FAILED") : colorClass("RUNNING"))}>
              問題・未確認 {troubled.length}件
            </span>
            <span className="px-1 py-1.5 text-white/55">最終取得 {new Date(status.checkedAt).toLocaleString("ja-JP")}</span>
          </div>
          {troubled.length > 0 && (
            <div role="alert" className="mt-3 rounded-xl border border-rose-400/35 bg-rose-500/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-rose-100">
                <AlertTriangle className="h-4 w-4" />要確認のランナー・保護機能
              </div>
              <p className="mt-1 text-xs leading-5 text-rose-100/85">
                {troubled.map((unit) => unit.name + "（" + stateText[unit.state] + (unit.result !== "success" ? " / " + unit.result : "") + "）").join("、")}
              </p>
            </div>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {liveRunners.map((unit) => (
              <div key={unit.id} className={"rounded-2xl border p-3 " + colorClass(unit.state)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{unit.name}</span>
                  {unit.state === "RUNNING" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </div>
                <div className="mt-2 text-lg font-black">{stateText[unit.state]}</div>
                <div className="mt-1 break-words text-[10px] leading-5 opacity-85">
                  SHA {unit.runtimeSha ? unit.runtimeSha.slice(0, 12) : "未取得"} / {unit.subState} / {unit.result} / PID {unit.pid ?? "—"}{unit.exitCode && unit.state !== "RUNNING" ? " / exit " + unit.exitCode : ""}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/70">
            {guards.map((unit) => (
              <span key={unit.id} className={"rounded-full border px-3 py-1.5 " + colorClass(unit.state)}>
                {unit.name}：{stateText[unit.state]}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <HelpCircle className="h-4 w-4" />}
          {loading ? "VPS実測値を取得しています…" : (error || "VPS状態を確認できません")}
        </div>
      )}
      <p className="mt-3 text-[10px] leading-5 text-white/50">
        各ランナーの実行中unit（V4停止時は実行時heartbeatの一致したrelease SHA）を参照します。過去リリースのfailedは集計しません。
        この画面では発注許可・Kill Switch・実約定の正常性を保証しません。
      </p>
    </section>
  );
}
