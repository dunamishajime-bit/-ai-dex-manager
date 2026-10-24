"use client";

import { Activity, CheckCircle2, Clock3, ServerCog, ShieldAlert } from "lucide-react";

import { useProductionRuntime } from "@/hooks/useProductionRuntime";
import { useV12V4HpStatus } from "@/hooks/useV12V4HpStatus";
import type { CurrentProductionRuntime } from "@/lib/server/current-production-runtime";
import type { V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";

function shortSha(value?: string | null) {
  return value ? `${value.slice(0, 8)}…` : "未取得";
}

function formatTime(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "未取得";
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("ja-JP") : "未取得";
}

function runtimeLabel(snapshot: CurrentProductionRuntime | null, loading: boolean) {
  if (loading && !snapshot) return "確認中";
  return snapshot?.status === "LIVE" && snapshot.runtimeLineage.synchronized ? "LIVE確認済み" : "未取得 / 要確認";
}

function v4Label(snapshot: V12V4HpSnapshot | null, loading: boolean) {
  if (loading && !snapshot) return "確認中";
  return snapshot?.displayStatus === "LIVE_VERIFIED" ? "LIVE確認済み" : snapshot?.displayStatus || "未取得";
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-1 break-words text-sm font-bold text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/55">{detail}</div>
    </div>
  );
}

export function ProductionRuntimeSummary() {
  const runtime = useProductionRuntime();
  const v4 = useV12V4HpStatus();
  const snapshot = runtime.snapshot;
  const v4Snapshot = v4.snapshot;
  const lineage = snapshot?.runtimeLineage;
  const orderEnabled = v4Snapshot?.actual.orderEnabled;
  const entryReady = orderEnabled === true && v4Snapshot.freshness.heartbeat && v4Snapshot.freshness.decision && v4Snapshot.displayStatus === "LIVE_VERIFIED";

  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5" aria-label="Current production runtime summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white">
            <ServerCog className="h-5 w-5 text-gold-100" />
            VPS実稼働ランタイム
          </div>
          <p className="mt-2 text-xs leading-5 text-white/55">
            `current`系譜、V4観測、上限、route出現数、heartbeatを読み取り専用で表示します。未取得・不一致・古い観測はLIVEと推測しません。
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${snapshot ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-rose-400/30 bg-rose-500/10 text-rose-100"}`}>
          {runtimeLabel(snapshot, runtime.loading)}
        </span>
      </div>

      {runtime.error ? <div className="mt-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-100">runtime: {runtime.error}</div> : null}
      {v4.error ? <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">V4観測: {v4.error}</div> : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="release SHA" value={shortSha(snapshot?.releaseSha)} detail={`確認時刻: ${formatTime(snapshot?.checkedAt)}`} />
        <Metric label="lineage" value={lineage?.synchronized === true ? "同期済み" : "未取得 / 要確認"} detail={lineage ? `${Object.values(lineage.units).filter((unit) => unit.matchesCurrent).length}/${Object.keys(lineage.units).length} unit が current と一致` : "静的値は表示しません"} />
        <Metric label="effective total gross" value={snapshot ? `${snapshot.caps.totalGross.toFixed(2)}x` : "未取得"} detail={snapshot ? `Crypto ${snapshot.caps.cryptoGross.toFixed(2)}x / Stock ${snapshot.caps.stockGross.toFixed(2)}x` : "runtime caps unavailable"} />
        <Metric label="V4 process/runtime" value={v4Label(v4Snapshot, v4.loading)} detail={v4Snapshot?.actual.activeRunnerState || "未取得"} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="新規エントリー readiness" value={entryReady ? "観測上の条件内" : "Fail Closed / 要確認"} detail={`orderEnabled=${orderEnabled === true ? "true" : orderEnabled === false ? "false" : "未取得"}`} />
        <Metric label="route coverage" value={v4Snapshot ? `${v4Snapshot.routeCoverage.observed}/${v4Snapshot.routeCoverage.expected}` : "未取得"} detail={v4Snapshot ? "emitted route presence only" : "V4観測 unavailable"} />
        <Metric label="heartbeat freshness" value={v4Snapshot?.freshness.heartbeat === true ? "fresh" : "stale / 未取得"} detail={`更新: ${formatTime(v4Snapshot?.timestamps.heartbeatUpdatedAt)}`} />
        <Metric label="decision freshness" value={v4Snapshot?.freshness.decision === true ? "fresh" : "stale / 未取得"} detail={`判定: ${formatTime(v4Snapshot?.timestamps.decisionTs)}`} />
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/70">
          <div className="flex items-center gap-2 font-bold text-white"><Activity className="h-4 w-4 text-gold-100" />V4 process と entry readiness は別の観測です</div>
          <p className="mt-2">process/runtime: {v4Snapshot?.actual.activeRunnerState || "未取得"} / displayStatus: {v4Snapshot?.displayStatus || "UNAVAILABLE"}</p>
          <p>新規エントリー: {entryReady ? "観測上の条件内" : "Fail Closed（process稼働だけでは許可しない）"}</p>
          <p>active runner SHA: {shortSha(v4Snapshot?.actual.activeRunnerSha)} / heartbeat SHA: {shortSha(v4Snapshot?.actual.heartbeatSha)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/70">
          <div className="flex items-center gap-2 font-bold text-white"><Clock3 className="h-4 w-4 text-gold-100" />lineage units</div>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {lineage ? (Object.entries(lineage.units) as Array<[string, CurrentProductionRuntime["runtimeLineage"]["units"][keyof CurrentProductionRuntime["runtimeLineage"]["units"]]]>).map(([name, unit]) => (
              <span key={name} className="inline-flex items-center justify-between gap-2 rounded-lg border border-white/8 px-2 py-1"><span>{name}</span><span className={unit.matchesCurrent ? "text-emerald-200" : "text-rose-200"}>{unit.matchesCurrent ? "一致" : "要確認"}</span></span>
            )) : <span className="text-rose-200">runtime lineage unavailable; manual review required</span>}
          </div>
        </div>
      </div>

      {!snapshot && !runtime.loading ? <div className="mt-3 flex items-center gap-2 text-xs text-rose-100"><ShieldAlert className="h-4 w-4" />古いstatic contract値へのfallbackはありません。</div> : null}
      {snapshot && lineage?.synchronized ? <div className="mt-3 flex items-center gap-2 text-xs text-emerald-100"><CheckCircle2 className="h-4 w-4" />current runtime lineageを確認済みです。</div> : null}
    </section>
  );
}
