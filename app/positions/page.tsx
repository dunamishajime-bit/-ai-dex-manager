Exit code: 0
Wall time: 1 seconds
Output:
"use client";

import { Activity, ShieldCheck } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";

function money(value?: number) {
  return value === undefined || !Number.isFinite(value) ? "-" : `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

export default function PositionsPage() {
  const { asterAccount, loading } = useOperationalWallet();
  const available = asterAccount?.status === "available";
  const positions = available ? asterAccount.positions : [];

  return <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.07)]"><div className="relative z-10 space-y-3">
    <header className="panel-gold rounded-[30px] p-4 md:p-5"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72"><ShieldCheck className="h-3.5 w-3.5" /> Dashboard / AsterDEX</div><h1 className="gold-heading mt-2 text-[1.9rem] font-black md:text-[2.8rem]">Current Portfolio</h1><p className="mt-2 max-w-3xl text-sm leading-7 text-white/82">保有ポジションと口座残高はAsterDEXの読み取り専用APIを正本として表示します。取得不能時は空データやゼロへ置き換えません。</p></header>
    <section className="grid gap-3 md:grid-cols-4"><div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] uppercase tracking-[0.28em] text-gold-100/72">Portfolio</div><div className="mt-2 text-2xl font-black">{available ? money(asterAccount.portfolioUsd) : "取得不能"}</div><div className="mt-1 text-xs text-white/65">AsterDEX wallet + unrealized PnL</div></div><div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] uppercase tracking-[0.28em] text-gold-100/72">Available</div><div className="mt-2 text-2xl font-black">{available ? money(asterAccount.availableBalanceUsd) : "取得不能"}</div><div className="mt-1 text-xs text-white/65">AsterDEX公式利用可能残高</div></div><div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] uppercase tracking-[0.28em] text-gold-100/72">Managed Positions</div><div className="mt-2 text-2xl font-black">{available ? positions.length : "未確認"}</div><div className="mt-1 text-xs text-white/65">AsterDEX公式positionRisk</div></div><div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] uppercase tracking-[0.28em] text-gold-100/72">Open Orders</div><div className="mt-2 text-2xl font-black">{available ? asterAccount.openOrdersCount ?? 0 : "未確認"}</div><div className="mt-1 text-xs text-white/65">AsterDEX公式openOrders</div></div></section>
    <section className="panel-gold rounded-[30px] p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/72">AsterDEX Position Risk</div><h2 className="mt-1 text-lg font-black">現在の建玉</h2></div><Activity className="h-5 w-5 text-gold-100" /></div><div className="mt-4 space-y-2">{positions.map((position) => <div key={`${position.symbol}-${position.positionSide || "BOTH"}`} className="grid gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-4 sm:grid-cols-2 md:grid-cols-5"><div><div className="text-sm font-bold">{position.symbol}</div><div className="mt-1 text-xs text-white/55">{position.positionSide || "BOTH"}</div></div><div><div className="text-[10px] uppercase text-gold-100/65">数量</div><div className="mt-1 font-mono text-sm">{position.positionAmt}</div></div><div><div className="text-[10px] uppercase text-gold-100/65">Entry</div><div className="mt-1 font-mono text-sm">{money(position.entryPrice)}</div></div><div><div className="text-[10px] uppercase text-gold-100/65">Mark</div><div className="mt-1 font-mono text-sm">{money(position.markPrice)}</div></div><div><div className="text-[10px] uppercase text-gold-100/65">Unrealized PnL</div><div className={`mt-1 font-mono text-sm ${position.unrealizedProfit >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(position.unrealizedProfit)}</div></div></div>)}{!loading && positions.length === 0 ? <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/60">{available ? "AsterDEX公式の管理対象建玉はありません。" : "AsterDEX口座情報を取得できないため、保有状況を推測表示していません。"}</div> : null}</div></section>
    <LiveDecisionPanel />
  </div></main>;
}

