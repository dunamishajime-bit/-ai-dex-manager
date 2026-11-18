"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, AlertTriangle, ShieldAlert } from "lucide-react";

import type { LogicSnapshot, LogicRow } from "@/lib/server/current-live-logic-catalog";
import { classifyRunnerObservation } from "@/lib/runner-observation";

const POLL_MS = 45_000;

function statusLabel(row: LogicRow) {
  if (row.serviceState === "RUNNING") return "プロセス稼働";
  if (row.serviceState === "STOPPED") return "停止";
  if (row.serviceState === "SHA_MISMATCH") return "SHA不一致";
  return "実行状態未検証";
}
function statusStyle(row: LogicRow) {
  if (row.serviceState === "RUNNING") {
    return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  }
  return "border-amber-400/35 bg-amber-500/10 text-amber-100";
}
function timestamp(value?: number) {
  return value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未取得";
}

export function CurrentLogicPanel() {
  const [snapshot, setSnapshot] = useState<LogicSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const response = await fetch("/api/system/current-logic", {
          cache: "no-store", credentials: "same-origin",
        });
        const payload = await response.json() as LogicSnapshot & { error?: string };
        if (!response.ok || payload.ok !== true || !Array.isArray(payload.rows)) {
          throw new Error(payload.error || "現行ロジック情報が取得できません");
        }
        if (alive) {
          setSnapshot(payload);
          setError(null);
        }
      } catch (cause) {
        if (alive) {
          setSnapshot(null);
          setError(cause instanceof Error ? cause.message : "現行ロジック情報が取得できません");
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!snapshot) {
    return (
      <div className="text-xs text-amber-100" role="status">
        {error ? "現行ロジック詳細を取得できません: " + error : "現行Runnerとロジック詳細を照合中…"}
      </div>
    );
  }
  const running = snapshot.rows.filter((row) => row.serviceState === "RUNNING").length;
  const hold = snapshot.safety.holdActive;
  return (
    <div className="min-w-0 space-y-2 text-[11px] text-white/80">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-bold text-emerald-200">
          <Activity className="h-3.5 w-3.5" />
          現行ロジック（本番pin・実PID・heartbeat照合）
        </span>
        <span>プロセス稼働 {running} / 全 {snapshot.rows.length}</span>
        <span className={hold === true ? "font-semibold text-amber-200" : "text-white/65"}>
          {hold === true
            ? "共有HOLD有効（対象: " + (snapshot.safety.scope || "未検証") + "）"
            : hold === false ? "共有HOLD非アクティブ（取引許可は別判定）" : "共有HOLD未検証"}
        </span>
        <span className="text-white/50">確認 {timestamp(Date.parse(snapshot.checkedAt))}</span>
      </div>
      <div className="custom-scrollbar grid max-h-[230px] min-w-0 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3" aria-label="現行Runner別ロジック詳細">
        {snapshot.rows.map((row) => {
          const observed = classifyRunnerObservation(row, snapshot.safety, row.id !== "SHARED_CRYPTO_RISK" && row.id !== "MARGIN_GUARD");
          const localLabel = { FAULT: "停止検知", ATTENTION: "要確認", UNVERIFIED: "未検証", OBSERVED: "観測一致" }[observed.local];
          const protectionLabel = { BLOCK_REPORTED: "BLOCKを報告", SHARED_HOLD_REPORTED: "共有HOLDを観測（適用範囲は別判定）", AUTHORITY_UNVERIFIED: "取引許可未検証" }[observed.protection];
          const recoveryLabel = row.recovery ? {
            UNKNOWN: "未検証", ATTENTION: "異常継続", VERIFYING: "復旧確認中", HEALTHY_OBSERVED: "正常復帰検知",
          }[row.recovery.label] : undefined;
          return (
          <div key={row.id} className="min-w-0 rounded-xl border border-white/15 bg-black/25 p-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link href={row.href} className="font-bold text-white underline-offset-2 hover:underline">
                {row.title} <span className="text-white/45">詳細を見る</span>
              </Link>
              <span className={"rounded-md border px-2 py-0.5 text-[10px] " + statusStyle(row)}>
                {statusLabel(row)}
              </span>
            </div>
            <dl className="mt-2 grid gap-1 text-[10px]">
              <div className="flex flex-wrap items-center gap-2"><dt className="text-white/55">個別監視</dt><dd className={observed.local === "OBSERVED" ? "text-white/80" : "text-amber-200"}>{localLabel}</dd></div>
              {recoveryLabel ? <div className="flex flex-wrap items-center gap-2"><dt className="text-white/55">復旧確認</dt><dd className={row.recovery?.label === "HEALTHY_OBSERVED" ? "text-emerald-200" : "text-amber-200"}>{recoveryLabel}{row.recovery?.streak ? `（${row.recovery.streak}/3）` : ""}</dd></div> : null}
              <div className="flex flex-wrap items-center gap-2"><dt className="text-white/55">取引保護・許可</dt><dd className="text-amber-200">{protectionLabel}</dd></div>
            </dl>
            <p className="mt-1 break-words leading-5 text-white/75">{row.description}</p>
            {row.policy ? (
              <p className="mt-1 break-words font-medium text-amber-100">{row.policy}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-white/60">
              <span>正式SHA {row.pinSha ? row.pinSha.slice(0, 12) : "未検証"}</span>
              <span>PID {row.mainPid ?? "—"}</span>
              <span>heartbeat {row.heartbeatFresh ? "新鮮" : "古い/未取得"}</span>
            </div>
            {row.heartbeatAt ? (
              <p className="mt-0.5 text-[10px] text-white/50">最終観測 {timestamp(row.heartbeatAt)}</p>
            ) : null}
            {row.safetyState ? (
              <p className="mt-0.5 text-[10px] text-amber-200">判定保護状態: {row.safetyState}</p>
            ) : null}
            {row.decisionDetail ? (
              <p className="mt-1 break-words text-[10px] text-white/70">直近判定: {row.decisionDetail}</p>
            ) : null}
            {row.mismatchReason ? (
              <p className="mt-1 inline-flex items-start gap-1 break-words text-[10px] text-rose-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{row.mismatchReason}
              </p>
            ) : null}
            {row.healthReason ? (
              <p className="mt-0.5 break-words text-[10px] text-amber-200/80">
                保護理由: {row.healthReason}
              </p>
            ) : null}
          </div>
        ); })}
      </div>
      <p className="inline-flex items-center gap-1.5 text-[10px] text-white/55">
        <ShieldAlert className="h-3 w-3" />
        プロセス・個別監視・復旧観測と取引保護は別表示です。正常復帰検知は新しいheartbeatの3回連続観測を示すだけで、発注許可を意味しません。この画面は読み取り専用です。
      </p>
    </div>
  );
}

