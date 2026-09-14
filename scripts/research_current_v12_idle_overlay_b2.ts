import fs from "node:fs/promises";
import path from "node:path";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpBar, PerpMarketData, PerpSide } from "../lib/research-lab/perp/types";

const H = 3_600_000;
const BAR = 2 * H;
const STUDY_START = Date.UTC(2023, 0, 1);
const CURRENT_START = Date.UTC(2025, 7, 1);
const END = Date.UTC(2026, 7, 1);
const WARM = STUDY_START - 180 * 24 * H;
const SYMS = ["ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"];
const ALL = ["BTC", ...SYMS];
const GROSS = 0.50;

type Prepared = {
  bars: Record<string, PerpBar[]>;
  idx: Record<string, Map<number, number>>;
  timeline: number[];
};

type Family = {
  id: string;
  kind: "XS_TREND" | "PULLBACK" | "VOL_EXP";
  threshold1: number;
  threshold2: number;
  volumeMin: number;
  maxBars: number;
  stopAtr: number;
  targetAtr: number;
};

type Signal = { symbol: string; side: PerpSide; atr: number; score: number };
type Trade = {
  family: string;
  symbol: string;
  side: PerpSide;
  signalTs: number;
  entryTs: number;
  exitTs: number;
  requestedGross: number;
  netUnitReturn: number;
  exitReason: string;
  rank: number;
};

// Fixed before viewing the 2026 holdout. These are structural alternatives,
// not a continuous threshold grid and not relaxations of V12.
const FAMILIES: Family[] = [
  { id: "XS_REL_TREND_25_40", kind: "XS_TREND", threshold1: 0.025, threshold2: 0.040, volumeMin: 0.80, maxBars: 8, stopAtr: 1.5, targetAtr: 2.5 },
  { id: "XS_REL_TREND_40_60", kind: "XS_TREND", threshold1: 0.040, threshold2: 0.060, volumeMin: 1.00, maxBars: 10, stopAtr: 1.5, targetAtr: 2.75 },
  { id: "PULLBACK_REACCEL_60_12", kind: "PULLBACK", threshold1: 0.060, threshold2: 0.012, volumeMin: 0.70, maxBars: 10, stopAtr: 1.5, targetAtr: 2.25 },
  { id: "PULLBACK_REACCEL_90_15", kind: "PULLBACK", threshold1: 0.090, threshold2: 0.015, volumeMin: 0.80, maxBars: 12, stopAtr: 1.5, targetAtr: 2.50 },
  { id: "TREND_VOL_EXP_82_120", kind: "VOL_EXP", threshold1: 0.82, threshold2: 0.030, volumeMin: 1.20, maxBars: 10, stopAtr: 1.5, targetAtr: 2.75 },
  { id: "TREND_VOL_EXP_70_140", kind: "VOL_EXP", threshold1: 0.70, threshold2: 0.050, volumeMin: 1.40, maxBars: 12, stopAtr: 1.5, targetAtr: 3.00 },
];

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : Number.NaN;
}
function sma(b: PerpBar[], i: number, n: number) {
  return i >= n - 1 ? mean(b.slice(i - n + 1, i + 1).map((x) => x.close)) : Number.NaN;
}
function mom(b: PerpBar[], i: number, n: number) {
  return i >= n ? b[i].close / b[i - n].close - 1 : Number.NaN;
}
function atr(b: PerpBar[], i: number, n: number) {
  if (i < n) return Number.NaN;
  const rows: number[] = [];
  for (let j = i - n + 1; j <= i; j += 1) {
    rows.push(Math.max(
      b[j].high - b[j].low,
      Math.abs(b[j].high - b[j - 1].close),
      Math.abs(b[j].low - b[j - 1].close),
    ));
  }
  return mean(rows);
}
function volumeRatio(b: PerpBar[], i: number, n = 20) {
  if (i < n) return Number.NaN;
  const prior = mean(b.slice(i - n, i).map((x) => x.volume));
  return prior > 0 ? b[i].volume / prior : Number.NaN;
}
function resample(a: PerpBar[]) {
  const out = new Map<number, PerpBar>();
  for (const x of a) {
    const ts = Math.floor(x.ts / BAR) * BAR;
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
function firstFunding(a: { ts: number; rate: number }[], ts: number) {
  let l = 0;
  let r = a.length;
  while (l < r) {
    const m = (l + r) >> 1;
    if (a[m].ts <= ts) l = m + 1;
    else r = m;
  }
  return l;
}
function funding(a: { ts: number; rate: number }[], from: number, to: number) {
  let i = firstFunding(a, from);
  let total = 0;
  for (; i < a.length && a[i].ts <= to; i += 1) total += a[i].rate;
  return total;
}
function btcContext(p: Prepared, ts: number) {
  const i = p.idx.BTC?.get(ts);
  const b = p.bars.BTC;
  if (i == null || !b || i < 80) return null;
  const m24 = mom(b, i, 12);
  const m72 = mom(b, i, 36);
  const s72 = sma(b, i, 36);
  if (![m24, m72, s72].every(Number.isFinite)) return null;
  return { i, b, m24, m72, above72: b[i].close > s72 };
}
function volCompressed(b: PerpBar[], i: number, ratio: number) {
  if (i < 60) return false;
  const recent: number[] = [];
  const prior: number[] = [];
  for (let j = i - 6; j <= i - 1; j += 1) recent.push(atr(b, j, 20));
  for (let j = i - 36; j <= i - 7; j += 1) prior.push(atr(b, j, 20));
  const r = mean(recent.filter(Number.isFinite));
  const q = mean(prior.filter(Number.isFinite));
  return Number.isFinite(r) && Number.isFinite(q) && q > 0 && r <= ratio * q;
}

function rawSignal(p: Prepared, family: Family, ts: number): Signal | null {
  const btc = btcContext(p, ts);
  if (!btc) return null;
  const candidates: Signal[] = [];

  for (const symbol of SYMS) {
    const i = p.idx[symbol]?.get(ts);
    const b = p.bars[symbol];
    if (i == null || !b || i < 80) continue;
    const a = atr(b, i, 20);
    const v = volumeRatio(b, i, 20);
    const m24 = mom(b, i, 12);
    const m72 = mom(b, i, 36);
    const m6 = mom(b, i, 3);
    const s72 = sma(b, i, 36);
    if (![a, v, m24, m72, m6, s72].every(Number.isFinite) || a <= 0 || v < family.volumeMin) continue;
    const r24 = m24 - btc.m24;
    const r72 = m72 - btc.m72;

    if (family.kind === "XS_TREND") {
      const longOk = r24 >= family.threshold1 && r72 >= family.threshold2 && m72 > 0 && b[i].close > s72;
      const shortOk = r24 <= -family.threshold1 && r72 <= -family.threshold2 && m72 < 0 && b[i].close < s72;
      if (longOk) candidates.push({ symbol, side: "long", atr: a, score: r24 + 0.5 * r72 + 0.01 * v });
      if (shortOk) candidates.push({ symbol, side: "short", atr: a, score: -r24 - 0.5 * r72 + 0.01 * v });
    } else if (family.kind === "PULLBACK") {
      const maxPullback = family.id.endsWith("60_12") ? 0.050 : 0.065;
      const bullishResume = b[i].close > b[i].open && b[i].close > b[i - 1].close;
      const bearishResume = b[i].close < b[i].open && b[i].close < b[i - 1].close;
      const longOk = m72 >= family.threshold1 && r72 >= 0.02 && m6 <= -family.threshold2 && m6 >= -maxPullback && bullishResume && b[i].close > s72;
      const shortOk = m72 <= -family.threshold1 && r72 <= -0.02 && m6 >= family.threshold2 && m6 <= maxPullback && bearishResume && b[i].close < s72;
      if (longOk) candidates.push({ symbol, side: "long", atr: a, score: m72 - m6 + Math.max(0, r72) });
      if (shortOk) candidates.push({ symbol, side: "short", atr: a, score: -m72 + m6 + Math.max(0, -r72) });
    } else {
      const prior = b.slice(i - 12, i);
      if (prior.length !== 12 || !volCompressed(b, i, family.threshold1)) continue;
      const longBreak = b[i].close > Math.max(...prior.map((x) => x.high));
      const shortBreak = b[i].close < Math.min(...prior.map((x) => x.low));
      const longOk = longBreak && m72 >= family.threshold2 && r24 > 0 && b[i].close > s72;
      const shortOk = shortBreak && m72 <= -family.threshold2 && r24 < 0 && b[i].close < s72;
      if (longOk) candidates.push({ symbol, side: "long", atr: a, score: m72 + r24 + 0.02 * v });
      if (shortOk) candidates.push({ symbol, side: "short", atr: a, score: -m72 - r24 + 0.02 * v });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0] || null;
}

function buildTrades(d: PerpMarketData, p: Prepared, family: Family, stress: boolean): Trade[] {
  const fee = (stress ? 10 : 5) / 10000;
  const slip = (stress ? 5 : 0) / 10000;
  const out: Trade[] = [];
  let blockedUntil = STUDY_START;

  for (const ts of p.timeline) {
    if (ts < STUDY_START || ts >= END || ts < blockedUntil) continue;
    const sig = rawSignal(p, family, ts);
    if (!sig) continue;
    const i = p.idx[sig.symbol]?.get(ts);
    const b = p.bars[sig.symbol];
    if (i == null || !b || i + 1 >= b.length) continue;
    const entryBar = b[i + 1];
    if (entryBar.ts >= END) continue;
    const entryRaw = entryBar.open;
    const entry = sig.side === "long" ? entryRaw * (1 + slip) : entryRaw * (1 - slip);
    const stop = sig.side === "long" ? entryRaw - family.stopAtr * sig.atr : entryRaw + family.stopAtr * sig.atr;
    const target = sig.side === "long" ? entryRaw + family.targetAtr * sig.atr : entryRaw - family.targetAtr * sig.atr;
    let exitTs = entryBar.ts;
    let exitRaw = entryBar.close;
    let reason = "time";
    const last = Math.min(b.length - 1, i + family.maxBars);

    for (let k = i + 1; k <= last; k += 1) {
      const bar = b[k];
      if (sig.side === "long") {
        if (bar.low <= stop) { exitTs = bar.ts; exitRaw = stop; reason = "stop"; break; }
        if (bar.high >= target) { exitTs = bar.ts; exitRaw = target; reason = "target"; break; }
      } else {
        if (bar.high >= stop) { exitTs = bar.ts; exitRaw = stop; reason = "stop"; break; }
        if (bar.low <= target) { exitTs = bar.ts; exitRaw = target; reason = "target"; break; }
      }
      exitTs = bar.ts;
      exitRaw = bar.close;
    }

    const exit = sig.side === "long" ? exitRaw * (1 - slip) : exitRaw * (1 + slip);
    const rawRet = sig.side === "long" ? exit / entry - 1 : entry / exit - 1;
    const fr = funding(d.fundingBySymbol[sig.symbol] || [], entryBar.ts, exitTs);
    const fundingRet = sig.side === "long" ? -fr : fr;
    const net = rawRet + fundingRet - 2 * fee;
    out.push({
      family: family.id,
      symbol: sig.symbol,
      side: sig.side,
      signalTs: ts,
      entryTs: entryBar.ts,
      exitTs,
      requestedGross: GROSS,
      netUnitReturn: net,
      exitReason: `B2_${reason.toUpperCase()}`,
      rank: 3,
    });
    blockedUntil = exitTs + BAR;
  }
  return out;
}

function metrics(rows: Trade[]) {
  let eq = 1;
  let peak = 1;
  let dd = 0;
  let gp = 0;
  let gl = 0;
  for (const t of rows) {
    const r = GROSS * t.netUnitReturn;
    eq *= Math.max(1e-9, 1 + r);
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
    if (r > 0) gp += r;
    else gl -= r;
  }
  return {
    trades: rows.length,
    returnPct: (eq - 1) * 100,
    profitFactor: gl > 0 ? gp / gl : (gp > 0 ? 999 : null),
    winRatePct: rows.length ? rows.filter((t) => t.netUnitReturn > 0).length / rows.length * 100 : 0,
    maxDrawdownPct: dd * 100,
  };
}
function segment(rows: Trade[], start: number, end: number) {
  return rows.filter((t) => t.entryTs >= start && t.entryTs < end);
}
function overlapsBaseline(t: Trade, baseline: any[]) {
  return baseline.some((x) => Number(x.entryTs) < t.exitTs && Number(x.exitTs) > t.entryTs);
}
function key(t: Trade) {
  return `${t.symbol}|${t.side}|${t.signalTs}|${t.entryTs}`;
}
function pf(x: ReturnType<typeof metrics>) {
  return Number(x.profitFactor || 0);
}

async function main() {
  const baselinePath = process.env.V12_LEDGER_IN;
  if (!baselinePath) throw new Error("V12_LEDGER_IN required");
  const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  const baselineTrades: any[] = baseline.modes.normal.trades;
  const d = await loadPerpMarketData({ symbols: ALL, startTs: WARM, endTs: END + 4 * H });
  const p = prep(d);

  const periods = [
    { id: "DEV_2023", start: Date.UTC(2023, 0, 1), end: Date.UTC(2024, 0, 1) },
    { id: "VAL_2024", start: Date.UTC(2024, 0, 1), end: Date.UTC(2025, 0, 1) },
    { id: "PREHOLDOUT_2025", start: Date.UTC(2025, 0, 1), end: Date.UTC(2026, 0, 1) },
    { id: "HOLDOUT_2026", start: Date.UTC(2026, 0, 1), end: END },
  ];

  const studies: any[] = [];
  const store = new Map<string, { normal: Trade[]; stress: Trade[] }>();
  for (const family of FAMILIES) {
    const normal = buildTrades(d, p, family, false);
    const stress = buildTrades(d, p, family, true);
    store.set(family.id, { normal, stress });
    const splits: any = {};
    for (const q of periods) {
      splits[q.id] = {
        normal: metrics(segment(normal, q.start, q.end)),
        stress: metrics(segment(stress, q.start, q.end)),
      };
    }
    const preNormal = segment(normal, STUDY_START, Date.UTC(2026, 0, 1));
    const preStress = segment(stress, STUDY_START, Date.UTC(2026, 0, 1));
    const preN = metrics(preNormal);
    const preS = metrics(preStress);
    const yearly = [splits.DEV_2023, splits.VAL_2024, splits.PREHOLDOUT_2025];
    const positiveYears = yearly.filter((x) => x.normal.returnPct > 0).length;
    const minimumYearReturn = Math.min(...yearly.map((x) => x.normal.returnPct));
    const enoughEachYear = yearly.every((x) => x.normal.trades >= 10);
    const eligible =
      positiveYears >= 2
      && minimumYearReturn >= -3.0
      && enoughEachYear
      && preN.trades >= 45
      && preN.returnPct > 0
      && pf(preN) >= 1.15
      && preN.maxDrawdownPct >= -25
      && preS.returnPct > 0
      && pf(preS) >= 1.05
      && splits.PREHOLDOUT_2025.normal.returnPct > 0
      && splits.PREHOLDOUT_2025.stress.returnPct >= 0;
    const selectionScore = minimumYearReturn + 0.15 * preN.returnPct + 4 * Math.max(0, pf(preN) - 1);
    studies.push({
      family: family.id,
      structure: family.kind,
      eligiblePreHoldout: eligible,
      selectionScore,
      positiveYears,
      minimumYearReturn,
      splits,
      pre2026: { normal: preN, stress: preS },
    });
  }

  const preSelected = [...studies]
    .filter((x) => x.eligiblePreHoldout)
    .sort((a, b) => b.selectionScore - a.selectionScore || a.family.localeCompare(b.family))[0] || null;

  let promoted: any = null;
  let currentLedger: any = null;
  if (preSelected) {
    const h = preSelected.splits.HOLDOUT_2026;
    const holdoutPass =
      h.normal.trades >= 8
      && h.normal.returnPct > 0
      && Number(h.normal.profitFactor || 0) >= 1.05
      && h.normal.maxDrawdownPct >= -15
      && h.stress.returnPct >= 0
      && Number(h.stress.profitFactor || 0) >= 1.0;
    if (holdoutPass) {
      promoted = preSelected;
      const pair = store.get(promoted.family)!;
      const stressMap = new Map(pair.stress.map((t) => [key(t), t]));
      const idleNormal = pair.normal.filter((t) => t.entryTs >= CURRENT_START && !overlapsBaseline(t, baselineTrades));
      const idleStress = idleNormal.map((t) => stressMap.get(key(t))).filter((x): x is Trade => Boolean(x));
      currentLedger = {
        schema: "current-v12-idle-overlay-b2/v1",
        strategyId: promoted.family,
        researchOnly: true,
        definition: {
          gross: GROSS,
          priority: "below current V12 rank1/rank2; entry only while frozen current V12 standalone is idle",
          selectionUses2026: false,
        },
        modes: {
          normal: { metrics: metrics(idleNormal), trades: idleNormal },
          stress: { metrics: metrics(idleStress), trades: idleStress },
        },
      };
    }
  }

  const payload = {
    status: "PASS_RESEARCH_ONLY",
    schema: "weak-month-b2-pre2026-selection-holdout/v1",
    studyPeriod: { startInclusive: new Date(STUDY_START).toISOString(), endExclusive: new Date(END).toISOString() },
    selection: {
      rule: "six fixed structural candidates; select only from 2023/2024/2025; then audit untouched 2026",
      eligibility: {
        positiveYearsMinimum: 2,
        minimumYearReturnPct: -3,
        minimumTradesEachYear: 10,
        aggregateTradesMinimum: 45,
        aggregateNormalPfMinimum: 1.15,
        aggregateStressPfMinimum: 1.05,
        preholdout2025NormalPositive: true,
        preholdout2025StressNonNegative: true,
      },
      preSelected: preSelected?.family || null,
      holdoutPromoted: promoted?.family || null,
      holdoutRule: "2026 normal return >0, PF>=1.05, DD>=-15%, stress return>=0, stress PF>=1.0, trades>=8",
    },
    families: studies,
    currentIdleLedger: currentLedger,
    safety: { mode: "RESEARCH_ONLY", ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };

  const out = process.env.B2_OVERLAY_OUT || ".research-state/weak-month-b2/result.json";
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    status: payload.status,
    selection: payload.selection,
    families: payload.families,
    currentIdleLedger: payload.currentIdleLedger,
    safety: payload.safety,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
