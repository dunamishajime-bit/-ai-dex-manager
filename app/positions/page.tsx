"use client";

import { useMemo } from "react";
import { Activity, ShieldCheck, Wallet } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";
import { ManualTradeRunPanel } from "@/components/features/autotrade/ManualTradeRunPanel";
import { useCurrency } from "@/context/CurrencyContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { cn } from "@/lib/utils";

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="panel-gold rounded-[24px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/72">{label}</div>
      <div className="mt-2 text-[1.35rem] font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/78">{detail}</div>
    </div>
  );
}

function walletStatusLabel(status?: string) {
  if (status === "running") return "稼働中";
  if (status === "awaiting_deposit") return "入金待ち";
  if (status === "paused") return "停止中";
  return "未設定";
}

export default function PositionsPage() {
  const { wallet } = useOperationalWallet();
  const { formatPrice } = useCurrency();

  const rows = useMemo(() => {
    return (wallet?.trackedHoldings || [])
      .filter((holding) => Number(holding.amount) > 0)
      .map((holding) => ({
        ...holding,
        amountNumber: Number(holding.amount),
      }))
      .sort((left, right) => right.usdValue - left.usdValue);
  }, [wallet?.trackedHoldings]);

  const collateralUsd = rows
    .filter((row) => row.symbol === "USDT" || row.symbol === "USDF")
    .reduce((sum, row) => sum + Number(row.usdValue || 0), 0);

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.07)]">
      <div className="pointer-events-none absolute inset-0 bg-[url('/backgrounds/login_bg.png')] bg-cover bg-center opacity-[0.20] mix-blend-screen" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.10),transparent_20%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_24%),radial-gradient(circle_at_center,rgba(245,158,11,0.07),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.18),rgba(3,5,10,0.70))]" />

      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72">
            <ShieldCheck className="h-3.5 w-3.5" />
            combined dashboard
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="gold-heading text-[1.7rem] font-black tracking-tight sm:text-[2rem] md:text-[2.8rem]">
                combined のポジション管理
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-white/82">
                PENGU GoldCat、HYPE freq、ETH reclaim の 3 lane をまとめて確認できます。
                runner 系の旧表示は使わず、現在の本番ロジックだけを表示します。
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gold-400/18 bg-white/[0.03] px-4 py-2 text-[11px] text-gold-100">
              <Activity className="h-4 w-4" />
              ウォレット {walletStatusLabel(wallet?.status)}
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Portfolio"
            value={formatPrice(Number(wallet?.lastPortfolioUsd || 0))}
            detail={`保有資産 ${rows.length} / Collateral ${formatPrice(collateralUsd)}`}
          />
          <Metric label="Strategy" value="combined" detail="PENGU GoldCat / HYPE freq / ETH reclaim" />
          <Metric label="Sizing" value="lane based" detail="PENGU 15m sizing / HYPE 1.0x / ETH 1.0x" />
          <Metric label="Venue" value="AsterDex" detail="live / dry run は runtime control で切替" />
        </section>

        <section className="grid gap-3 xl:grid-cols-[1.12fr_0.88fr]">
          <div className="panel-gold rounded-[30px] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/72">Operational Wallet</div>
                <h2 className="mt-1 text-lg font-black text-white">運用ウォレット一覧</h2>
              </div>
              <Wallet className="h-5 w-5 text-gold-100" />
            </div>

            <div className="mt-4 space-y-2">
              {rows.length > 0 ? (
                rows.map((row) => (
                  <div
                    key={row.symbol}
                    className="grid gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-4 sm:grid-cols-2 md:grid-cols-[1fr_0.9fr_0.9fr_0.7fr]"
                  >
                    <div>
                      <div className="text-sm font-bold text-white">{row.symbol}</div>
                      <div className="mt-1 text-[11px] text-white/68">{row.name}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gold-100/70">数量</div>
                      <div className="mt-1 text-sm font-bold text-white">{row.amountNumber.toFixed(6)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gold-100/70">現在価格</div>
                      <div className="mt-1 text-sm font-bold text-white">{formatPrice(row.usdPrice)}</div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gold-100/70">評価額</div>
                      <div className={cn("mt-1 text-sm font-black", row.usdValue >= 0 ? "text-profit" : "text-loss")}>
                        {formatPrice(row.usdValue)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/70">
                  まだ運用ウォレットの残高がありません。入金後にここへ表示されます。
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="panel-gold rounded-[30px] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <ShieldCheck className="h-4 w-4 text-gold-100" />
                運用メモ
              </div>
              <div className="mt-3 space-y-2 text-sm leading-7 text-white/82">
                <p>PENGU は BTC 15m GoldCat を上位シグナルに使って AsterDex で執行します。</p>
                <p>HYPE は freq lane、ETH は reclaim_balanced lane として別判定で動きます。</p>
                <p>PENGU は 15m sizing を使い、HYPE と ETH は固定 1.0x で開始します。</p>
              </div>
            </div>
            <div className="panel-gold rounded-[30px] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Activity className="h-4 w-4 text-gold-100" />
                ウォレット状態
              </div>
              <div className="mt-2 text-[1.1rem] font-black text-white">{walletStatusLabel(wallet?.status)}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/78">
                表示は常に最新の combined API を基準に更新されます。
              </div>
            </div>
          </div>
        </section>

        <ManualTradeRunPanel />
        <LiveDecisionPanel />
      </div>
    </main>
  );
}
