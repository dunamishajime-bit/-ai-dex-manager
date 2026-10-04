import fs from "fs/promises";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpBar, PerpMarketData, PerpSide } from "../lib/research-lab/perp/types";

const H = 3_600_000;
const START = Date.UTC(2025, 7, 21);
const END = Date.UTC(2026, 7, 21);
const WARM = START - 180 * 24 * H;
const SYMS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"];

// Exact current V12 signal/risk constants. This is research-only and does not import LIVE execution.
const P = {
  sma: 53,
  regMom: 52,
  regThr: 0.0377,
  mom: 45,
  minMom: 0.0227,
  minVol: 0.9845,
  edge: 6.0879,
  volN: 15,
  volPen: 2.3953,
  atrN: 31,
  stop: 2.477,
  tp: 3.1995,
  trail: 0.4,
  maxHold: 23,
  rebalance: 20,
  cooldown: 1,
  riskPct: 3.19,
};

type Candidate = { symbol: string; side: PerpSide; score: number; atr: number; ts: number };
type Position = {
  symbol: string;
  side: PerpSide;
  entry: number;
  qty: number;
  entryFee: number;
  funding: number;
  lastFund: number;
  initialStop: number;
  stop: number;
  tp: number;
  atr: number;
  peak: number;
  trough: number;
  bars: number;
  rank: number;
};
type Variant = { name: string; slots: 1 | 2; perPositionGrossCap: number; aggregateGrossCap: number };
type Mode = { name: string; fee: number; slip: number };
type Prepared = { bars: Record<string, PerpBar[]>; idx: Record<string, Map<number, number>>; timeline: number[] };

const variants: Variant[] = [
  { name: "current_one_slot_cap1p00", slots: 1, perPositionGrossCap: 1.0, aggregateGrossCap: 1.0 },
  { name: "top2_residual_cap1p00", slots: 2, perPositionGrossCap: 1.0, aggregateGrossCap: 1.0 },
  { name: "top2_residual_cap1p25", slots: 2, perPositionGrossCap: 1.0, aggregateGrossCap: 1.25 },
  { name: "top2_residual_cap1p50", slots: 2, perPositionGrossCap: 1.0, aggregateGrossCap: 1.5 },
];
const modes: Mode[] = [
  { name: "normal", fee: 5, slip: 0 },
  { name: "stress", fee: 10, slip: 5 },
];

function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function sd(a: number[]) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function resample(a: PerpBar[]) {
  const out = new Map<number, PerpBar>();
  for (const x of a) {
    const ts = Math.floor(x.ts / (2 * H)) * 2 * H;
    const e = out.get(ts);
    if (!e) out.set(ts, { ...x, ts });
    else {
      e.high = Math.max(e.high, x.high);
      e.low = Math.min(e.low, x.low);
      e.close = x.close;
      e.volume += x.volume;
    }
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}
function prep(d: PerpMarketData): Prepared {
  const bars: Record<string, PerpBar[]> = {};
  const idx: Record<string, Map<number, number>> = {};
  for (const [s, a] of Object.entries(d.bySymbol)) {
    bars[s] = resample(a);
    idx[s] = new Map(bars[s].map((x, i) => [x.ts, i]));
  }
  return { bars, idx, timeline: (bars.BTC || []).map((x) => x.ts) };
}
function sma(b: PerpBar[], i: number, n: number) { if (i < n - 1) return NaN; return mean(b.slice(i - n + 1, i + 1).map((x) => x.close)); }
function mom(b: PerpBar[], i: number, n: number) { return i >= n ? b[i].close / b[i - n].close - 1 : NaN; }
function atr(b: PerpBar[], i: number, n: number) {
  if (i < n) return NaN;
  const a: number[] = [];
  for (let j = i - n + 1; j <= i; j += 1) a.push(Math.max(b[j].high - b[j].low, Math.abs(b[j].high - b[j - 1].close), Math.abs(b[j].low - b[j - 1].close)));
  return mean(a);
}
function vol(b: PerpBar[], i: number, n: number) {
  if (i < n) return NaN;
  const a: number[] = [];
  for (let j = i - n + 1; j <= i; j += 1) a.push(Math.log(b[j].close / b[j - 1].close));
  return sd(a);
}
function vr(b: PerpBar[], i: number) {
  if (i < 20) return NaN;
  const m = mean(b.slice(i - 20, i).map((x) => x.volume));
  return m > 0 ? b[i].volume / m : NaN;
}
function candidates(p: Prepared, ts: number): Candidate[] {
  const bi = p.idx.BTC?.get(ts);
  const btc = p.bars.BTC;
  if (bi == null || !btc) return [];
  const s = sma(btc, bi, P.sma);
  const m = mom(btc, bi, P.regMom);
  if (!Number.isFinite(s) || !Number.isFinite(m)) return [];
  const dist = btc[bi].close / s - 1;
  const long = dist >= P.regThr && m > 0;
  const short = dist <= -P.regThr && m < 0;
  const neutral = !long && !short;
  const minEdge = 0.001 * P.edge;
  const out: Candidate[] = [];
  for (const symbol of SYMS) {
    const i = p.idx[symbol]?.get(ts);
    const b = p.bars[symbol];
    if (i == null || !b) continue;
    const mm = mom(b, i, P.mom);
    const vv = vol(b, i, P.volN);
    const aa = atr(b, i, P.atrN);
    const rr = vr(b, i);
    if (![mm, vv, aa, rr].every(Number.isFinite) || rr < P.minVol || Math.abs(mm) < minEdge) continue;
    const score = (mm / Math.max(0.0001, vv * Math.sqrt(P.mom))) / (1 + P.volPen * vv * 100);
    if (mm >= P.minMom && (long || (neutral && score >= 1.4649))) out.push({ symbol, side: "long", score, atr: aa, ts });
    if (mm <= -P.minMom && (short || (neutral && -score >= 1.4649))) out.push({ symbol, side: "short", score: -score, atr: aa, ts });
  }
  return out.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}
function firstFund(a: { ts: number; rate: number }[], ts: number) {
  let l = 0; let r = a.length;
  while (l < r) { const m = (l + r) >> 1; if (a[m].ts <= ts) l = m + 1; else r = m; }
  return l;
}
function fund(a: { ts: number; rate: number }[], from: number, to: number) {
  let i = firstFund(a, from); let x = 0;
  for (; i < a.length && a[i].ts <= to; i += 1) x += a[i].rate;
  return x;
}
function pf(a: number[]) {
  const gp = a.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const gl = -a.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  return gl ? gp / gl : gp ? 99 : 0;
}
function pfwb(a: number[]) {
  const b = [...a];
  if (b.length) b.splice(b.indexOf(Math.max(...b)), 1);
  return pf(b);
}

function simulate(d: PerpMarketData, p: Prepared, v: Variant, m: Mode) {
  const fee = m.fee / 10000;
  const slip = m.slip / 10000;
  const times = p.timeline.filter((t) => t >= START && t < END);
  let cash = 10000;
  let peak = 10000;
  let dd = 0;
  let gSum = 0;
  let gMax = 0;
  let obs = 0;
  let twoBars = 0;
  let rank2 = 0;
  let whileHeld = 0;
  let blocked = 0;
  const pos = new Map<string, Position>();
  const pending = new Map<string, { c: Candidate; rank: number }>();
  const exits = new Map<string, string>();
  const cool = new Map<string, number>();
  const pnls: number[] = [];
  const px = (s: string, t: number, f: "open" | "close" = "close") => {
    const i = p.idx[s]?.get(t);
    return i == null ? undefined : p.bars[s]?.[i]?.[f];
  };
  const equity = (t: number, f: "open" | "close" = "close") => {
    let e = cash;
    for (const q of pos.values()) {
      const x = px(q.symbol, t, f) ?? q.entry;
      const dir = q.side === "long" ? 1 : -1;
      e += dir * q.qty * (x - q.entry) - q.qty * x * fee;
    }
    return Math.max(0, e);
  };
  const gross = (t: number, f: "open" | "close" = "close") => {
    const e = Math.max(1, equity(t, f));
    let n = 0;
    for (const q of pos.values()) n += q.qty * (px(q.symbol, t, f) ?? q.entry);
    return n / e;
  };
  const close = (q: Position, raw: number, _reason: string, t: number) => {
    const x = q.side === "long" ? raw * (1 - slip) : raw * (1 + slip);
    const dir = q.side === "long" ? 1 : -1;
    const g = dir * q.qty * (x - q.entry);
    const ef = q.qty * x * fee;
    const net = g - q.entryFee - ef - q.funding;
    cash = Math.max(0, cash + g - ef);
    pnls.push(net);
    pos.delete(q.symbol);
    exits.delete(q.symbol);
    cool.set(q.symbol, t + 2 * H);
  };

  for (const t of times) {
    for (const [s, r] of [...exits]) {
      const q = pos.get(s); const o = px(s, t, "open");
      if (q && o) close(q, o, r, t);
      exits.delete(s);
    }

    for (const [s, x] of [...pending]) {
      if (pos.size >= v.slots || pos.has(s) || (cool.get(s) || 0) > t) { pending.delete(s); continue; }
      const raw = px(s, t, "open");
      if (!raw) { pending.delete(s); continue; }
      const e = equity(t, "open");
      const entry = x.c.side === "long" ? raw * (1 + slip) : raw * (1 - slip);
      const dist = Math.max(x.c.atr * P.stop, entry * 0.005);
      const riskNotional = e * (P.riskPct / 100) / (dist / entry);
      const activeNotional = [...pos.values()].reduce((n, q) => n + q.qty * (px(q.symbol, t, "open") ?? q.entry), 0);
      const residualGrossCapacity = Math.max(0, e * v.aggregateGrossCap - activeNotional);
      const notional = Math.min(riskNotional, e * v.perPositionGrossCap, residualGrossCapacity);
      if (notional / e < 0.1) { blocked += 1; pending.delete(s); continue; }
      const qty = notional / entry;
      const entryFee = notional * fee;
      const initialStop = x.c.side === "long" ? entry - dist : entry + dist;
      const tp = x.c.side === "long" ? entry + x.c.atr * P.tp : entry - x.c.atr * P.tp;
      const had = pos.size > 0;
      cash -= entryFee;
      pos.set(s, {
        symbol: s, side: x.c.side, entry, qty, entryFee, funding: 0, lastFund: t,
        initialStop, stop: initialStop, tp, atr: x.c.atr, peak: entry, trough: entry, bars: 0, rank: x.rank,
      });
      if (x.rank === 2) rank2 += 1;
      if (had) whileHeld += 1;
      pending.delete(s);
    }

    for (const q of [...pos.values()]) {
      const i = p.idx[q.symbol]?.get(t);
      const b = i == null ? undefined : p.bars[q.symbol]?.[i];
      if (!b) continue;
      q.bars += 1;
      const fr = fund(d.fundingBySymbol[q.symbol] || [], q.lastFund, t);
      const fc = q.qty * q.entry * fr * (q.side === "long" ? 1 : -1);
      q.funding += fc;
      q.lastFund = t;
      cash -= fc;
      if (q.side === "long") {
        if (b.low <= q.stop) { close(q, q.stop, q.stop > q.initialStop ? "trail" : "stop", t); continue; }
        if (b.high >= q.tp) { close(q, q.tp, "tp", t); continue; }
      } else {
        if (b.high >= q.stop) { close(q, q.stop, q.stop < q.initialStop ? "trail" : "stop", t); continue; }
        if (b.low <= q.tp) { close(q, q.tp, "tp", t); continue; }
      }
      q.peak = Math.max(q.peak, b.high);
      q.trough = Math.min(q.trough, b.low);
      q.stop = q.side === "long" ? Math.max(q.initialStop, q.peak - q.atr * P.trail) : Math.min(q.initialStop, q.trough + q.atr * P.trail);
    }

    const e = equity(t);
    const g = gross(t);
    peak = Math.max(peak, e);
    dd = Math.max(dd, (peak - e) / peak * 100);
    gSum += g;
    gMax = Math.max(gMax, g);
    obs += 1;
    if (pos.size === 2) twoBars += 1;

    const cs = candidates(p, t).slice(0, v.slots);
    const keys = new Set(cs.map((x) => `${x.symbol}:${x.side}`));
    for (const q of pos.values()) {
      if (q.bars >= P.maxHold) exits.set(q.symbol, "max-hold");
      else if (q.bars >= P.rebalance && !keys.has(`${q.symbol}:${q.side}`)) exits.set(q.symbol, "rotation");
    }
    let slots = Math.max(0, v.slots - [...pos.keys()].filter((s) => !exits.has(s)).length - pending.size);
    for (let r = 0; r < cs.length && slots > 0; r += 1) {
      const c = cs[r];
      if ((pos.has(c.symbol) && !exits.has(c.symbol)) || pending.has(c.symbol) || (cool.get(c.symbol) || 0) > t) continue;
      pending.set(c.symbol, { c, rank: r + 1 });
      slots -= 1;
    }
  }

  for (const q of [...pos.values()]) {
    const last = [...(d.bySymbol[q.symbol] || [])].reverse().find((x) => x.ts < END);
    if (last) close(q, last.close, "end", END);
  }
  const years = (END - START) / (365.25 * 24 * H);
  const returnPct = (cash / 10000 - 1) * 100;
  const cagrPct = (Math.pow(cash / 10000, 1 / years) - 1) * 100;
  return {
    returnPct,
    cagrPct,
    maxDrawdownPct: dd,
    profitFactor: pf(pnls),
    profitFactorWithoutBest: pfwb(pnls),
    winRatePct: pnls.length ? pnls.filter((x) => x > 0).length / pnls.length * 100 : 0,
    tradeCount: pnls.length,
    averageGross: obs ? gSum / obs : 0,
    maximumGross: gMax,
    twoPositionBarPct: obs ? twoBars / obs * 100 : 0,
    rank2Entries: rank2,
    entriesWhileAnotherV12Held: whileHeld,
    capacityBlocks: blocked,
  };
}

async function main() {
  const d = await loadPerpMarketData({ symbols: SYMS, startTs: WARM, endTs: END + 4 * H });
  const p = prep(d);
  const out: any = {
    status: "PASS_RESEARCH_ONLY",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    ordersSent: false,
    period: { startInclusive: new Date(START).toISOString(), endExclusive: new Date(END).toISOString(), calendarDays: (END - START) / (24 * H) },
    dataSource: d.source,
    definition: {
      timeframe: "2H",
      riskPct: P.riskPct,
      perPositionGrossCap: 1.0,
      requestedAggregateGrossCap: 1.5,
      sizing: "risk-linked first candidate plus second-candidate residual gross; no fixed 1.5x fill target",
      variants,
      modes,
    },
    results: {},
  };
  for (const v of variants) {
    out.results[v.name] = {};
    for (const m of modes) out.results[v.name][m.name] = simulate(d, p, v, m);
  }

  const rows = variants.map((v) => ({
    variant: v.name,
    aggregateGrossCap: v.aggregateGrossCap,
    normal: out.results[v.name].normal,
    stress: out.results[v.name].stress,
  }));
  out.ranking = [...rows].sort((a, b) => b.stress.returnPct - a.stress.returnPct);

  await fs.mkdir(".research-state/v12-top2-gross15", { recursive: true });
  await fs.writeFile(".research-state/v12-top2-gross15/result.json", JSON.stringify(out, null, 2) + "\n");

  const header = "variant,aggregateGrossCap,normalReturnPct,normalPF,normalPFWithoutBest,normalDDPct,normalAvgGross,normalMaxGross,stressReturnPct,stressPF,stressPFWithoutBest,stressDDPct,stressAvgGross,stressMaxGross,tradeCountStress,twoPositionBarPctStress,rank2EntriesStress,capacityBlocksStress";
  const csv = [header, ...rows.map((r) => [
    r.variant, r.aggregateGrossCap,
    r.normal.returnPct, r.normal.profitFactor, r.normal.profitFactorWithoutBest, r.normal.maxDrawdownPct, r.normal.averageGross, r.normal.maximumGross,
    r.stress.returnPct, r.stress.profitFactor, r.stress.profitFactorWithoutBest, r.stress.maxDrawdownPct, r.stress.averageGross, r.stress.maximumGross,
    r.stress.tradeCount, r.stress.twoPositionBarPct, r.stress.rank2Entries, r.stress.capacityBlocks,
  ].join(","))].join("\n") + "\n";
  await fs.writeFile(".research-state/v12-top2-gross15/summary.csv", csv);

  const lines = [
    "# V12 Top2 residual GROSS 1.50 — latest one-year backtest",
    "",
    `- Period: ${out.period.startInclusive} to ${out.period.endExclusive}`,
    `- Data source: ${out.dataSource}`,
    "- Research only: true; production/VPS/orders unchanged",
    "- Position sizing: current 3.19% risk-linked sizing; each position <= 1.00x; Top2 aggregate cap tested at 1.00x / 1.25x / 1.50x",
    "",
    "| Variant | Agg cap | Normal return | Normal PF | Normal DD | Stress return | Stress PF | Stress PF w/o best | Stress DD | Avg GROSS stress | Max GROSS stress | 2-pos bars |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((r) => `| ${r.variant} | ${r.aggregateGrossCap.toFixed(2)} | ${r.normal.returnPct.toFixed(2)}% | ${r.normal.profitFactor.toFixed(3)} | -${r.normal.maxDrawdownPct.toFixed(2)}% | ${r.stress.returnPct.toFixed(2)}% | ${r.stress.profitFactor.toFixed(3)} | ${r.stress.profitFactorWithoutBest.toFixed(3)} | -${r.stress.maxDrawdownPct.toFixed(2)}% | ${r.stress.averageGross.toFixed(3)}x | ${r.stress.maximumGross.toFixed(3)}x | ${r.stress.twoPositionBarPct.toFixed(2)}% |`),
    "",
    "The 1.50x cap is a ceiling, not a target. Candidate #1 keeps current risk sizing; candidate #2 uses only residual aggregate GROSS capacity.",
  ];
  await fs.writeFile(".research-state/v12-top2-gross15/report.md", lines.join("\n") + "\n");
  console.log("V12_TOP2_GROSS15=" + JSON.stringify(out));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
