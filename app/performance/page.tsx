Exit code: 0
Wall time: 0.3 seconds
Output:
"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";

import { useOperationalWallet } from "@/hooks/useOperationalWallet";

type OfficialFill = {
  realizedPnlUsd?: number;
  action: "BUY" | "SELL";
  executedAt: string;
};

type HistoryResponse = {
  ok?: boolean;
  entries?: OfficialFill[];
  officialHistory?: boolean;
  readOnlyError?: string;
  error?: string;
};

export default function PerformancePage() {
  const { asterAccount } = useOperationalWallet();
  const [fills, setFills] = useState<OfficialFill[]>([]);
  const [official, setOfficial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/system/trade-history", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as HistoryResponse;
        if (!response.ok || data.ok !== true) {
          throw new Error(data.error || "AsterDEX公式履歴を取得できません。");
        }
        if (cancelled) return;
        setFills(Array.isArray(data.entries) ? data.entries : []);
        setOfficial(data.officialHistory === true);
        setError(data.readOnlyError || null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setFills([]);
        setOfficial(false);
        setError(reason instanceof Error ? reason.message : "AsterDEX公式履歴を取得できません。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const realized = useMemo(
    () => fills.filter((fill) => typeof fill.realizedPnlUsd === "number"),
    [fills],
  );
  const pnl = realized.reduce((sum, fill) => sum + Number(fill.realizedPnlUsd), 0);
  const wins = realized.filter((fill) => Number(fill.realizedPnlUsd) > 0).length;
  const available = asterAccount?.status === "available";

  return (
    <main className="space-y-4 rounded-[28px] border border-gold-400/16 bg-[#03050a] p-4 text-white md:p-6">
      <header className="panel-gold rounded-[28px] p-5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-gold-100/72">
          <BarChart3 className="h-4 w-4" /> Performance
        </div>
        <h1 className="gold-heading mt-2 text-3xl font-black">成績</h1>
        <p className="mt-2 text-sm leading-6 text-white/72">
          Current Portfolioと成績統計はAsterDEX公式残高・公式約定を元に表示します。
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric title="Current Portfolio" value={available ? `$${Number(asterAccount?.portfolioUsd).toFixed(2)}` : "取得不能"} note="AsterDEX公式口座" />
        <Metric title="Official Fills" value={official ? String(fills.length) : "未確認"} note="ローカルledger不使用" />
        <Metric title="Realized PnL" value={official && realized.length ? `$${pnl.toFixed(4)}` : "-"} note="Aster公式値のみ" />
        <Metric title="Win Rate" value={official && realized.length ? `${((wins / realized.length) * 100).toFixed(1)}%` : "-"} note="公式実現損益のある約定" />
      </section>

      {error ? <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/70">
        公式データが取得できないときは「取得不能」と表示し、ローカルtrade ledgerの概算値でCurrent Portfolioや損益を埋めません。
      </div>
    </main>
  );
}

function Metric({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="panel-gold rounded-[22px] p-4">
      <div className="text-xs text-white/55">{title}</div>
      <div className="mt-2 text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs text-white/55">{note}</div>
    </div>
  );
}

