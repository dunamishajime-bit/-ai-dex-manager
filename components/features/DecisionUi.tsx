"use client";

import { AlertCircle, CheckCircle2, CircleDashed, Clock3, Flame, Radio, ShieldAlert, XCircle } from "lucide-react";

import type { AttentionItem, PenguDirectionOverview, StrategyOverview, UiDecisionState, UiRuntimeStatus } from "@/lib/ui/disterminal-ui-view-model";
import { cn } from "@/lib/utils";

const stateMeta: Record<UiDecisionState, { label: string; icon: typeof Flame; className: string }> = {
  FIRE: { label: "FIRE", icon: Flame, className: "border-emerald-300/45 bg-emerald-400/15 text-emerald-100" },
  SIGNAL: { label: "SIGNAL", icon: Radio, className: "border-cyan-300/45 bg-cyan-400/15 text-cyan-100" },
  WAITING: { label: "WAITING", icon: Clock3, className: "border-amber-300/45 bg-amber-400/15 text-amber-100" },
  WATCH: { label: "WATCH", icon: CircleDashed, className: "border-white/18 bg-white/[0.05] text-white/75" },
  BLOCKED: { label: "BLOCKED", icon: ShieldAlert, className: "border-rose-300/45 bg-rose-400/15 text-rose-100" },
  OFF: { label: "OFF", icon: XCircle, className: "border-white/12 bg-white/[0.03] text-white/50" },
  ERROR: { label: "ERROR", icon: AlertCircle, className: "border-rose-300/45 bg-rose-400/15 text-rose-100" },
};

const runtimeMeta: Record<UiRuntimeStatus, { label: string; className: string }> = {
  LIVE: { label: "LIVE", className: "border-emerald-300/40 bg-emerald-400/12 text-emerald-100" },
  STALE: { label: "STALE", className: "border-amber-300/40 bg-amber-400/12 text-amber-100" },
  UNAVAILABLE: { label: "未取得", className: "border-rose-300/40 bg-rose-400/12 text-rose-100" },
  UNCONFIRMED: { label: "未確認", className: "border-rose-300/40 bg-rose-400/12 text-rose-100" },
};

export function StateBadge({ state, className }: { state: UiDecisionState; className?: string }) {
  const meta = stateMeta[state];
  const Icon = meta.icon;
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.12em]", meta.className, className)}><Icon className="h-3.5 w-3.5" />{meta.label}</span>;
}

export function RuntimeBadge({ status }: { status: UiRuntimeStatus }) {
  const meta = runtimeMeta[status];
  return <span className={cn("rounded-full border px-2 py-1 text-[10px] font-bold tracking-[0.12em]", meta.className)}>{meta.label}</span>;
}

export function StageIndicator({ steps, compact = false }: { steps: Array<{ key: string; label: string; state: "pass" | "blocked" | "pending" | "unknown"; detail: string }>; compact?: boolean }) {
  if (!steps.length) return <div className="text-xs text-white/45">実Runnerの段階データ未取得</div>;
  return (
    <ol className={cn("flex items-center", compact ? "gap-1 overflow-hidden" : "gap-2 overflow-x-auto pb-1")} aria-label="発火経路の段階">
      {steps.map((step, index) => {
        const done = step.state === "pass";
        const blocked = step.state === "blocked";
        const Icon = done ? CheckCircle2 : blocked ? AlertCircle : step.state === "pending" ? Clock3 : CircleDashed;
        return (
          <li key={step.key} className={cn("flex shrink-0 items-center", compact ? "gap-1" : "gap-2")} title={`${step.label}: ${step.detail}`}>
            <span className={cn("flex items-center justify-center rounded-full border", compact ? "h-6 w-6" : "h-8 w-8", done ? "border-emerald-300/45 bg-emerald-400/12 text-emerald-100" : blocked ? "border-rose-300/45 bg-rose-400/12 text-rose-100" : step.state === "pending" ? "border-amber-300/45 bg-amber-400/12 text-amber-100" : "border-white/15 bg-white/[0.04] text-white/50")}>
              <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            </span>
            {!compact ? <span className="max-w-[128px] text-[10px] leading-4 text-white/62">{step.label.replace(/^\d+\.\s*/, "")}</span> : <span className="text-[10px] font-semibold text-white/55">{index + 1}</span>}
            {index < steps.length - 1 ? <span className={cn("mx-0.5 h-px w-5", done ? "bg-emerald-300/35" : "bg-white/15")} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function marketLabel(market: StrategyOverview["market"]) {
  return market === "EQUITY" ? "EQUITY / STOCK" : "CRYPTO";
}

export function StrategyOverviewCards({ cards, compact = false }: { cards: StrategyOverview[]; compact?: boolean }) {
  return <div className={cn("grid gap-3", compact ? "md:grid-cols-3" : "xl:grid-cols-3")}>{cards.map((card) => <article key={card.id} className={cn("rounded-[22px] border border-white/10 bg-black/25", compact ? "p-3" : "p-4")}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><div className="truncate text-sm font-black text-white">{card.label}</div><div className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-white/45">{marketLabel(card.market)}</div></div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1.5"><StateBadge state={card.state} /><RuntimeBadge status={card.runtimeStatus} /></div>
    </div>
    <div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="text-white/45">現在段階</span><span className="truncate font-semibold text-white/85">{card.stageLabel}</span></div>
    <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
      <div className="rounded-lg border border-white/8 bg-white/[0.03] px-1 py-2"><div className="text-[9px] text-white/40">候補</div><div className="mt-1 text-sm font-bold text-white">{card.observedCandidates ?? "—"}</div></div>
      <div className="rounded-lg border border-white/8 bg-white/[0.03] px-1 py-2"><div className="text-[9px] text-white/40">成立方向</div><div className="mt-1 text-sm font-bold text-white">{card.eligibleDirections ?? "—"}</div></div>
      <div className="rounded-lg border border-white/8 bg-white/[0.03] px-1 py-2"><div className="text-[9px] text-white/40">建玉</div><div className="mt-1 text-sm font-bold text-white">{card.positionCount ?? "—"}</div></div>
    </div>
    {card.blocker ? <div className="mt-3 rounded-xl border border-rose-300/25 bg-rose-400/8 px-3 py-2 text-[11px] leading-5 text-rose-100"><span className="font-bold">BLOCKER</span><span className="mx-1 text-rose-200/50">·</span>{card.blocker}</div> : <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-white/58">{card.detail}</p>}
  </article>)}</div>;
}

export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (!items.length) return <div className="rounded-2xl border border-dashed border-white/12 px-4 py-7 text-center text-sm text-white/50">実Runnerから表示できる候補・Signalはまだありません。</div>;
  return <div className="space-y-2">{items.map((item) => <article key={item.key} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3 md:px-4">
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-lg border border-gold-300/25 bg-gold-400/8 px-2 py-1 text-[10px] font-bold tracking-[0.14em] text-gold-100">{item.strategyId}</span>
      <span className="font-black text-white">{item.symbol}</span>
      <span className={cn("rounded-md px-2 py-1 text-[10px] font-bold", item.side === "LONG" ? "bg-emerald-400/12 text-emerald-100" : item.side === "SHORT" ? "bg-rose-400/12 text-rose-100" : "bg-white/[0.06] text-white/60")}>{item.side}</span>
      {item.market === "EQUITY" ? <span className="rounded-md border border-cyan-300/25 bg-cyan-400/8 px-2 py-1 text-[10px] font-bold text-cyan-100">STOCK</span> : null}
      <StateBadge state={item.state} className="ml-auto" />
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/62"><span className="font-semibold text-white/82">{item.stageLabel}</span>{item.rank ? <span>Rank {item.rank}</span> : null}{item.blocker ? <span className="text-rose-200">Blocker: {item.blocker}</span> : null}</div>
    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/50">{item.detail}</p>
  </article>)}</div>;
}

export function PenguDirectionCards({ directions }: { directions: PenguDirectionOverview[] }) {
  return <div className="grid gap-2 sm:grid-cols-2">{directions.map((item) => <article key={item.direction} className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", item.direction === "LONG" ? "bg-emerald-300" : "bg-rose-300")} /><span className="font-black text-white">{item.direction}</span></div><StateBadge state={item.state === "SIGNAL" ? "SIGNAL" : item.state === "OFF" ? "OFF" : "ERROR"} /></div><div className="mt-2 text-xs font-semibold text-white/78">{item.stageLabel}</div>{item.blocker ? <div className="mt-2 text-[11px] leading-5 text-rose-100">Blocker: {item.blocker}</div> : <div className="mt-2 text-[11px] leading-5 text-white/50">{item.detail}</div>}</article>)}</div>;
}

export function MetricCard({ label, value, detail, tone = "default" }: { label: string; value: string; detail: string; tone?: "default" | "positive" | "negative" }) {
  return <article className="panel-gold rounded-[22px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-100/68">{label}</div><div className={cn("mt-2 text-2xl font-black", tone === "positive" ? "text-emerald-200" : tone === "negative" ? "text-rose-200" : "text-white")}>{value}</div><div className="mt-1 text-[11px] leading-5 text-white/60">{detail}</div></article>;
}
