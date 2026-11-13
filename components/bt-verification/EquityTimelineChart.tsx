"use client";

import type { ReplayFrame } from "@/lib/bt-verification/replay";

const money = (value: number) => "¥" + value.toLocaleString("ja-JP", { maximumFractionDigits: 0 });

/** Playback chart uses only data available at or before cursor: no look-ahead. */
export function EquityTimelineChart({ frames, cursor }: { frames: ReplayFrame[]; cursor: number }) {
  const visible = frames.slice(0, cursor + 1);
  if (!visible.length) return null;
  const start = visible[0].equity;
  const current = visible[visible.length - 1].equity;
  const equities = visible.map((f) => f.equity);
  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const span = Math.max(1, max - min);
  const lower = min - span * 0.12;
  const upper = max + span * 0.12;
  const width = 650;
  const left = 76;
  const right = 628;
  const top = 20;
  const bottom = 183;
  const y = (v: number) => bottom - ((v - lower) / (upper - lower)) * (bottom - top);
  const x = (i: number) => left + i * (right - left) / Math.max(1, visible.length - 1);
  const plot: { index: number; value: number }[] = [];
  const stride = Math.max(1, Math.ceil(visible.length / 260));
  for (let from = 0; from < visible.length; from += stride) {
    const to = Math.min(visible.length, from + stride);
    const bucket = equities.slice(from, to).map((value, j) => ({ index: from + j, value }));
    let hi = bucket[0], lo = bucket[0];
    for (const item of bucket) { if (item.value > hi.value) hi = item; if (item.value < lo.value) lo = item; }
    for (const item of [lo, hi].sort((a,b) => a.index - b.index)) {
      if (!plot.length || plot[plot.length - 1].index !== item.index) plot.push(item);
    }
  }
  if (plot.length === 0 || plot[0].index !== 0) plot.unshift({index:0,value:equities[0]});
  if (plot[plot.length - 1].index !== visible.length - 1) plot.push({index:visible.length - 1,value:current});
  const path = plot.map(p => x(p.index).toFixed(2) + "," + y(p.value).toFixed(2)).join(" ");
  let peak = -Infinity, maxDrawdown = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100);
  }
  const delta = current - start;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-xs text-slate-400">再生済み区間の評価資産</span>
      <strong className={delta < 0 ? "text-rose-300" : "text-emerald-300"}>
        {money(current)}（{delta < 0 ? "" : "+"}{money(delta)}）
      </strong>
    </div>
    <svg viewBox={"0 0 " + width + " 225"} role="img" aria-label="時点同期の評価資産曲線。これまでの最小値、最大値と現在値を表示" className="w-full rounded-lg bg-[#071524]">
      {[0,1,2,3,4].map(i => {
        const value = upper - (upper-lower)*i/4, yy = top+(bottom-top)*i/4;
        return <g key={i}>
          <line x1={left} x2={right} y1={yy} y2={yy} stroke="#27374a" strokeWidth="0.8" />
          <text x="5" y={yy+4} fontSize="11" fill="#94a3b8">{money(value)}</text>
        </g>;
      })}
      {lower <= start && start <= upper && <line x1={left} x2={right} y1={y(start)} y2={y(start)} stroke="#8fa1bb" strokeDasharray="4 4"/>}
      <polyline points={path} fill="none" stroke={delta >= 0 ? "#2dd4bf" : "#fb7185"} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={x(visible.length-1)} cy={y(current)} r="4.5" fill={delta >= 0 ? "#2dd4bf" : "#fb7185"} />
      <text x={left} y="213" fontSize="11" fill="#94a3b8">{visible[0].timestamp.slice(0,16)} UTC</text>
      <text x={right} y="213" textAnchor="end" fontSize="11" fill="#94a3b8">{visible[visible.length-1].timestamp.slice(0,16)} UTC</text>
    </svg>
    <div className="flex justify-between text-xs text-slate-400">
      <span>表示区間の最小 {money(min)} / 最大 {money(max)}</span>
      <span>区間内最大DD {maxDrawdown.toFixed(2)}%</span>
    </div>
  </div>;
}
