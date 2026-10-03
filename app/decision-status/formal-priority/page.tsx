"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";

type StatusResponse = {
  ok: boolean;
  releaseSha?: string;
  formalContract?: {
    v12: { rank12Gross: number; dogeLtcRank12Gross: number; rank3Gross: number; rank3ResidualOnly: boolean; cooldown: string };
    q102: { handoffFamilies: string[]; noHandoffFamilies: string[]; victimOrder: string[] };
    formalBt: {
      model: string; roundtripBps: number; finalEquityJpy: number; profitFactor: number;
      maxDrawdownPct: number; winRatePct: number; trades: number; accounting: string;
    };
  };
  live?: {
    v12Mode?: string | null;
    v12RuntimeSha?: string | null;
    activePositions?: Array<{ symbol?: string; side?: string; gross?: number; entryRank?: number }>;
    symbolLastExitTs?: Record<string, number>;
    symbolCooldownUntilTs?: Record<string, number>;
    lastPriorityHandoff?: {
      family?: string; symbol?: string; victimRank?: number; quantity?: number; freedGross?: number;
      actualExitTs?: number; reason?: string; clientOrderId?: string;
    } | null;
    pending?: unknown;
    manualReview?: string | null;
    q102RuntimeSha?: string | null;
    q102Pending?: unknown;
  };
  updatedAt?: number;
  error?: string;
};

function fmtJpy(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
}
function fmtTime(value?: number) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ja-JP");
}

export default function FormalPriorityDecisionPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/system/formal-priority-status", { cache: "no-store" });
      setData(await response.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const cooldownRows = useMemo(() => {
    const exits = data?.live?.symbolLastExitTs || {};
    const until = data?.live?.symbolCooldownUntilTs || {};
    return Array.from(new Set([...Object.keys(exits), ...Object.keys(until)]))
      .sort()
      .map((symbol) => ({ symbol, exitTs: exits[symbol], untilTs: until[symbol] }));
  }, [data]);

  const contract = data?.formalContract;
  const live = data?.live;

  return (
    <main className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/positions" className="inline-flex items-center gap-2 text-sm text-gold-200 hover:text-gold-100">
            <ArrowLeft className="h-4 w-4" />
            ダッシュボードへ戻る
          </Link>
          <h1 className="mt-2 text-2xl font-black text-white md:text-3xl">Formal Priority / Cooldown</h1>
          <p className="mt-2 text-sm text-white/65">V12 Gross、Q102 handoff、symbol別cooldown、正式10bps BTを同じ画面で確認します。</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          更新
        </button>
      </div>

      {!data?.ok ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {data?.error || "Formal Priority statusを取得できませんでした。"}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="panel-gold rounded-2xl p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-100/70">Release</div>
          <div className="mt-2 break-all font-mono text-xs text-white">{data?.releaseSha || "-"}</div>
        </div>
        <div className="panel-gold rounded-2xl p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-100/70">V12 Mode</div>
          <div className="mt-2 text-xl font-black text-white">{live?.v12Mode || "-"}</div>
          <div className="mt-1 text-xs text-white/60">runtime {live?.v12RuntimeSha?.slice(0, 12) || "-"}</div>
        </div>
        <div className="panel-gold rounded-2xl p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-100/70">Pending</div>
          <div className="mt-2 text-xl font-black text-white">{live?.pending || live?.q102Pending ? "あり" : "なし"}</div>
        </div>
        <div className="panel-gold rounded-2xl p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-100/70">Manual Review</div>
          <div className="mt-2 text-sm font-black text-white">{live?.manualReview || "なし"}</div>
        </div>
      </section>

      {contract ? (
        <>
          <section className="grid gap-3 xl:grid-cols-2">
            <div className="panel-gold rounded-2xl p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Activity className="h-4 w-4 text-gold-100" />
                V12 Gross契約
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs text-white/60">Rank1 / Rank2</div>
                  <div className="mt-1 text-xl font-black text-white">{contract.v12.rank12Gross.toFixed(2)}x</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs text-white/60">DOGE / LTC Rank1/2</div>
                  <div className="mt-1 text-xl font-black text-white">{contract.v12.dogeLtcRank12Gross.toFixed(2)}x</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs text-white/60">Rank3 residual</div>
                  <div className="mt-1 text-xl font-black text-white">{contract.v12.rank3Gross.toFixed(2)}x</div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/65">5x Crossは証拠金設定であり、戦略GrossやBT損益を5倍化しません。</p>
            </div>

            <div className="panel-gold rounded-2xl p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <ShieldCheck className="h-4 w-4 text-gold-100" />
                Q102 → V12 handoff
              </div>
              <div className="mt-3 space-y-2 text-sm text-white/80">
                <div>許可: <span className="font-bold text-profit">{contract.q102.handoffFamilies.join(" / ")}</span></div>
                <div>V12を閉じない: <span className="font-bold text-white">{contract.q102.noHandoffFamilies.join(" / ")}</span></div>
                <div>victim順: <span className="font-bold text-gold-100">{contract.q102.victimOrder.join(" → ")}</span></div>
              </div>
              {live?.lastPriorityHandoff ? (
                <div className="mt-3 rounded-xl border border-gold-400/20 bg-gold-400/10 p-3 text-xs leading-5 text-white/80">
                  最新: {live.lastPriorityHandoff.family} / {live.lastPriorityHandoff.symbol} / Rank{live.lastPriorityHandoff.victimRank}
                  <br />actual exit {fmtTime(live.lastPriorityHandoff.actualExitTs)}
                  <br />reason {live.lastPriorityHandoff.reason || "-"}
                </div>
              ) : (
                <div className="mt-3 text-xs text-white/55">まだQ102 priority handoff実績はありません。</div>
              )}
            </div>
          </section>

          <section className="panel-gold rounded-2xl p-4">
            <div className="text-sm font-bold text-white">symbol別 actual-exit + 2h cooldown</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-white/10 text-xs text-white/50">
                  <tr><th className="py-2">Symbol</th><th>Actual exit</th><th>Cooldown until</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {cooldownRows.map((row) => (
                    <tr key={row.symbol} className="border-b border-white/5">
                      <td className="py-3 font-bold text-white">{row.symbol}</td>
                      <td className="text-white/75">{fmtTime(row.exitTs)}</td>
                      <td className="text-white/75">{fmtTime(row.untilTs)}</td>
                      <td className={Number(row.untilTs || 0) > Date.now() ? "font-bold text-loss" : "font-bold text-profit"}>
                        {Number(row.untilTs || 0) > Date.now() ? "BLOCK" : "READY"}
                      </td>
                    </tr>
                  ))}
                  {cooldownRows.length === 0 ? (
                    <tr><td colSpan={4} className="py-5 text-center text-white/50">cooldown対象はありません。</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel-gold rounded-2xl p-4">
            <div className="text-sm font-bold text-white">正式10bps Formal BT</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div><div className="text-xs text-white/55">Final</div><div className="font-black text-white">{fmtJpy(contract.formalBt.finalEquityJpy)}</div></div>
              <div><div className="text-xs text-white/55">PF</div><div className="font-black text-white">{contract.formalBt.profitFactor.toFixed(4)}</div></div>
              <div><div className="text-xs text-white/55">Max DD</div><div className="font-black text-white">{contract.formalBt.maxDrawdownPct.toFixed(2)}%</div></div>
              <div><div className="text-xs text-white/55">Win Rate</div><div className="font-black text-white">{contract.formalBt.winRatePct.toFixed(2)}%</div></div>
              <div><div className="text-xs text-white/55">Trades</div><div className="font-black text-white">{contract.formalBt.trades}</div></div>
            </div>
            <div className="mt-3 text-xs leading-5 text-white/55">
              H1 causal price-model formal BT / 10bps round trip / accounting {contract.formalBt.accounting}。historical L2 fill verificationではありません。
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
