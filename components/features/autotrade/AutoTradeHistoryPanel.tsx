import { useEffect, useState } from "react";
import { Activity, BellRing, ExternalLink } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { cn } from "@/lib/utils";

type HistoryEntry = {
  id: string;
  trigger?: "scheduled" | "manual";
  triggerLabel?: string;
  executedAt: string;
  desiredSymbol: string;
  desiredSide: "trend" | "range" | "cash";
  reason: string;
  tradedCount: number;
  noopCount: number;
  skippedCount: number;
  errorCount: number;
  walletResults: Array<{
    walletId: string;
    address: string;
    status: "skipped" | "noop" | "traded" | "error";
    step?: "sell" | "buy" | "wait" | "hold";
    stepLabel?: string;
    reason: string;
    currentSymbol: string;
    desiredSymbol: string;
    trade?: {
      txHash?: string;
      executedDestSymbol?: string;
    };
  }>;
};

type WalletTradePath = {
  walletId: string;
  address: string;
  path: string[];
  txHashes: string[];
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toLabel(side: HistoryEntry["desiredSide"]) {
  if (side === "trend") return "Trend";
  if (side === "range") return "Range";
  return "Cash";
}

function decisionReasonLabel(reason: string) {
  if (reason === "reserve-wait") return "条件が整っていないため、USDTで待機しました。";
  if (reason.startsWith("trend:")) return "トレンド条件を満たしたため、候補通貨を採用しました。";
  if (reason.startsWith("range:")) return "レンジ条件を満たしたため、補助候補を採用しました。";
  return reason;
}

function buildWalletTradePaths(results: HistoryEntry["walletResults"]): WalletTradePath[] {
  const grouped = new Map<string, WalletTradePath>();

  for (const item of results.filter((row) => row.status === "traded")) {
    const key = item.walletId || item.address;
    const executedDest = item.trade?.executedDestSymbol || item.desiredSymbol;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        walletId: item.walletId,
        address: item.address,
        path: [item.currentSymbol, executedDest],
        txHashes: item.trade?.txHash ? [item.trade.txHash] : [],
      });
      continue;
    }

    if (executedDest && executedDest !== existing.path[existing.path.length - 1]) {
      existing.path.push(executedDest);
    }

    if (item.trade?.txHash) {
      existing.txHashes.push(item.trade.txHash);
    }
  }

  return [...grouped.values()];
}

function isRotationPath(path: string[]) {
  return path.length >= 3;
}

function stepBadgeClass(step?: HistoryEntry["walletResults"][number]["step"]) {
  if (step === "sell") return "border-loss/35 bg-loss/10 text-loss";
  if (step === "buy") return "border-profit/35 bg-profit/10 text-profit";
  if (step === "wait") return "border-gold-400/35 bg-gold-400/10 text-gold-100";
  return "border-white/12 bg-white/[0.03] text-white/70";
}

export function AutoTradeHistoryPanel({ compact = false }: { compact?: boolean }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { currency } = useCurrency();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/system/auto-trade/history", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.ok && Array.isArray(data.entries)) {
          setEntries(data.entries);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(load, 60000);
    window.addEventListener("auto-trade-history-refresh", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("auto-trade-history-refresh", load);
    };
  }, []);

  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <BellRing className="h-4 w-4 text-gold-100" />
          自動売買実行履歴
        </div>
        <div className="text-[10px] uppercase tracking-[0.24em] text-gold-100/70">{currency} view</div>
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/70">
            最新の実行履歴を読み込んでいます。
          </div>
        ) : entries.length > 0 ? (
          entries.slice(0, compact ? 3 : 6).map((entry) => {
            const tradedPaths = buildWalletTradePaths(entry.walletResults);
            const hasRotation = tradedPaths.some((item) => isRotationPath(item.path));
            const nonTradeSteps = entry.walletResults.filter((item) => item.status !== "traded");

            return (
              <div key={entry.id} className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <Activity className="h-4 w-4 text-gold-100" />
                    {entry.desiredSymbol} / {toLabel(entry.desiredSide)}
                    {entry.trigger === "manual" ? (
                      <span className="rounded-full border border-gold-400/30 bg-gold-400/10 px-2 py-0.5 text-[10px] font-bold text-gold-100">
                        {entry.triggerLabel || "手動トレード判定"}
                      </span>
                    ) : null}
                    {hasRotation ? (
                      <span className="rounded-full border border-profit/35 bg-profit/10 px-2 py-0.5 text-[10px] font-bold text-profit">
                        全額ローテーション
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em]",
                      entry.tradedCount > 0
                        ? "border border-profit/40 bg-profit/10 text-profit"
                        : entry.errorCount > 0
                          ? "border border-loss/40 bg-loss/10 text-loss"
                          : "border border-white/12 bg-white/[0.03] text-white/70",
                    )}
                  >
                    {entry.tradedCount > 0 ? `EXECUTED ${entry.tradedCount}` : entry.errorCount > 0 ? "ERROR" : "NOOP"}
                  </div>
                </div>

                <div className="mt-1 text-[11px] text-white/65">{new Date(entry.executedAt).toLocaleString("ja-JP")}</div>
                <div className="mt-2 text-[12px] leading-6 text-white/82">{decisionReasonLabel(entry.reason)}</div>

                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/70">
                  <span>発注 {entry.tradedCount}</span>
                  <span>維持 {entry.noopCount}</span>
                  <span>見送り {entry.skippedCount}</span>
                  <span className={entry.errorCount > 0 ? "text-loss" : ""}>エラー {entry.errorCount}</span>
                </div>

                {tradedPaths.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {tradedPaths.slice(0, 3).map((item) => (
                      <div
                        key={`${entry.id}-${item.walletId}`}
                        className="rounded-[14px] border border-gold-400/14 bg-black/20 px-3 py-2 text-[11px] text-white/80"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-white">
                            {shortAddress(item.address)} / {item.path.join(" -> ")}
                          </div>
                          {isRotationPath(item.path) ? (
                            <span className="rounded-full border border-profit/35 bg-profit/10 px-2 py-0.5 text-[10px] font-bold text-profit">
                              全額ローテーション
                            </span>
                          ) : null}
                        </div>
                        {isRotationPath(item.path) ? (
                          <div className="mt-1 text-gold-100">
                            保有通貨を全額売却し、そのまま次の通貨へ乗り換えています。
                          </div>
                        ) : null}
                        {item.txHashes.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {item.txHashes.map((txHash) => (
                              <a
                                key={txHash}
                                href={`https://bscscan.com/tx/${txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-gold-100 hover:text-gold-50"
                              >
                                tx を確認
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {nonTradeSteps.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {nonTradeSteps.slice(0, 3).map((item, index) => (
                      <div
                        key={`${entry.id}-${item.walletId}-${index}`}
                        className="rounded-[14px] border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/80"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", stepBadgeClass(item.step))}>
                            {item.stepLabel || "状態"}
                          </span>
                          <span className="font-semibold text-white">
                            {shortAddress(item.address)} / 現在 {item.currentSymbol} / 目標 {item.desiredSymbol}
                          </span>
                        </div>
                        <div className="mt-1 text-white/70">{item.reason}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/70">
            まだ自動売買の実行履歴はありません。次回の判定後にここへ表示されます。
          </div>
        )}
      </div>
    </section>
  );
}
