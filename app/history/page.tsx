"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCw, CalendarDays } from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { displayTradePnlUsd } from "@/lib/trade-pnl";

type TradeHistoryEntry = {
  id: string;
  executedAt: string;
  walletId: string;
  walletAddress: string;
  chainId: number;
  txHash: string;
  provider?: string;
  action: "BUY" | "SELL";
  sourceSymbol: string;
  destSymbol: string;
  sourceAmount: number;
  destAmount: number;
  sourceUsdValue: number;
  destUsdValue: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  reason: string;
  openedAt?: string;
  closedAt?: string;
  tradeStatus?: "open" | "closed" | "unmatched_exit";
  positionVerified?: boolean;
  positionSide?: "BOTH" | "LONG" | "SHORT";
  strategyId?: "V12" | "V52" | "PENGU" | "QUALITY102" | "UNKNOWN";
  commission?: number;
  netPnlUsd?: number;
};

function formatNumber(value?: number, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatUsd(value?: number, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `$${formatNumber(value, digits)}`;
}

function explorerTxUrl(chainId: number, txHash: string) {
  if (chainId === 56) return `https://bscscan.com/tx/${txHash}`;
  if (chainId === 137) return `https://polygonscan.com/tx/${txHash}`;
  if (chainId === 1) return `https://etherscan.io/tx/${txHash}`;
  return `https://bscscan.com/tx/${txHash}`;
}

function hasExplorerTx(entry: Pick<TradeHistoryEntry, "provider" | "txHash">) {
  if (entry.provider === "AsterDex") return false;
  return /^0x[a-fA-F0-9]{32,}$/.test(entry.txHash);
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<TradeHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);

  const loadEntries = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system/trade-history", { cache: "no-store" });
      if (!response.ok) throw new Error("履歴の読み込みに失敗しました。");
      const data = await response.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setHistoryNotice(typeof data.historyNotice === "string" ? data.historyNotice : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "履歴の読み込みに失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, []);

  const visibleEntries = useMemo(
    () => entries.filter((entry) => Number(entry.sourceAmount || 0) > 0.0000001 || Number(entry.destAmount || 0) > 0.0000001),
    [entries],
  );

  const summary = useMemo(() => {
    const sells = visibleEntries
      .map((entry) => ({ entry, pnlUsd: displayTradePnlUsd(entry) }))
      .filter(({ entry, pnlUsd }) => entry.tradeStatus === "closed" && pnlUsd !== undefined);
    const realizedPnlUsd = sells.reduce((sum, { pnlUsd }) => sum + Number(pnlUsd || 0), 0);
    const wins = sells.filter(({ pnlUsd }) => Number(pnlUsd || 0) > 0).length;
    const walletAddress = visibleEntries[0]?.walletAddress || "-";

    return {
      walletAddress,
      totalTrades: visibleEntries.length,
      realizedPnlUsd,
      winRate: sells.length > 0 ? (wins / sells.length) * 100 : 0,
    };
  }, [visibleEntries]);

  const handleExport = () => {
    const headers = [
      "executedAt",
      "walletAddress",
      "action",
      "sourceSymbol",
      "destSymbol",
      "sourceAmount",
      "destAmount",
      "sourceUsdValue",
      "destUsdValue",
      "entryPriceUsd",
      "exitPriceUsd",
      "realizedPnlUsd",
      "realizedPnlPct",
      "txHash",
    ];

    const rows = visibleEntries.map((entry) =>
      [
        entry.executedAt,
        entry.walletAddress,
        entry.action,
        entry.sourceSymbol,
        entry.destSymbol,
        entry.sourceAmount,
        entry.destAmount,
        entry.sourceUsdValue,
        entry.destUsdValue,
        entry.entryPriceUsd ?? "",
        entry.exitPriceUsd ?? "",
        displayTradePnlUsd(entry) ?? "",
        entry.realizedPnlPct ?? "",
        entry.txHash,
      ].join(","),
    );

    const csvContent = `data:text/csv;charset=utf-8,${[headers.join(","), ...rows].join("\n")}`;
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = "disdex-trade-history.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-transparent">
            トレード履歴
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            約定履歴と、ローカル ledger ベースの概算損益を時系列で確認できます。
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/performance"
            className="flex items-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-sm text-gold-300 transition-colors hover:bg-gold-500/20"
          >
            <CalendarDays className="h-4 w-4" />
            日別損益カレンダー
          </Link>
          <button
            onClick={() => void loadEntries()}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            再読み込み
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-sm text-gold-300 transition-colors hover:bg-gold-500/20"
          >
            <Download className="h-4 w-4" />
            CSV出力
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card glow="gold" noHover>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">対象口座</div>
          <div className="mt-2 break-all font-mono text-sm text-white">{summary.walletAddress}</div>
        </Card>
        <Card glow="gold" noHover>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">取引件数</div>
          <div className="mt-2 text-2xl font-semibold text-white">{summary.totalTrades}</div>
        </Card>
        <Card glow="gold" noHover>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">確定損益（手数料後）</div>
          <div className={`mt-2 text-2xl font-semibold ${summary.realizedPnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {formatUsd(summary.realizedPnlUsd)}
          </div>
        </Card>
        <Card glow="gold" noHover>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">勝率</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(summary.winRate, 1)}%</div>
        </Card>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        Asterの約定履歴を基準に表示し、約定手数料が取得できる取引はnet PnL（手数料控除後）で統一しています。funding、未実現損益、入出金は含みません。
      </div>

      {historyNotice ? (
        <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          {historyNotice}
        </div>
      ) : null}

      <Card title="約定一覧" glow="gold">
        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-3 py-3">日時</th>
                <th className="px-3 py-3">売買</th>
                <th className="px-3 py-3">通貨</th>
                <th className="px-3 py-3">数量</th>
                <th className="px-3 py-3">取得単価</th>
                <th className="px-3 py-3">売却単価</th>
                <th className="px-3 py-3">損益額</th>
                <th className="px-3 py-3">損益率</th>
                <th className="px-3 py-3">Tx</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 align-top text-gray-200">
                  <td className="px-3 py-4 font-mono text-xs text-gray-300">
                    {new Date(entry.executedAt).toLocaleString("ja-JP")}
                  </td>
                  <td className="px-3 py-4 text-xs text-white/70">{entry.tradeStatus === "closed" ? "\u6c7a\u6e08\u6e08\u307f" : entry.tradeStatus === "open" && entry.positionVerified !== false ? "\u5efa\u7389\u7167\u5408\u6e08\u307f" : entry.tradeStatus === "open" ? "\u904e\u53bb\u5c65\u6b74\uff08\u73fe\u4fdd\u6709\u306a\u3057\uff09" : "\u7167\u5408\u4e0d\u4e00\u81f4"}</td>
                  <td className={`px-3 py-4 font-semibold ${entry.action === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                    {entry.action === "BUY" ? "買い" : "売り"}
                  </td>
                  <td className="px-3 py-4">
                    <div className="font-semibold text-white">
                      {entry.destSymbol} / {entry.sourceSymbol}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{entry.reason}</div>
                  </td>
                  <td className="px-3 py-4 font-mono text-xs">
                    <div>
                      {formatNumber(entry.sourceAmount, 6)} {entry.sourceSymbol}
                    </div>
                    <div className="mt-1 text-gray-500">
                      → {formatNumber(entry.destAmount, 6)} {entry.destSymbol}
                    </div>
                  </td>
                  <td className="px-3 py-4 font-mono text-xs text-white">{formatUsd(entry.entryPriceUsd, 4)}</td>
                  <td className="px-3 py-4 font-mono text-xs text-white">{formatUsd(entry.exitPriceUsd, 4)}</td>
                  <td
                    className={`px-3 py-4 font-mono text-xs font-semibold ${
                      Number(displayTradePnlUsd(entry) || 0) > 0
                        ? "text-emerald-400"
                      : Number(displayTradePnlUsd(entry) || 0) < 0
                          ? "text-red-400"
                          : "text-gray-500"
                    }`}
                  >
                    {formatUsd(displayTradePnlUsd(entry))}
                  </td>
                  <td
                    className={`px-3 py-4 font-mono text-xs font-semibold ${
                      Number(entry.realizedPnlPct || 0) > 0
                        ? "text-emerald-400"
                        : Number(entry.realizedPnlPct || 0) < 0
                          ? "text-red-400"
                          : "text-gray-500"
                    }`}
                  >
                    {entry.realizedPnlPct !== undefined ? `${formatNumber(entry.realizedPnlPct, 2)}%` : "-"}
                  </td>
                  <td className="px-3 py-4 font-mono text-xs">
                    {hasExplorerTx(entry) ? (
                      <a
                        href={explorerTxUrl(entry.chainId, entry.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-gold-300 hover:text-gold-200"
                      >
                        {entry.txHash.slice(0, 8)}...{entry.txHash.slice(-6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-white/75">
                        {entry.provider || "venue"} / {entry.txHash.slice(0, 18)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && visibleEntries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-sm text-gray-500">
                    表示できるトレード履歴がありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
