"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, Loader2, Play, XCircle } from "lucide-react";

type Status = {
  running: boolean;
  cycle: number | null;
  latestDiscussion: { id?: string; completedAt?: string; messageCount?: number; summary?: string; decision?: string } | null;
  error: { failedAt?: string; message?: string } | null;
  log: string;
};

export default function ResearchDiscussionStartButtonV2() {
  const [status, setStatus] = useState<Status | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try { const response = await fetch("/api/research-lab/discussions/status", { cache: "no-store" }); if (response.ok) setStatus(await response.json() as Status); } catch { /* keep last status visible */ }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [load]);

  async function start() {
    setStarting(true); setMessage("");
    try {
      const response = await fetch("/api/research-lab/discussions/start", { method: "POST" });
      const body = await response.json() as { message?: string; detail?: string };
      if (!response.ok && response.status !== 409) throw new Error(body.detail ?? body.message ?? `HTTP ${response.status}`);
      setMessage(body.message ?? "議論を開始しました。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setStarting(false); }
  }

  const running = starting || Boolean(status?.running);
  const failed = !running && Boolean(status?.error);
  return <section className="rounded-[24px] border border-cyan-400/20 bg-cyan-500/[0.055] p-4 md:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" /><div><h2 className="font-black text-cyan-50">AIロジック議論を開始</h2><p className="mt-1 text-xs leading-5 text-cyan-50/70">現行Win80/Ultra90メイン研究の前回Cycleと検証済みロジックを引き継ぎ、続きから実行します。旧Championは研究親にしません。</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs">{running ? <span className="inline-flex items-center gap-1 text-amber-100"><Loader2 className="h-3.5 w-3.5 animate-spin" />議論を実行中</span> : failed ? <span className="inline-flex items-center gap-1 text-rose-200"><XCircle className="h-3.5 w-3.5" />実行失敗</span> : <span className="inline-flex items-center gap-1 text-emerald-100"><CheckCircle2 className="h-3.5 w-3.5" />待機中</span>}{status?.cycle != null ? <span className="text-white/55">Cycle {status.cycle}</span> : null}{status?.latestDiscussion?.messageCount != null ? <span className="text-white/55">{status.latestDiscussion.messageCount}発言</span> : null}</div>{message ? <p className="mt-2 text-xs text-cyan-100/80">{message}</p> : null}{status?.error ? <p className="mt-2 text-xs text-rose-200">{status.error.message}</p> : null}{status?.log ? <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-black/25 p-2 text-[10px] leading-4 text-white/50">{status.log}</pre> : null}{status?.latestDiscussion?.summary ? <div className="mt-3 rounded-lg border border-white/8 bg-black/20 p-3 text-xs leading-5 text-white/70"><b className="text-cyan-100">最新要約：</b>{status.latestDiscussion.summary}<br /><b className="text-emerald-100">CIO判断：</b>{status.latestDiscussion.decision}</div> : null}</div></div><button type="button" onClick={() => void start()} disabled={running} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-sm font-black text-cyan-50 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50">{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? "実行中" : "議論を開始"}</button></div></section>;
}
