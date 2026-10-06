import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import {
  buildPenguDualLsV2EvaluationSeries,
  cooldownHoursForPenguExit,
  evaluatePenguDualLsV2PositionBar,
  type PenguDualLsV2EvaluationRow,
  type PenguDualLsV2Features,
  type PenguDualLsV2History,
  type PenguDualLsV2Position,
} from "../lib/pengu-dual-ls-v2";
import { createPenguShortV20State } from "../lib/pengu-short-v20";
import {
  createPenguRiskOverlayState,
  evaluatePenguNewEntryGate,
  recordPenguClosedTrade,
  recordPenguHardStop,
  routeForPenguEntryVersion,
  type PenguRiskOverlayState,
} from "../lib/pengu-route-quarantine-dd-governor";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const NORMAL_FEE_PER_SIDE = 0.0006;
const STRESS_EXTRA_PER_SIDE = 0.0035;

type Funding = { fundingTime: number; fundingRate: number };
type Mode = "normal" | "stress";
type StructuralMode = "NONE" | "COUNTERWIND_2PCT" | "BTC_POS_BTC24_NEG_2PCT";

type Spec = {
  name: string;
  regime72Max: number;
  structural: StructuralMode;
  weakTrendRebreakThreshold?: number;
  weakTrendRebreakTolerance?: number;
};

const SPECS: Spec[] = [
  { name: "R0_CURRENT", regime72Max: 0, structural: "NONE" },
  { name: "G025_P72_LE_M0P25", regime72Max: -0.0025, structural: "NONE" },
  { name: "G050_P72_LE_M0P50", regime72Max: -0.005, structural: "NONE" },
  { name: "G075_P72_LE_M0P75", regime72Max: -0.0075, structural: "NONE" },
  { name: "R1_P72_LE_M1", regime72Max: -0.01, structural: "NONE" },
  { name: "R2_P72_LE_M2", regime72Max: -0.02, structural: "NONE" },
  { name: "R3_P72_LE_M3", regime72Max: -0.03, structural: "NONE" },
  { name: "R4_P72_LE_M4", regime72Max: -0.04, structural: "NONE" },
  { name: "R5_P72_LE_M5", regime72Max: -0.05, structural: "NONE" },
  { name: "R6_P72_LE_M7P5", regime72Max: -0.075, structural: "NONE" },
  { name: "R7_P72_LE_M10", regime72Max: -0.10, structural: "NONE" },
  { name: "R8_P72_M3_COUNTERWIND_REBREAK2", regime72Max: -0.03, structural: "COUNTERWIND_2PCT" },
  { name: "R9_P72_M3_BTC_POS_BTC24_NEG_REBREAK2", regime72Max: -0.03, structural: "BTC_POS_BTC24_NEG_2PCT" },
  { name: "R10_WEAK72_M3_REBREAK2", regime72Max: 0, structural: "NONE", weakTrendRebreakThreshold: -0.03, weakTrendRebreakTolerance: 0.02 },
  { name: "R11_WEAK72_M4_REBREAK2", regime72Max: 0, structural: "NONE", weakTrendRebreakThreshold: -0.04, weakTrendRebreakTolerance: 0.02 },
  { name: "R12_WEAK72_M5_REBREAK2", regime72Max: 0, structural: "NONE", weakTrendRebreakThreshold: -0.05, weakTrendRebreakTolerance: 0.02 },
  { name: "R13_WEAK72_M4_REBREAK1", regime72Max: 0, structural: "NONE", weakTrendRebreakThreshold: -0.04, weakTrendRebreakTolerance: 0.01 },
  { name: "R14_WEAK72_M5_REBREAK1", regime72Max: 0, structural: "NONE", weakTrendRebreakThreshold: -0.05, weakTrendRebreakTolerance: 0.01 },
  { name: "R15_WEAK72_M4_REBREAK3", regime72Max: 0, structural: "NONE", weakTrendRebreakThreshold: -0.04, weakTrendRebreakTolerance: 0.03 },
  { name: "R16_BTC_POS_BTC24_NEG_REBREAK2", regime72Max: 0, structural: "BTC_POS_BTC24_NEG_2PCT" },
  { name: "R17_P72_M4_BTC_POS_BTC24_NEG_REBREAK2", regime72Max: -0.04, structural: "BTC_POS_BTC24_NEG_2PCT" },
  { name: "R18_P72_M4_COUNTERWIND_REBREAK2", regime72Max: -0.04, structural: "COUNTERWIND_2PCT" },
];

type Trade = {
  signalTs: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  accountReturn: number;
  exitReason: string;
  entryFeatures: PenguDualLsV2Features;
  counterwind: boolean;
};

function envDate(name: string) {
  const raw = process.env[name];
  if (!raw) throw new Error(name + "_REQUIRED");
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) throw new Error(name + "_INVALID:" + raw);
  return ts;
}

const EVAL_START = envDate("PENGU_STUDY_EVAL_START");
const EVAL_END = envDate("PENGU_STUDY_EVAL_END");
const DATA_DIR = process.env.PENGU_LOCAL_DATA_DIR || ".research-state/okx-pengu-proxy";
const OUT = process.env.PENGU_STUDY_OUT || ".research-state/pengu-okx-short-regime-causal.json";
const LABEL = process.env.PENGU_STUDY_DATA_LABEL || "UNKNOWN";

function fundingBetween(points: Funding[], entryTs: number, exitTs: number) {
  return points
    .filter((p) => p.fundingTime > entryTs && p.fundingTime <= exitTs)
    .reduce((sum, p) => sum + p.fundingRate, 0);
}

function buildShortSignals(rows: PenguDualLsV2EvaluationRow[], spec: Spec) {
  const rule = PENGU_DUAL_LS_V2.short;
  const signals = new Array<boolean>(rows.length).fill(false);
  let active = false;
  let armed = false;
  let localLow = 0;
  let armedLow = 0;
  let expiry = -1;

  for (let index = 180; index < rows.length; index += 1) {
    const f = rows[index].features;
    if (!f) continue;

    if (active && index > expiry) {
      active = false; armed = false; localLow = 0; armedLow = 0;
    }

    if (f.penguReturn24h <= rule.impulseReturn24hMaximum) {
      if (!active) {
        active = true;
        armed = false;
        localLow = f.low;
        armedLow = 0;
        expiry = index + rule.setupExpiryHours;
      } else {
        localLow = Math.min(localLow, f.low);
        expiry = Math.max(expiry, index + 1);
      }
    }
    if (!active) continue;

    localLow = Math.min(localLow, f.low);
    const bounce = f.close / localLow - 1;
    if (bounce > rule.invalidateBounceAbove) {
      active = false; armed = false; localLow = 0; armedLow = 0;
      continue;
    }

    if (!armed && bounce + 1e-12 >= rule.armBounceMinimum) {
      armed = true;
      armedLow = localLow;
    }
    if (!armed) continue;

    const structuralCondition =
      spec.structural === "COUNTERWIND_2PCT"
        ? (f.btcEma168Distance >= 0 || f.btcReturn24h >= 0)
        : spec.structural === "BTC_POS_BTC24_NEG_2PCT"
          ? (f.btcEma168Distance >= 0 && f.btcReturn24h < 0)
          : false;
    const structuralPass =
      spec.structural === "NONE"
      || !structuralCondition
      || f.close <= armedLow * 1.02 + 1e-12;
    const weakTrendRebreakPass =
      spec.weakTrendRebreakThreshold === undefined
      || spec.weakTrendRebreakTolerance === undefined
      || f.penguReturn72h <= spec.weakTrendRebreakThreshold
      || f.close <= armedLow * (1 + spec.weakTrendRebreakTolerance) + 1e-12;

    const eligible = structuralPass
      && weakTrendRebreakPass
      && f.penguReturn72h <= spec.regime72Max
      && f.close < f.previousLow
      && f.close < f.ema72
      && f.ema72 < f.ema168
      && f.relativeReturn24h <= rule.relativeReturn24hMaximum
      && f.volumeRatio6OverPrior36 >= rule.volumeRatioMinimum
      && f.volumeRatio6OverPrior36 <= rule.volumeRatioMaximum
      && f.btcReturn24h <= rule.btcReturn24hMaximum
      && f.penguReturn24h >= rule.penguReturn24hMinimum
      && f.btcEma168Distance >= rule.btcEma168DistanceMinimum
      && f.rsi14 >= rule.rsiMinimum;

    if (eligible) {
      signals[index] = true;
      active = false; armed = false; localLow = 0; armedLow = 0;
    }
  }
  return signals;
}

function metrics(trades: Trade[]) {
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    equity *= 1 + t.accountReturn;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity / peak - 1);
    if (t.accountReturn > 0) grossProfit += t.accountReturn;
    else grossLoss -= t.accountReturn;
  }
  return {
    trades: trades.length,
    wins: trades.filter((t) => t.accountReturn > 0).length,
    losses: trades.filter((t) => t.accountReturn <= 0).length,
    returnPct: (equity - 1) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownPct: maxDd * 100,
    winRatePct: trades.length ? trades.filter((t) => t.accountReturn > 0).length / trades.length * 100 : null,
    hardStops: trades.filter((t) => t.exitReason === "SHORT_HARD_STOP").length,
    avgReturnPct: trades.length ? trades.reduce((s, t) => s + t.accountReturn, 0) / trades.length * 100 : null,
  };
}

function replay(rows: PenguDualLsV2EvaluationRow[], funding: Funding[], mode: Mode, spec: Spec) {
  const signals = buildShortSignals(rows, spec);
  const costPerSide = NORMAL_FEE_PER_SIDE + (mode === "stress" ? STRESS_EXTRA_PER_SIDE : 0);
  const route = routeForPenguEntryVersion("SHORT_V20");
  let risk: PenguRiskOverlayState = createPenguRiskOverlayState();
  let position: PenguDualLsV2Position | undefined;
  let entryFeatures: PenguDualLsV2Features | undefined;
  let signalTs = 0;
  let cooldownUntilTs = 0;
  const trades: Trade[] = [];
  const blocked = { cooldown: 0, routeQuarantine: 0, ddHold: 0 };

  for (let i = 180; i < rows.length - 1; i += 1) {
    const row = rows[i];
    const f = row.features;
    if (!f) continue;

    if (position) {
      const before = position;
      const ev = evaluatePenguDualLsV2PositionBar(position, f);
      position = ev.updatedPosition;
      if (ev.exit) {
        assert(entryFeatures);
        const exitPrice = ev.exit.stopPrice ?? row.candle.close;
        const exitTs = row.candle.openTime;
        const raw = before.entryPrice / exitPrice - 1;
        const fundingReturn = fundingBetween(funding, before.entryTs, exitTs);
        const accountReturn = raw + fundingReturn - 2 * costPerSide;
        if (before.entryTs >= EVAL_START && before.entryTs < EVAL_END) {
          trades.push({
            signalTs,
            entryTs: before.entryTs,
            exitTs,
            entryPrice: before.entryPrice,
            exitPrice,
            accountReturn,
            exitReason: ev.exit.reason,
            entryFeatures,
            counterwind: before.shortV20?.counterwind === true,
          });
        }
        risk = recordPenguClosedTrade(risk, route, accountReturn, exitTs);
        if (ev.exit.reason === "SHORT_HARD_STOP") risk = recordPenguHardStop(risk, route, exitTs);
        cooldownUntilTs = row.candle.openTime + cooldownHoursForPenguExit(ev.exit.reason as any) * HOUR;
        position = undefined;
        entryFeatures = undefined;
        signalTs = 0;
      }
      continue;
    }

    if (!signals[i]) continue;
    if (f.referenceTs < cooldownUntilTs) { blocked.cooldown += 1; continue; }

    const gate = evaluatePenguNewEntryGate(risk, route, f.referenceTs);
    if (!gate.allowed) {
      if (gate.reason === "PENGU_ROUTE_QUARANTINED") blocked.routeQuarantine += 1;
      else if (gate.reason === "PENGU_REALIZED_DD_HOLD") blocked.ddHold += 1;
      continue;
    }

    const entry = rows[i + 1].candle;
    if (!(entry.openTime < EVAL_END)) continue;
    signalTs = f.referenceTs;
    entryFeatures = { ...f };
    position = {
      side: -1,
      entryTs: entry.openTime,
      entryPrice: entry.open,
      quantity: 1,
      gross: 1.0,
      highWaterMark: entry.open,
      lowWaterMark: entry.open,
      entryVersion: "SHORT_V20",
      shortV20: createPenguShortV20State({
        entryPrice: entry.open,
        requestedGross: 1.0,
        entryAtr24Ratio: f.atr24Ratio,
        btcEma168Distance: f.btcEma168Distance,
        btcReturn24h: f.btcReturn24h,
      }),
    };
  }

  return { metrics: metrics(trades), blocked, trades };
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, name), "utf8")) as T;
}

async function main() {
  assert.equal(PENGU_DUAL_LS_V2.id, "PENGU_DUAL_LS_V2_FINAL");
  assert.equal(PENGU_DUAL_LS_V2.logicProfile, "COMBINED_FILTERED_Q60_DD17_H72");
  assert.equal(PENGU_DUAL_LS_V2.routeHardStopQuarantineHours, 60);
  assert.equal(PENGU_DUAL_LS_V2.realizedDrawdownThresholdPct, 17);
  assert.equal(PENGU_DUAL_LS_V2.realizedDrawdownHoldHours, 72);

  const [penguRaw, btcRaw, funding] = await Promise.all([
    readJson<DisDexV35Candle[]>("PENGUUSDT-candles.json"),
    readJson<DisDexV35Candle[]>("BTCUSDT-candles.json"),
    readJson<Funding[]>("PENGUUSDT-funding.json"),
  ]);

  const btcTs = new Set(btcRaw.map((r) => r.openTime));
  const pengu = penguRaw.filter((r) => btcTs.has(r.openTime));
  const penguTs = new Set(pengu.map((r) => r.openTime));
  const btc = btcRaw.filter((r) => penguTs.has(r.openTime));
  assert.equal(pengu.length, btc.length);
  assert.ok(pengu.length >= 250);

  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: funding };
  const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);

  const results: Record<string, unknown> = {};
  for (const spec of SPECS) {
    results[spec.name] = {
      spec,
      normal: replay(rows, funding, "normal", spec),
      stress: replay(rows, funding, "stress", spec),
    };
  }

  const payload = {
    schema: "pengu-short-regime-causal-fixed-gross1/v1",
    dataLabel: LABEL,
    period: {
      startInclusive: new Date(EVAL_START).toISOString(),
      endExclusive: new Date(EVAL_END).toISOString(),
    },
    data: {
      availableStart: new Date(pengu[0].openTime).toISOString(),
      availableEndExclusive: new Date(pengu.at(-1)!.openTime + HOUR).toISOString(),
      commonH1Rows: pengu.length,
      fundingRows: funding.length,
    },
    fixedContract: {
      shortOnly: true,
      gross: 1.0,
      routeQuarantineHours: 60,
      realizedDrawdownThresholdPct: 17,
      realizedDrawdownHoldHours: 72,
      shortHardStopPct: PENGU_DUAL_LS_V2.short.hardStopPct,
      shortMaxHoldHours: PENGU_DUAL_LS_V2.short.maxHoldHours,
      exitsUnchanged: true,
    },
    results,
    safety: { researchOnly: true, ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  const compact: Record<string, unknown> = {};
  for (const spec of SPECS) {
    const x = results[spec.name] as any;
    compact[spec.name] = { normal: x.normal.metrics, stress: x.stress.metrics };
  }
  console.log("PENGU_SHORT_REGIME_CAUSAL=" + JSON.stringify({ label: LABEL, period: payload.period, data: payload.data, compact }));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

