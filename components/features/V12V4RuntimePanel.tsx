"use client";

import Link from "next/link";
import { Activity, RefreshCw, ShieldCheck } from "lucide-react";

import { useV12V4HpStatus } from "@/hooks/useV12V4HpStatus";
import { buildV12V4HpPresentation } from "@/lib/v12-v4-hp-ui";

function statusClass(status: ReturnType<typeof buildV12V4HpPresentation>["runtimeStatus"]) {
  if (status === "LIVE_VERIFIED") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (status === "STAGED_NOT_LIVE" || status === "SHADOW" || status === "STALE") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  return "border-rose-400/30 bg-rose-500/10 text-rose-100";
}

function timestamp(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toLocaleString("ja-JP") : "未取得";
}

export function V12V4RuntimePanel({ compact = false }: { compact?: boolean }) {
  const { snapshot, loading, error, refresh } = useV12V4HpStatus();
  const view = buildV12V4HpPresentation(snapshot, { loading, error });
  const actual = snapshot?.actual;

  if (compact) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-white/75" aria-live="polite" data-testid="v12-v4-runtime-badge">
        <span>V12 V4</span>
        <span className={`rounded-full border px-2 py-0.5 ${statusClass(view.runtimeStatus)}`}>{view.runtimeLabel}</span>
        {actual?.activeRunnerSha ? <span className="text-white/45">{actual.activeRunnerSha.slice(0, 8)}</span> : null}
      </span>
    );
  }

  return (
    <section className="panel-gold min-w-0 rounded-[28px] p-4 md:p-5" data-testid="v12-v4-runtime-panel">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 shrink-0 text-gold-100" />V12 V4 runtime</div>
          <p className="mt-1 text-xs leading-5 text-white/55">V4 target仕様と、VPSから読み取った実runtime状態を分けて表示します。旧V12 snapshotをV4状態として流用しません。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(view.runtimeStatus)}`}>{view.runtimeLabel}</span>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs text-white/75 disabled:opacity-50" aria-label="V12 V4状態を更新">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />更新
          </button>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-3">
          <div className="flex items-center gap-2 text-sm font-bold text-sky-100"><ShieldCheck className="h-4 w-4" />V4 target契約</div>
          <div className="mt-2 break-words text-xs leading-5 text-white/80">{view.target.policyId} / 41 routes</div>
          <p className="mt-2 text-[11px] leading-5 text-white/55">これは採用対象の仕様です。Productionで稼働中であることを示す表示ではありません。</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-sm font-bold text-white">実runtime（read-only）</div>
          <div className="mt-2 break-words text-xs leading-5 text-white/80">{view.actualSummary}</div>
          <div className="mt-2 grid gap-1 text-[11px] leading-5 text-white/60">
            <div>他ロジック共通 SHA: {actual?.currentReleaseSha ?? "未取得"}</div>
            <div>V12 V4専用 SHA: {actual?.activeRunnerSha ?? "未取得"}</div>
            <div>heartbeat: {timestamp(snapshot?.timestamps.heartbeatUpdatedAt)} / {snapshot?.freshness.heartbeat ? "fresh" : "未確認・stale"}</div>
            <div>decision: {timestamp(snapshot?.timestamps.decisionTs)} / {snapshot?.freshness.decision ? "fresh" : "未確認・stale"}</div>
            <div>V4 heartbeatのorderEnabled: {actual?.orderEnabled === null || actual?.orderEnabled === undefined ? "未取得" : actual.orderEnabled ? "true" : "false"}（参考値） / HPはread-only・tradingMutation=0</div>
            <div>発注可否は取引Runnerと実取引所側の安全Gateで判定します。HPのSHA表示だけで発注停止とは断定しません。</div>
          </div>
        </div>
      </div>

      {snapshot ? (
        <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] text-white/45">Decision候補 / filtered</div><div className="mt-1 text-sm font-bold text-white">{snapshot.routeCoverage.candidateCount ?? "—"} / {snapshot.routeCoverage.filteredCount ?? "—"}</div></div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] text-white/45">出力されたroute数</div><div className="mt-1 text-sm font-bold text-white">{snapshot.routeCoverage.observed} / {snapshot.routeCoverage.expected}</div></div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] text-white/45">V4 route coverage</div><div className="mt-1 text-xs font-semibold text-amber-100">評価完了率ではありません</div></div>
        </div>
      ) : <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">{error || (loading ? "V4 runtimeを取得中です。" : "V4 runtime未取得。LIVE状態は未確認です。")}</div>}

      {snapshot ? <div className="mt-4 min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><div className="text-sm font-bold text-white">V4実観測候補</div><p className="mt-1 text-[11px] leading-5 text-white/50">候補にnative scoreは含まれていないため、未提供の値を補完しません。route出力の観測であり、41 route全ての評価実行証明ではありません。</p></div>
          <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/55">{snapshot.candidates.length}候補 / {snapshot.filtered.length} filtered</span>
        </div>
        {snapshot.candidates.length ? <ul className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">{snapshot.candidates.map((candidate, index) => <li key={`${candidate.symbol}-${candidate.route}-${candidate.eligibleEntryTs ?? index}`} className="min-w-0 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.04] p-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="break-words text-sm font-bold text-white">{candidate.symbol} <span className="text-white/55">{candidate.side ?? "SIDE未取得"}</span></div><div className="mt-1 break-words text-[11px] text-white/60">{candidate.route}</div></div><span className="shrink-0 rounded-full border border-amber-300/20 px-2 py-0.5 text-[10px] text-amber-100">score {candidate.scoreLabel}</span></div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/45"><span>native rank {candidate.sourceRank ?? "未取得"}（HP順位対象外）</span><span>family {candidate.family ?? "未取得"}</span><span>判定時刻 {timestamp(candidate.eligibleEntryTs)}</span></div>
          {Object.keys(candidate.features).length ? <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-2 gap-y-1 text-[10px] sm:grid-cols-3">{Object.entries(candidate.features).map(([key, value]) => <div key={key} className="min-w-0 break-words"><dt className="text-white/40">{key}</dt><dd className="break-all text-white/75">{String(value)}</dd></div>)}</dl> : <div className="mt-2 text-[10px] text-white/45">source features未取得</div>}
        </li>)}</ul> : <div className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/55">{snapshot.freshness.decision ? "本日の観測範囲で候補出力なし" : "Decision source未freshのため候補なしとは判定できません"}</div>}
        {snapshot.filtered.length ? <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-white/65">filtered理由を表示（{snapshot.filtered.length}件）</summary><ul className="mt-2 grid min-w-0 gap-1 sm:grid-cols-2">{snapshot.filtered.map((row, index) => <li key={`${row.symbol}-${row.route}-${row.eligibleEntryTs ?? index}`} className="min-w-0 break-words rounded-lg border border-white/8 px-2 py-1.5 text-[10px] text-white/60">{row.symbol} / {row.side ?? "—"} / {row.route} / {row.reason} / {timestamp(row.eligibleEntryTs)}</li>)}</ul></details> : null}
      </div> : null}
      {snapshot?.errors.length ? <p className="mt-3 break-words text-[11px] leading-5 text-amber-100/80">観測注意: {snapshot.errors.length}件。詳細なsource error codeは認証済みAPIを確認してください。</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/50">
        <span>read-only / 注文・取消・建玉変更なし</span>
        <Link href="/decision-status/v12" className="text-gold-100 hover:text-white">V12 V4判定状況 →</Link>
      </div>
    </section>
  );
}
