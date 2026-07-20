"use client";

import { useState } from "react";
import { BrainCircuit, Loader2, Play } from "lucide-react";

export default function ResearchDiscussionStartButton() {
  const [status, setStatus] = useState<"idle" | "starting" | "started" | "running" | "error">("idle");
  const [message, setMessage] = useState("");
  async function start() {
    setStatus("starting"); setMessage("");
    try {
      const response = await fetch("/api/research-lab/discussions/start", { method: "POST" });
      const body = await response.json() as { message?: string; detail?: string };
      if (response.status === 409) { setStatus("running"); setMessage(body.message ?? "前回の議論が実行中です。"); return; }
      if (!response.ok) throw new Error(body.detail ?? body.message ?? `HTTP ${response.status}`);
      setStatus("started"); setMessage(body.message ?? "現行Win80/Ultra90メイン研究の前回Cycleを引き継いで開始しました。旧Championは研究親にしません。");
    } catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : String(error)); }
  }
  const disabled = status === "starting" || status === "started" || status === "running";
  return <section className="rounded-[24px] border border-cyan-400/20 bg-cyan-500/[0.055] p-4 md:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" /><div><h2 className="font-black text-cyan-50">AIロジック議論を開始</h2><p className="mt-1 text-xs leading-5 text-cyan-50/70">現行Win80/Ultra90メイン研究の前回Cycleと検証済みロジックを引き継ぎ、続きから実行します。旧Championは研究親にしません。</p>{message ? <p className={`mt-2 text-xs ${status === "error" ? "text-rose-200" : "text-cyan-100/80"}`}>{message}</p> : null}</div></div><button type="button" onClick={() => void start()} disabled={disabled} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-sm font-black text-cyan-50 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50">{status === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{status === "starting" ? "開始中…" : status === "started" || status === "running" ? "実行中" : "議論を開始"}</button></div></section>;
}
