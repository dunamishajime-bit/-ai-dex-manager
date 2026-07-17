"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gavel,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRoundSearch,
} from "lucide-react";

import type {
  ResearchDiscussionIndexEntry,
  ResearchDiscussionListPayload,
  ResearchDiscussionLog,
  ResearchDiscussionMessage,
} from "@/lib/research-lab/discussion-types";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 60_000;
const MAIN_STRATEGY_ID = "WIN80_ULTRA90_TOP1_V1";

function isMainStrategyDiscussion(item: Pick<ResearchDiscussionIndexEntry, "title" | "topStrategyIds">) {
  return item.topStrategyIds.includes(MAIN_STRATEGY_ID)
    && !item.title.includes("Champion深掘り");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function dateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function pct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function roleStyle(message: ResearchDiscussionMessage) {
  if (message.role === "researcher") {
    return { icon: UserRoundSearch, label: "Researcher", className: "border-sky-400/20 bg-sky-500/[0.07] text-sky-50" };
  }
  if (message.role === "overfit_critic") {
    return { icon: ShieldAlert, label: "Overfit Critic", className: "border-violet-400/20 bg-violet-500/[0.07] text-violet-50" };
  }
  if (message.role === "tail_risk_critic") {
    return { icon: AlertTriangle, label: "Tail Risk Critic", className: "border-rose-400/20 bg-rose-500/[0.07] text-rose-50" };
  }
  if (message.role === "execution_critic") {
    return { icon: Bot, label: "Execution Critic", className: "border-amber-400/20 bg-amber-500/[0.07] text-amber-50" };
  }
  if (message.role === "cio") {
    return { icon: Gavel, label: "CIO Decision", className: "border-emerald-400/20 bg-emerald-500/[0.07] text-emerald-50" };
  }
  return { icon: MessageSquareText, label: "Moderator", className: "border-white/10 bg-white/[0.035] text-white" };
}

function evidenceStyle(assessment: "positive" | "neutral" | "negative") {
  if (assessment === "positive") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  if (assessment === "negative") return "border-rose-400/20 bg-rose-500/10 text-rose-100";
  return "border-white/10 bg-black/20 text-white/65";
}

function TranscriptMessage({ message }: { message: ResearchDiscussionMessage }) {
  const style = roleStyle(message);
  const Icon = style.icon;
  return (
    <article className={cn("rounded-[20px] border p-4", style.className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-2">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">{style.label}</div>
            <h3 className="mt-1 text-sm font-black">{message.speakerName}</h3>
            {message.strategyId ? <div className="mt-1 font-mono text-[10px] opacity-55">{message.strategyId}</div> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] opacity-50">
          <Clock3 className="h-3.5 w-3.5" />
          {formatDateTime(message.createdAt)} JST
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 opacity-85">{message.content}</p>
      {message.evidence.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {message.evidence.map((item) => (
            <div key={`${message.id}-${item.label}`} className={cn("rounded-xl border px-3 py-2", evidenceStyle(item.assessment))}>
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] opacity-55">{item.label}</div>
              <div className="mt-1 text-xs font-black">{item.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default function DiscussionLogViewer() {
  const [items, setItems] = useState<ResearchDiscussionIndexEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [log, setLog] = useState<ResearchDiscussionLog | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingLog, setLoadingLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState("");
  const [query, setQuery] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const response = await fetch("/api/research-lab/discussions", { cache: "no-store" });
      const body = await response.json() as ResearchDiscussionListPayload & { error?: string; detail?: string };
      if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
      setItems(body.items);
      setSelectedPath((current) => {
        if (current && body.items.some((item) => item.path === current)) return current;
        const latestMain = body.items.find(isMainStrategyDiscussion);
        return latestMain?.path ?? body.latest?.path ?? null;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadLog = useCallback(async (discussionPath: string) => {
    setLoadingLog(true);
    try {
      const response = await fetch(`/api/research-lab/discussions/detail?path=${encodeURIComponent(discussionPath)}`, { cache: "no-store" });
      const body = await response.json() as ResearchDiscussionLog & { error?: string; detail?: string };
      if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
      setLog(body);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
    const timer = window.setInterval(() => void loadList(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadList]);

  useEffect(() => {
    if (selectedPath) void loadLog(selectedPath);
  }, [loadLog, selectedPath]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!showLegacy && !isMainStrategyDiscussion(item)) return false;
      if (dateFilter && dateKey(item.completedAt) !== dateFilter) return false;
      if (!normalizedQuery) return true;
      return [item.title, item.summary, item.decision, ...item.topStrategyIds]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [dateFilter, items, query, showLegacy]);

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 xl:sticky xl:top-0 xl:max-h-[calc(100vh-150px)] xl:overflow-hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-white">日時別ログ</h2>
            <p className="mt-1 text-[11px] text-white/45">現行メイン研究を優先表示</p>
          </div>
          <button
            type="button"
            onClick={() => void loadList()}
            className="rounded-xl border border-white/10 bg-black/20 p-2 text-white/55 hover:text-white"
            aria-label="ログ一覧を更新"
          >
            <RefreshCw className={cn("h-4 w-4", loadingList && "animate-spin")} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setShowLegacy(false)}
            className={cn(
              "rounded-xl border px-3 py-2 text-[10px] font-bold",
              !showLegacy
                ? "border-gold-400/30 bg-gold-400/10 text-gold-50"
                : "border-white/10 bg-black/20 text-white/45",
            )}
          >
            メイン研究
          </button>
          <button
            type="button"
            onClick={() => setShowLegacy(true)}
            className={cn(
              "rounded-xl border px-3 py-2 text-[10px] font-bold",
              showLegacy
                ? "border-white/20 bg-white/[0.06] text-white/75"
                : "border-white/10 bg-black/20 text-white/45",
            )}
          >
            旧ログも表示
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-500/[0.055] px-3 py-2 text-[10px] leading-5 text-sky-50/65">
          既定表示は{MAIN_STRATEGY_ID}を直接扱う会議です。旧Champion Deepはアーカイブとしてのみ表示します。
        </div>

        <div className="mt-4 space-y-2">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="戦略ID・要約を検索"
              className="w-full rounded-xl border border-white/10 bg-black/25 py-2.5 pl-10 pr-3 text-xs text-white outline-none placeholder:text-white/30 focus:border-gold-400/30"
            />
          </label>
          <label className="relative block">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/25 py-2.5 pl-10 pr-3 text-xs text-white outline-none focus:border-gold-400/30"
            />
          </label>
        </div>

        <div className="mt-4 space-y-2 xl:max-h-[calc(100vh-350px)] xl:overflow-y-auto xl:pr-1">
          {loadingList && !items.length ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-white/8 p-5 text-xs text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中
            </div>
          ) : null}
          {!loadingList && !filteredItems.length ? (
            <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs leading-6 text-white/45">
              現行メイン研究ログはまだありません。次のMain Strategy Research完了後に生成されます。
            </div>
          ) : null}
          {filteredItems.map((item) => {
            const active = selectedPath === item.path;
            const mainDiscussion = isMainStrategyDiscussion(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedPath(item.path)}
                className={cn(
                  "w-full rounded-[16px] border p-3 text-left transition-colors",
                  active
                    ? "border-gold-400/30 bg-gold-400/10"
                    : "border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.035]",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">Cycle {item.cycle}</span>
                    <span className={cn(
                      "rounded-md border px-1.5 py-0.5 text-[8px] font-black",
                      mainDiscussion
                        ? "border-sky-400/25 bg-sky-500/10 text-sky-100"
                        : "border-white/10 bg-white/[0.03] text-white/35",
                    )}>
                      {mainDiscussion ? "MAIN" : "LEGACY"}
                    </span>
                  </div>
                  <ChevronRight className={cn("h-4 w-4", active ? "text-gold-100" : "text-white/25")} />
                </div>
                <div className="mt-2 text-xs font-black text-white">{formatDateTime(item.completedAt)} JST</div>
                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-white/50">{item.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[9px] text-white/50">
                  <span className="rounded-md border border-white/8 px-2 py-1">{item.messageCount}発言</span>
                  <span className="rounded-md border border-white/8 px-2 py-1">OOS {pct(item.bestOosMonthlyPct)}</span>
                  <span className="rounded-md border border-white/8 px-2 py-1">候補 {item.finalCandidates}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-w-0 rounded-[24px] border border-white/8 bg-white/[0.03] p-4 md:p-5">
        {error ? (
          <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            {error}
          </div>
        ) : null}

        {loadingLog ? (
          <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-white/55">
            <Loader2 className="h-5 w-5 animate-spin text-gold-100" /> 議論全文を読み込んでいます
          </div>
        ) : null}

        {!loadingLog && !log ? (
          <div className="flex min-h-72 flex-col items-center justify-center text-center">
            <MessageSquareText className="h-9 w-9 text-white/20" />
            <h2 className="mt-4 font-black text-white/75">表示する議論を選択してください</h2>
            <p className="mt-2 text-xs leading-6 text-white/40">左側の日時別ログからCycleを選択すると全文を表示します。</p>
          </div>
        ) : null}

        {!loadingLog && log ? (
          <div>
            <div className="rounded-[20px] border border-gold-400/16 bg-[linear-gradient(180deg,rgba(35,29,14,0.45),rgba(8,10,14,0.6))] p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-100/65">Full Research Debate</div>
                    {log.topStrategyIds.includes(MAIN_STRATEGY_ID) && !log.title.includes("Champion深掘り") ? (
                      <span className="rounded-md border border-sky-400/25 bg-sky-500/10 px-2 py-1 text-[9px] font-black text-sky-100">CURRENT MAIN</span>
                    ) : (
                      <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] font-black text-white/35">LEGACY / RELATED</span>
                    )}
                  </div>
                  <h1 className="mt-2 text-2xl font-black text-white">{log.title}</h1>
                  <p className="mt-2 text-xs text-white/50">{formatDateTime(log.completedAt)} JST・{log.profile.toUpperCase()}・{log.messages.length}発言</p>
                </div>
                <div className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold",
                  log.finalCandidates > 0
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                    : "border-white/10 bg-black/20 text-white/60",
                )}>
                  {log.finalCandidates > 0 ? <CheckCircle2 className="h-4 w-4" /> : <Gavel className="h-4 w-4" />}
                  最終候補 {log.finalCandidates}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/8 bg-black/20 p-3"><div className="text-[9px] uppercase tracking-[0.16em] text-white/40">Best OOS</div><div className="mt-2 text-lg font-black text-white">{pct(log.bestOosMonthlyPct)}</div></div>
                <div className="rounded-xl border border-white/8 bg-black/20 p-3"><div className="text-[9px] uppercase tracking-[0.16em] text-white/40">OOS MaxDD</div><div className="mt-2 text-lg font-black text-white">{pct(log.bestOosDrawdownPct)}</div></div>
                <div className="rounded-xl border border-white/8 bg-black/20 p-3"><div className="text-[9px] uppercase tracking-[0.16em] text-white/40">Worst Stress</div><div className="mt-2 text-lg font-black text-white">{pct(log.bestWorstStressMonthlyPct)}</div></div>
              </div>

              <div className="mt-4 rounded-xl border border-sky-400/15 bg-sky-500/[0.06] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-100/60">議論要約</div>
                <p className="mt-2 text-sm leading-7 text-sky-50/80">{log.summary}</p>
              </div>
              <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100/60">CIO判断</div>
                <p className="mt-2 text-sm leading-7 text-emerald-50/80">{log.decision}</p>
              </div>
              <details className="mt-3 rounded-xl border border-white/8 bg-black/15 p-4">
                <summary className="cursor-pointer text-xs font-bold text-white/60">議論生成方法を表示</summary>
                <p className="mt-3 text-xs leading-6 text-white/45">{log.methodology}</p>
              </details>
            </div>

            <div className="mt-4 space-y-3">
              {log.messages.map((item) => <TranscriptMessage key={item.id} message={item} />)}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
