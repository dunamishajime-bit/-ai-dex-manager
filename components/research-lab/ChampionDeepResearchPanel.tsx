"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import type { ResearchDashboardPayload } from "@/lib/research-lab/dashboard-types";

const REFRESH_MS = 60_000;

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}pt`;
}

function slotLabel(value: "oos" | "stress" | "stability") {
  if (value === "stress") return "STRESS CHAMPION";
  if (value === "stability") return "STABILITY CHAMPION";
  return "OOS CHAMPION";
}

function causeLabel(value: string) {
  const labels: Record<string, string> = {
    low_return: "月利不足",
    stable_but_low_return: "低DDだが利幅不足",
    oos_decay: "OOS劣化",
    cost_fragility: "コスト耐性不足",
    drawdown_risk: "DD・清算リスク",
    direction_bias: "Long/Short偏り",
    low_sample: "取引数不足",
  };
  return labels[value] ?? value;
}

export default function ChampionDeepResearchPanel() {
  const [payload, setPayload] = useState<ResearchDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/research-lab/latest", { cache: "no-store" });
      const body = await response.json() as ResearchDashboardPayload & { error?: string; detail?: string };
      if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
      setPayload(body);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const inheritedExperimentIds = useMemo(() => {
    const winners = new Map<string, { id: string; score: number }>();
    for (const experiment of payload?.deepResearch?.experiments ?? []) {
      if (!experiment.accepted) continue;
      const current = winners.get(experiment.championSlot);
      if (!current || experiment.compositeImprovement > current.score) {
        winners.set(experiment.championSlot, { id: experiment.id, score: experiment.compositeImprovement });
      }
    }
    return new Set([...winners.values()].map((item) => item.id));
  }, [payload]);

  if (loading && !payload) {
    return (
      <section className="rounded-[24px] border border-violet-400/15 bg-violet-500/[0.04] p-5">
        <div className="flex items-center gap-3 text-sm text-white/65">
          <RefreshCw className="h-4 w-4 animate-spin text-violet-200" />
          Champion Deep Researchを読み込んでいます…
        </div>
      </section>
    );
  }

  const deep = payload?.deepResearch;
  if (!deep) {
    return (
      <section className="rounded-[24px] border border-violet-400/15 bg-violet-500/[0.04] p-5">
        <div className="flex items-start gap-3">
          <BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-violet-200" />
          <div>
            <h2 className="font-black text-white">Champion Deep Research</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">
              新方式の最初のCycle完了後、上位3ロジック、根本原因、単一変更仮説、親子比較、採否がここに表示されます。
            </p>
            {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-[26px] border border-violet-400/20 bg-[linear-gradient(180deg,rgba(30,20,55,0.58),rgba(5,7,13,0.95))] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-200" />
            <h2 className="text-xl font-black text-white md:text-2xl">
              {deep.mode === "win80_ultra90_lineage" ? "Win80 / Ultra90 Main-Lineage Research" : "Champion Deep Research Loop"}
            </h2>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/60">
            {deep.mode === "win80_ultra90_lineage"
              ? "現在のメイン戦略を固定したまま、厳選Top-1・Ultra90級シグナル・低回転Rotationの近縁ロジックだけを親子比較します。研究結果は自動で本番へ昇格しません。"
              : "上位3ロジックを親として再評価し、各実験は1パラメータだけ変更します。改善基準を複数案が通っても、各Championで最も総合改善が大きい子1件だけを次Cycleへ継承します。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-violet-300/20 bg-violet-500/10 px-3 py-2 text-violet-100">Cycle {deep.cycle}</span>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-white/65">Champion {deep.championCount}</span>
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-white/65">実験 {deep.experimentCount}</span>
          <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-amber-100">基準通過 {deep.acceptedExperiments}</span>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-emerald-100">継承 {inheritedExperimentIds.size}</span>
        </div>
      </div>

      {deep.researchFocus ? (
        <div className="rounded-[20px] border border-emerald-300/20 bg-emerald-500/[0.055] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black tracking-[0.16em] text-emerald-200/80">PRODUCTION MAIN LOCKED</div>
              <div className="mt-1 text-sm font-black text-white">{deep.researchFocus.mainStrategyId}</div>
              <p className="mt-2 text-xs leading-5 text-white/60">
                メインロジックは変更せず、研究系統だけを改善します。採用された子もForward Paper候補までで、自動昇格は無効です。
              </p>
            </div>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-100">
              MAIN FIXED / AUTO PROMOTION OFF
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {deep.researchFocus.researchTracks.map((track) => (
              <div key={track} className="rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-[11px] leading-5 text-white/60">{track}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-3">
        {deep.champions.map((champion) => (
          <article key={`${champion.slot}-${champion.id}`} className="rounded-[20px] border border-white/8 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold tracking-[0.16em] text-violet-200/75">{slotLabel(champion.slot)}</div>
                <h3 className="mt-1 break-all text-sm font-black text-white">{champion.id}</h3>
                <p className="mt-1 text-[11px] text-white/45">{champion.family}</p>
              </div>
              <ShieldCheck className="h-5 w-5 shrink-0 text-violet-200" />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {champion.rootCauses.map((cause) => (
                <span key={cause} className="rounded-full border border-amber-300/15 bg-amber-500/8 px-2 py-1 text-[10px] text-amber-100/80">
                  {causeLabel(cause)}
                </span>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-white/8 px-3 py-2"><span className="block text-white/35">OOS月利</span><b className="text-white">{pct(champion.metrics.oosMonthlyPct)}</b></div>
              <div className="rounded-xl border border-white/8 px-3 py-2"><span className="block text-white/35">Worst Stress</span><b className="text-white">{pct(champion.metrics.worstStressMonthlyPct)}</b></div>
              <div className="rounded-xl border border-white/8 px-3 py-2"><span className="block text-white/35">OOS MaxDD</span><b className="text-white">{pct(champion.metrics.oosMaxDrawdownPct)}</b></div>
              <div className="rounded-xl border border-white/8 px-3 py-2"><span className="block text-white/35">Walk-forward</span><b className="text-white">{pct(champion.metrics.walkForwardPassRatePct)}</b></div>
              <div className="rounded-xl border border-white/8 px-3 py-2"><span className="block text-white/35">OOS取引</span><b className="text-white">{champion.metrics.oosTrades}</b></div>
              <div className="rounded-xl border border-white/8 px-3 py-2"><span className="block text-white/35">Profit Factor</span><b className="text-white">{champion.metrics.profitFactor.toFixed(2)}</b></div>
            </div>
            <p className="mt-3 text-[10px] text-white/40">改善なし継続Cycle: {champion.noImprovementCycles}</p>
          </article>
        ))}
      </div>

      <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-violet-200" />
          <h3 className="font-black text-white">今回の単一変更実験と親子比較</h3>
        </div>
        <div className="mt-4 space-y-3">
          {deep.experiments.map((experiment) => {
            const inherited = inheritedExperimentIds.has(experiment.id);
            const passedButNotInherited = experiment.accepted && !inherited;
            const cardClass = inherited
              ? "border-emerald-400/20 bg-emerald-500/[0.055]"
              : passedButNotInherited
                ? "border-amber-400/20 bg-amber-500/[0.045]"
                : "border-white/8 bg-white/[0.02]";
            const badgeClass = inherited
              ? "border-emerald-300/25 bg-emerald-500/10 text-emerald-100"
              : passedButNotInherited
                ? "border-amber-300/25 bg-amber-500/10 text-amber-100"
                : "border-rose-300/20 bg-rose-500/8 text-rose-100";
            const badgeLabel = inherited
              ? "継承採用"
              : passedButNotInherited
                ? "基準通過・上位子を優先"
                : "子を却下・親維持";
            return (
              <article key={experiment.id} className={`rounded-[18px] border p-4 ${cardClass}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-[0.12em] text-white/45">
                      <span>{slotLabel(experiment.championSlot)}</span>
                      <span>•</span>
                      <span>{experiment.changedParameter}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-white">
                      <span className="break-all">{experiment.parentStrategyId}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-white/35" />
                      <span className="break-all">{experiment.childStrategyId}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/60">{experiment.hypothesis}</p>
                  </div>
                  <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black ${badgeClass}`}>
                    {inherited || passedButNotInherited ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {badgeLabel}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-xs text-white/65">
                  <b className="text-white">変更:</b> {experiment.changedParameter}　{experiment.beforeValue} → {experiment.afterValue}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-xl border border-white/8 px-3 py-2 text-[11px]"><span className="block text-white/35">OOS差</span><b className={experiment.deltaOosMonthlyPct >= 0 ? "text-emerald-200" : "text-rose-200"}>{signedPct(experiment.deltaOosMonthlyPct)}</b></div>
                  <div className="rounded-xl border border-white/8 px-3 py-2 text-[11px]"><span className="block text-white/35">Stress差</span><b className={experiment.deltaWorstStressMonthlyPct >= 0 ? "text-emerald-200" : "text-rose-200"}>{signedPct(experiment.deltaWorstStressMonthlyPct)}</b></div>
                  <div className="rounded-xl border border-white/8 px-3 py-2 text-[11px]"><span className="block text-white/35">DD改善</span><b className={experiment.deltaDrawdownImprovementPct >= 0 ? "text-emerald-200" : "text-rose-200"}>{signedPct(experiment.deltaDrawdownImprovementPct)}</b></div>
                  <div className="rounded-xl border border-white/8 px-3 py-2 text-[11px]"><span className="block text-white/35">総合改善</span><b className="text-white">{experiment.compositeImprovement.toFixed(3)}</b></div>
                </div>

                <div className="mt-3 text-[11px] leading-5 text-white/45">{experiment.reasons.join(" / ")}</div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
        <h3 className="font-black text-white">次Cycleの深掘り方針</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {deep.nextPlan.map((item) => (
            <div key={item} className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-xs leading-5 text-white/60">
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
