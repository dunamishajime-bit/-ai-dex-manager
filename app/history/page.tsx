Exit code: 0
Wall time: 1 seconds
Output:
"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";

import { Card } from "@/components/ui/Card";

type TradeHistoryEntry = {
  id: string;
  executedAt: string;
  walletAddress: string;
  action: "BUY" | "SELL";
  sourceSymbol: string;
  destSymbol: string;
  sourceAmount: number;
  destAmount: number;
  realizedPnlUsd?: number;
  fillPriceUsd?: number;
  txHash: string;
  provider?: string;
  reason: string;
  commission?: number;
  commissionAsset?: string;
};

function formatNumber(value?: number, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return value.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

function formatUsd(value?: number, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `$${formatNumber(value, digits)}`;
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<TradeHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [officialHistory, setOfficialHistory] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const loadEntries = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system/trade-history", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "AsterDEX公式履歴を取得できません。");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setOfficialHistory(data.officialHistory === true);
      setRefreshedAt(typeof data.refreshedAt === "string" ? data.refreshedAt : null);
      if (data.readOnlyError) setError(String(data.readOnlyError));
    } catch (loadError) {
      setEntries([]);
      setOfficialHistory(false);
      setError(loadError instanceof Error ? loadError.message : "AsterDEX公式履歴を取得できません。");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, []);

  const summary = useMemo(() => {
    const realized = entries.filter((entry) => typeof entry.realizedPnlUsd === "number");
    const pnl = realized.reduce((sum, entry) => sum + Number(entry.realizedPnlUsd || 0), 0);
    const wins = realized.filter((entry) => Number(entry.realizedPnlUsd || 0) > 0).length;
    return {
      fills: entries.length,
      pnl,
      winRate: realized.length ? (wins / realized.length) * 100 : undefined,
      account: entries[0]?.walletAddress || "-",
    };
  }, [entries]);

  const handleExport = () => {
    const headers = ["executedAt", "account", "action", "symbol", "quantity", "fillPriceUsd", "realizedPnlUsd", "commission", "commissionAsset", "orderOrTradeId"];
    const rows = entries.map((entry) => [
      entry.executedAt,
      entry.walletAddress,
      entry.action,
      `${entry.destSymbol}/${entry.sourceSymbol}`,
      entry.destAmount,
      entry.fillPriceUsd ?? "",
      entry.realizedPnlUsd ?? "",
      entry.commission ?? "",
      entry.commissionAsset ?? "",
      entry.txHash,
    ].join(","));
    const link = document.createElement("a");
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent([headers.join(","), ...rows].join("\n"))}`;
    link.download = "asterdex-official-trade-history.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="panel-gold rounded-[28px] p-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/72">DISTerminal / History</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="gold-heading text-3xl font-black">AsterDEX公式トレード履歴</h1>
            <p className="mt-2 text-sm leading-6 text-white/72">AsterDEXの公式約定履歴だけを表示します。ローカルtrade ledgerへの代替や約定価格の再計算は行いません。</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void loadEntries()} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white">
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> 更新
            </button>
            <button onClick={handleExport} disabled={!officialHistory || entries.length === 0} className="inline-flex items-center gap-2 rounded-full border border-gold-400/25 bg-gold-400/10 px-4 py-2 text-sm font-semibold text-gold-100 disabled:opacity-40">
              <Download className="h-4 w-4" /> CSV
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full border px-3 py-1.5 ${officialHistory ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-amber-400/30 bg-amber-500/10 text-amber-100"}`}>
            {officialHistory ? "AsterDEX公式データ" : "公式データ未確認"}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-white/65">確認時刻: {refreshedAt ? new Date(refreshedAt).toLocaleString("ja-JP") : "未確認"}</span>
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Card glow="gold" noHover><div className="text-xs text-white/55">公式約定数</div><div className="mt-2 text-2xl font-black text-white">{summary.fills}</div></Card>
        <Card glow="gold" noHover><div className="text-xs text-white/55">公式実現損益</div><div className={`mt-2 text-2xl font-black ${summary.pnl >= 0 ? "text-emerald-300" : "text-red-300"}`}>{summary.pnl ? formatUsd(summary.pnl) : "-"}</div></Card>
        <Card glow="gold" noHover><div className="text-xs text-white/55">損益確認率</div><div className="mt-2 text-2xl font-black text-white">{summary.winRate === undefined ? "-" : `${formatNumber(summary.winRate, 1)}%`}</div></Card>
        <Card glow="gold" noHover><div className="text-xs text-white/55">Aster口座</div><div className="mt-2 break-all font-mono text-xs text-white">{summary.account}</div></Card>
      </div>

      <Card title="公式約定一覧" glow="gold">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs text-white/55"><tr><th className="px-3 py-3">日時</th><th className="px-3 py-3">売買</th><th className="px-3 py-3">銘柄</th><th className="px-3 py-3">数量</th><th className="px-3 py-3">公式約定価格</th><th className="px-3 py-3">公式実現損益</th><th className="px-3 py-3">注文/約定ID</th></tr></thead>
            <tbody>
              {entries.map((entry) => <tr key={entry.id} className="border-b border-white/5 text-white/82"><td className="px-3 py-3 font-mono text-xs">{new Date(entry.executedAt).toLocaleString("ja-JP")}</td><td className={`px-3 py-3 font-bold ${entry.action === "BUY" ? "text-emerald-300" : "text-red-300"}`}>{entry.action === "BUY" ? "買い" : "売り"}</td><td className="px-3 py-3"><div className="font-semibold text-white">{entry.destSymbol}/{entry.sourceSymbol}</div><div className="mt-1 text-xs text-white/45">{entry.reason}</div></td><td className="px-3 py-3 font-mono text-xs">{formatNumber(entry.destAmount, 8)}</td><td className="px-3 py-3 font-mono text-xs">{formatUsd(entry.fillPriceUsd, 8)}</td><td className="px-3 py-3 font-mono text-xs">{formatUsd(entry.realizedPnlUsd, 6)}</td><td className="px-3 py-3 font-mono text-xs text-white/65">{entry.txHash}</td></tr>)}
              {!isLoading && entries.length === 0 ? <tr><td colSpan={7} className="px-3 py-12 text-center text-sm text-white/55">{officialHistory ? "AsterDEX公式の約定履歴はありません。" : "AsterDEX公式履歴を取得できないため、推測値は表示していません。"}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

