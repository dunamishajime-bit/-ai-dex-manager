// AUTO_CONTINUE: enabled
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BrainCircuit, ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Transaction, useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";

type SellAnalysis = {
  sell: Transaction;
  buy?: Transaction;
};

function getExplorerUrl(chain: string | undefined, txHash: string) {
  if (chain === "Polygon") {
    return `https://polygonscan.com/tx/${txHash}`;
  }
  return `https://bscscan.com/tx/${txHash}`;
}

function formatJpy(value: number) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatSignedJpy(value: number) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : "-"}¥${Math.abs(rounded).toLocaleString("ja-JP")}`;
}

function resolvePriceJpy(tx: Transaction, jpyRate: number) {
  if (typeof tx.priceJpy === "number") return tx.priceJpy;
  if (typeof tx.priceUsd === "number") return tx.priceUsd * jpyRate;
  if (typeof tx.price === "number") return tx.price;
  return 0;
}

function resolvePnlJpy(tx: Transaction, jpyRate: number) {
  if (typeof tx.pnlJpy === "number") return tx.pnlJpy;
  if (typeof tx.pnlUsd === "number") return tx.pnlUsd * jpyRate;
  if (typeof tx.pnl === "number") return tx.pnl;
  return 0;
}

function sanitizeReasonText(text: string | undefined) {
  if (!text) return "";
  if (/(初期流動性確保|ステーブル原資|ステーブル残高を作る目的)/.test(text)) {
    return "旧ロジック由来の説明です。現在はステーブル残高作成目的の売買を廃止し、直接スワップ前提へ修正済みです。";
  }
  return text;
}

function buildFallbackExplanation(tx: Transaction) {
  if (tx.type === "SELL") {
    return "保有ポジションの逆行リスク、短期足の失速、またはニュース悪化を理由に決済しました。";
  }
  return "新しいシグナルに基づいてポジションを構築しました。";
}

function buildTriggerReason(tx: Transaction) {
  const reason = sanitizeReasonText(tx.reason);
  if (reason) return reason;
  if (tx.type === "SELL") return "短期足の失速、損切り、利確のいずれかに該当しました。";
  return "短期足の順張り条件を満たしたためです。";
}

export default function TraderBrainPage() {
  const { transactions } = useSimulation();
  const { jpyRate } = useCurrency();

  const sellAnalyses = useMemo<SellAnalysis[]>(() => {
    const sortedAsc = [...transactions].sort((left, right) => left.timestamp - right.timestamp);
    const lots = new Map<string, Array<{ tx: Transaction; remaining: number }>>();
    const analyses: SellAnalysis[] = [];

    for (const tx of sortedAsc) {
      const symbol = tx.symbol.toUpperCase();
      if (!lots.has(symbol)) {
        lots.set(symbol, []);
      }

      if (tx.type === "BUY") {
        lots.get(symbol)!.push({ tx, remaining: tx.amount });
        continue;
      }

      let remainingToMatch = tx.amount;
      let matchedBuy: Transaction | undefined;
      const symbolLots = lots.get(symbol)!;

      while (remainingToMatch > 0 && symbolLots.length > 0) {
        const lot = symbolLots[0];
        if (!matchedBuy) {
          matchedBuy = lot.tx;
        }

        if (lot.remaining <= remainingToMatch) {
          remainingToMatch -= lot.remaining;
          symbolLots.shift();
        } else {
          lot.remaining -= remainingToMatch;
          remainingToMatch = 0;
        }
      }

      analyses.push({ sell: tx, buy: matchedBuy });
    }

    return analyses.reverse();
  }, [transactions]);

  const losingCount = sellAnalyses.filter(({ sell }) => resolvePnlJpy(sell, jpyRate) < 0).length;
  const realizedTotal = sellAnalyses.reduce((sum, { sell }) => sum + resolvePnlJpy(sell, jpyRate), 0);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 bg-gradient-to-r from-white via-cyan-200 to-cyan-400 bg-clip-text text-2xl font-bold text-transparent">
            <BrainCircuit className="h-7 w-7 text-cyan-400" />
            TraderBrain
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            自動売買の決済理由を時系列で確認します。売却単価、買い単価、実現損益、関連ニュース、判断理由をまとめて表示します。
          </p>
        </div>
        <Link
          href="/history"
          className="rounded border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm text-gold-400 transition-colors hover:bg-gold-500/20"
        >
          トレード履歴へ戻る
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="決済件数" glow="primary">
          <div className="text-2xl font-bold text-white">{sellAnalyses.length}</div>
          <div className="mt-1 text-xs text-gray-400">売却として記録された件数</div>
        </Card>
        <Card title="損失決済" glow="danger">
          <div className="text-2xl font-bold text-red-400">{losingCount}</div>
          <div className="mt-1 text-xs text-gray-400">マイナスで終了した決済件数</div>
        </Card>
        <Card title="累計実現損益" glow="gold">
          <div className={`text-2xl font-bold ${realizedTotal >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {formatSignedJpy(realizedTotal)}
          </div>
          <div className="mt-1 text-xs text-gray-400">決済済みの損益だけを集計</div>
        </Card>
      </div>

      <div className="space-y-4">
        {sellAnalyses.length === 0 ? (
          <Card title="決済分析" glow="primary">
            <div className="py-8 text-center text-sm text-gray-500">まだ決済履歴がありません。</div>
          </Card>
        ) : null}

        {sellAnalyses.map(({ sell, buy }) => {
          const pnlJpy = resolvePnlJpy(sell, jpyRate);
          const buyPriceJpy =
            buy ? resolvePriceJpy(buy, jpyRate) : typeof sell.entryPrice === "number" ? sell.entryPrice * jpyRate : 0;
          const sellPriceJpy = resolvePriceJpy(sell, jpyRate);
          const isLoss = pnlJpy < 0;
          const summary = sanitizeReasonText(sell.decisionSummary) || buildFallbackExplanation(sell);

          return (
            <Card
              key={sell.id}
              title={`${sell.symbol} ${isLoss ? "損失決済" : "決済分析"}`}
              glow={isLoss ? "danger" : "primary"}
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                  <span>{new Date(sell.timestamp).toLocaleString("ja-JP")}</span>
                  <span>{sell.chain || "BNB Chain"}</span>
                  <span>{sell.pair || `${sell.symbol}/USDT`}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${
                      isLoss
                        ? "border-red-500/30 bg-red-500/10 text-red-300"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    }`}
                  >
                    {isLoss ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                    {isLoss ? "損失確定" : "決済完了"}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] text-gray-500">買い単価</div>
                    <div className="mt-1 font-mono text-white">{buyPriceJpy > 0 ? formatJpy(buyPriceJpy) : "不明"}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] text-gray-500">売り単価</div>
                    <div className="mt-1 font-mono text-white">{sellPriceJpy > 0 ? formatJpy(sellPriceJpy) : "不明"}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] text-gray-500">数量</div>
                    <div className="mt-1 font-mono text-white">{sell.amount.toFixed(6)}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/5 p-3">
                    <div className="text-[11px] text-gray-500">実現損益</div>
                    <div className={`mt-1 font-mono ${isLoss ? "text-red-400" : "text-emerald-400"}`}>
                      {formatSignedJpy(pnlJpy)}
                    </div>
                  </div>
                </div>

                <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="text-xs font-bold text-cyan-300">決済理由</div>
                  <div className="mt-2 text-sm leading-6 text-gray-200">{summary}</div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-gray-500">トリガー理由</div>
                    <div className="mt-1 text-sm text-white">{buildTriggerReason(sell)}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-gray-500">関連ニュース</div>
                    <div className="mt-1 text-sm text-white">{sell.newsTitle || "関連ニュースの記録はありません"}</div>
                  </div>
                </div>

                {sell.txHash ? (
                  <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs text-gray-400">
                    <span className="font-mono">{sell.txHash}</span>
                    <a
                      href={getExplorerUrl(sell.chain, sell.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-gold-400 hover:underline"
                    >
                      エクスプローラー
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
