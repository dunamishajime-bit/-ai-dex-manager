"use client";

import { ListTree } from "lucide-react";

import { useV12V4HpStatus } from "@/hooks/useV12V4HpStatus";
import { V12_V4_HP_ROUTE_IDS } from "@/lib/v12-v4-hp-contract";

export function V12RouteInventoryPanel() {
  const { snapshot, loading, error } = useV12V4HpStatus();
  const observed = new Set(
    snapshot
      ? V12_V4_HP_ROUTE_IDS.filter((route) => !snapshot.routeCoverage.unobserved.includes(route))
      : [],
  );

  return (
    <section className="panel-gold min-w-0 rounded-[28px] p-4 md:p-5" data-testid="v12-route-inventory">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <ListTree className="h-4 w-4 shrink-0 text-sky-200" />
            V12 V4 ルート構成
          </div>
          <p className="mt-1 text-[11px] leading-5 text-white/55">
            実装ルート総数と、現在cycleのcandidate / filtered出力に実際に現れたrouteを分離して表示します。
          </p>
        </div>
        <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-3 py-1 text-xs font-black text-sky-100">
          実装 {V12_V4_HP_ROUTE_IDS.length} routes
        </span>
      </div>

      {snapshot ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-sky-400/20 bg-sky-500/[0.04] px-3 py-2">
              <div className="text-[10px] text-white/45">実装ルート総数</div>
              <div className="mt-1 text-xl font-black text-sky-100">{snapshot.routeCoverage.expected}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] text-white/45">今回cycle出力route</div>
              <div className="mt-1 text-sm font-bold text-white">{snapshot.routeCoverage.observed}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] text-white/45">Decision候補 / filtered</div>
              <div className="mt-1 text-sm font-bold text-white">
                {snapshot.routeCoverage.candidateCount ?? "—"} / {snapshot.routeCoverage.filteredCount ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.04] px-3 py-2">
              <div className="text-[10px] text-white/45">今回未出力route</div>
              <div className="mt-1 text-sm font-bold text-amber-100">{snapshot.routeCoverage.unobserved.length}</div>
              <div className="mt-0.5 text-[9px] text-white/40">未実装という意味ではありません</div>
            </div>
          </div>

          <details className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-white/75">
              実装41ルートをすべて表示（今回出力 {observed.size} / 未出力 {snapshot.routeCoverage.unobserved.length}）
            </summary>
            <div className="mt-2 grid min-w-0 gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {V12_V4_HP_ROUTE_IDS.map((route) => {
                const present = observed.has(route);
                return (
                  <div
                    key={route}
                    className={
                      present
                        ? "min-w-0 break-all rounded-lg border border-emerald-400/20 bg-emerald-500/[0.04] px-2 py-1.5 text-[10px] text-emerald-100"
                        : "min-w-0 break-all rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5 text-[10px] text-white/55"
                    }
                  >
                    <span className="mr-1 font-semibold">{present ? "今回出力" : "今cycle未出力"}</span>
                    {route}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-5 text-amber-100/70">
              「今cycle未出力」は、そのrouteが今回のDecision出力に現れていないという意味です。削除・未実装・評価失敗を意味しません。
            </p>
          </details>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-3 text-xs text-amber-100">
          {loading ? "V12 V4 route状態を取得中です。" : error || "route状態を取得できません。"}
        </div>
      )}
    </section>
  );
}
