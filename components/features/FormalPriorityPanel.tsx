"use client";
import { useEffect, useState } from "react";
import type { sanitizeFormalPriority } from "@/lib/server/formal-priority-observability";
type Snapshot = ReturnType<typeof sanitizeFormalPriority>;
const date = (value?: number) => value ? new Date(value).toLocaleString("ja-JP") : "実約定時刻未取得";
export function FormalPriorityPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => { try {
      const response = await fetch("/api/system/formal-priority-status", { cache: "no-store" });
      const raw = await response.json();
      if (!response.ok || !raw.ok) throw new Error(raw.error || "取得不可");
      if (live) { setData(raw); setError(""); }
    } catch (e) { if (live) setError(e instanceof Error ? e.message : "取得不可"); } };
    void load(); const timer = window.setInterval(() => void load(), 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  return <section className="min-w-0 space-y-3 rounded-2xl border border-white/10 p-4 text-sm [overflow-wrap:anywhere]">
    <h2 className="font-bold text-white">実Production：Sizing / Priority / 同一symbol Cooldown</h2>
    {error ? <p className="text-amber-200">取得不可：{error}（新契約LIVE確認とは扱いません）</p> : null}
    {data ? <>
      <p className="text-white/60">SHA {data.releaseSha} / state {data.stateSha || "未取得"} / 更新 {date(data.stateUpdatedAt)}</p>
      {data.contractAvailable ? <>
        <p>Rank1/2 {data.policy.rank12Gross}x / DOGE・LTC {data.policy.reducedGross}x / Rank3 {data.policy.rank3Gross}x・Residualのみ</p>
        <p>Q102 handoff：{data.policy.handoffFamilies.join(" / ")} / 順序 {data.policy.rankOrder.join(" → ")} / MR・BRKは譲渡不可</p>
        <p>Cooldown：actual venue exit + 2h、symbol別</p>
      </> : <p className="text-amber-200">現在のProductionは新正式Priority契約ではありません。予定値を実効値として表示しません。</p>}
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">{data.cooldowns.map(row => <div className="min-w-0 rounded-xl bg-white/5 p-3" key={row.symbol}>
        <b>{row.symbol}</b>：{row.active ? "Cooldown active / ENTRY BLOCK" : "Cooldown inactive"}<br />実exit {date(row.actualExitTs)}<br />解除 {date(row.cooldownUntil)}</div>)}</div>
      {data.handoff.symbol ? <p>直近譲渡：{data.handoff.symbol} / Rank{data.handoff.victimRank} / {data.handoff.family} / 解放Gross {data.handoff.freedGross?.toFixed(3)}x / {data.handoff.reason}</p> : <p className="text-white/60">記録されたQ102→V12譲渡なし</p>}
      {data.formalBacktest ? <p>10bps Formal H1 Causal BT（Historical L2未検証）：¥{Number(data.formalBacktest.endingAssetJpy).toLocaleString("ja-JP", { maximumFractionDigits: 0 })} / PF {Number(data.formalBacktest.profitFactor).toFixed(4)} / DD {Number(data.formalBacktest.maxDrawdownPct).toFixed(2)}% / 勝率 {Number(data.formalBacktest.winRatePct).toFixed(2)}% / {Number(data.formalBacktest.trades)}件。5ロジックの過去モデル結果であり、実約定利益やOverlay込み検証値ではありません。</p> : null}
    </> : !error ? <p>読み込み中…</p> : null}
  </section>;
}
