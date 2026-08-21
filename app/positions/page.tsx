"use client";

import { useMemo } from "react";
import { Activity, BarChart3, ShieldCheck, Wallet } from "lucide-react";

import { AutoTradeHistoryPanel } from "@/components/features/autotrade/AutoTradeHistoryPanel";
import { V12GateStatusPanel } from "@/components/features/autotrade/V12GateStatusPanel";
import { ManualTradeRunPanel } from "@/components/features/autotrade/ManualTradeRunPanel";
import { useCurrency } from "@/context/CurrencyContext";
import { useSimulation } from "@/context/SimulationContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { useV12LiveStatus } from "@/hooks/useV12LiveStatus";
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
  if (status === "awaiting_deposit") return "入金確認待ち";
  if (status === "paused") return "停止中";
  return "未設定";
}

export default function PositionsPage() {
  const { tradeNotifications, activeStrategies } = useSimulation();
  const { wallet } = useOperationalWallet();
  const { status: v12Status, loading: v12StatusLoading } = useV12LiveStatus();
  const { formatPrice } = useCurrency();

  const autoTradeLabel = v12StatusLoading
    ? "状態確認中"
    : v12Status === "running"
      ? "V12ライブ稼働中"
      : v12Status === "blocked"
        ? "V12ゲート停止"
        : "状態確認不可";

  const rows = useMemo(() => {
    return (wallet?.trackedHoldings || [])
      .filter((holding) => Number(holding.amount) > 0)
      .map((holding) => ({
        ...holding,
        amountNumber: Number(holding.amount),
      }))
      .sort((left, right) => right.usdValue - left.usdValue);
  }, [wallet?.trackedHoldings]);

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.07)]">
      <div className="pointer-events-none absolute inset-0 bg-[url('/backgrounds/login_bg.png')] bg-cover bg-center opacity-[0.20] mix-blend-screen" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.10),transparent_20%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_24%),radial-gradient(circle_at_center,rgba(245,158,11,0.07),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.18),rgba(3,5,10,0.70))]" />

      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72">
            <ShieldCheck className="h-3.5 w-3.5" />
            dashboard
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="gold-heading text-[1.7rem] font-black tracking-tight sm:text-[2rem] md:text-[2.8rem]">
                運用状況を一画面で確認します。
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-white/82">
                運用ウォレットの実残高、手動判定、自動売買の履歴をまとめて確認できます。
                V12 X1.00 ALLの発火候補、各判定Gate、実際にENTRY_ELIGIBLEとなった通貨を表示します。注文可否はVPS workerの安全Gateが最終決定します。
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-gold-400/18 bg-white/[0.03] px-4 py-2 text-[11px] text-gold-100">
              <Activity className="h-4 w-4" />
              自動売買 {autoTradeLabel}
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Portfolio"
            value={formatPrice(Number(wallet?.lastPortfolioUsd || 0))}
            detail={`BNB残高 ${Number(wallet?.lastBalanceFormatted || 0).toFixed(6)} / 保有銘柄 ${rows.length}`}
          />
          <Metric label="Strategies" value={`${activeStrategies.length}`} detail="現在読み込み中の戦略数です。" />
          <Metric label="Notifications" value={`${tradeNotifications.length}`} detail="最新の通知件数です。" />
          <Metric label="Wallet" value={walletStatusLabel(wallet?.status)} detail="運用ウォレットの現在の状態です。" />
        </section>

        <section className="grid gap-3 xl:grid-cols-[1.18fr_0.82fr]">
          <div className="panel-gold rounded-[30px] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/72">Operational Wallet</div>
                <h2 className="mt-1 text-lg font-black text-white">保有資産一覧</h2>
              </div>
              <BarChart3 className="h-5 w-5 text-gold-100" />
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
                      <div className="text-[10px] uppercase tracking-[0.24em] text-gold-100/70">現在値</div>
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
                  まだ保有資産はありません。運用ウォレットへ入金すると、ここに最新の残高が表示されます。
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="panel-gold rounded-[30px] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Wallet className="h-4 w-4 text-gold-100" />
                表示ルール
              </div>
              <div className="mt-3 space-y-2 text-sm leading-7 text-white/82">
                <p>表示される保有資産は、運用ウォレットの実残高です。</p>
                <p>暗号資産のV12先物判定はAster Futures V3の公開H1データをH2へ整列して計算します。</p>
                <p>ウォレット残高・保有資産は運用ウォレットAPI、V12の建玉・残余枠・保護注文はVPS runnerの再照合を正本とします。</p>
              </div>
            </div>
            <div className="panel-gold rounded-[30px] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <ShieldCheck className="h-4 w-4 text-gold-100" />
                自動売買状態
              </div>
              <div className={cn("mt-2 text-[1.1rem] font-black", v12Status === "running" ? "text-profit" : v12Status === "blocked" ? "text-loss" : "text-white")}>
                {autoTradeLabel}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-white/78">
                V12 VPS worker、LIVE実行フラグ、共通リスクGateの状態を正本として表示します。EVM運用ウォレットの入金状態とは分離されています。
              </div>
            </div>
          </div>
        </section>

        <ManualTradeRunPanel />
        <V12GateStatusPanel />
        <AutoTradeHistoryPanel />
      </div>
    </main>
  );
}
