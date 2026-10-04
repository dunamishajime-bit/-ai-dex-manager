import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import { PENGU_RECOVERY_V8, PENGU_V8_V64_BASE } from "../config/penguRecoveryV8";
import {
  buildPenguDualLsV2EvaluationSeries,
  cooldownHoursForPenguExit,
  evaluatePenguDualLsV2PositionBar,
  penguV8BreakoutAtrScore,
  penguV8V64RequestedLongGross,
  selectPenguRecoveryV8Entry,
  targetGrossForAtr,
  type PenguDualLsV2EvaluationRow,
  type PenguDualLsV2Features,
  type PenguDualLsV2History,
  type PenguDualLsV2Position,
} from "../lib/pengu-dual-ls-v2";
import { createPenguShortV20State } from "../lib/pengu-short-v20";
import { evaluateRecoveryV8PositionBar, type RecoveryV8FeatureRow } from "../lib/pengu-recovery-v8";
import {
  createPenguRiskOverlayState,
  evaluatePenguNewEntryGate,
  recordPenguClosedTrade,
  recordPenguHardStop,
  routeForPenguEntryVersion,
  type PenguRiskOverlayState,
  type PenguRiskRoute,
} from "../lib/pengu-route-quarantine-dd-governor";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const SOURCE_SHA = "53eeff5417636369d4709fddfd47d7916ddcf3b1";
const NORMAL_FEE_PER_SIDE = 0.0006;
const STRESS_EXTRA_PER_SIDE = 0.0035;

type Mode = "normal" | "stress";
type Funding = { fundingTime: number; fundingRate: number };
type EntryVersion = "LONG_V2_FINAL" | "SHORT_V20" | "RECOVERY_V8";
type LongKind = "BASE_LONG" | "V64_SUPPLEMENTAL";

type ShortSpec = {
  name: string;
  armAfterImpulseBars: number;
  signalAfterArmBars: number;
  rebreakTolerance: number | null;
  rebreakCondition?: "ALWAYS" | "COUNTERWIND" | "BTC_EMA_POS" | "BTC_EMA_POS_BTC24_NEG";
};

type LongSpec = {
  name: string;
  supplementalRegime72Min: number;
  breakoutAtrFloor: number;
};

type Trade = {
  route: PenguRiskRoute;
  entryVersion: EntryVersion;
  longKind?: LongKind;
  side: "LONG" | "SHORT";
  signalTs: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  requestedGross: number;
  exitReason: string;
  rawUnitReturn: number;
  fundingUnitReturn: number;
  costUnitReturn: number;
  accountReturn: number;
  counterwind?: boolean;
  partialDefense?: { gross: number; exitTs: number; exitPrice: number; accountReturn: number };
  entryFeatures: PenguDualLsV2Features;
};

const SHORT_SPECS: ShortSpec[] = [
  { name: "S0_CURRENT", armAfterImpulseBars: 0, signalAfterArmBars: 0, rebreakTolerance: null },
  { name: "S1_ARM_NEXT_BAR", armAfterImpulseBars: 1, signalAfterArmBars: 0, rebreakTolerance: null },
  { name: "S2_ARM_AND_SIGNAL_SEPARATE", armAfterImpulseBars: 1, signalAfterArmBars: 1, rebreakTolerance: null },
  { name: "S3_STRUCT_REBREAK_2PCT", armAfterImpulseBars: 1, signalAfterArmBars: 1, rebreakTolerance: 0.02, rebreakCondition: "ALWAYS" },
  { name: "S4_STRUCT_REBREAK_1PCT", armAfterImpulseBars: 1, signalAfterArmBars: 1, rebreakTolerance: 0.01, rebreakCondition: "ALWAYS" },
  { name: "S5_STRUCT_REBREAK_0P5PCT", armAfterImpulseBars: 1, signalAfterArmBars: 1, rebreakTolerance: 0.005, rebreakCondition: "ALWAYS" },
  { name: "S6_STRUCT_REBREAK_STRICT", armAfterImpulseBars: 1, signalAfterArmBars: 1, rebreakTolerance: 0.0, rebreakCondition: "ALWAYS" },
  { name: "S7_COUNTERWIND_REBREAK_2PCT", armAfterImpulseBars: 0, signalAfterArmBars: 0, rebreakTolerance: 0.02, rebreakCondition: "COUNTERWIND" },
  { name: "S8_COUNTERWIND_REBREAK_1PCT", armAfterImpulseBars: 0, signalAfterArmBars: 0, rebreakTolerance: 0.01, rebreakCondition: "COUNTERWIND" },
  { name: "S9_BTC_EMA_POS_REBREAK_2PCT", armAfterImpulseBars: 0, signalAfterArmBars: 0, rebreakTolerance: 0.02, rebreakCondition: "BTC_EMA_POS" },
  { name: "S10_BTC_EMA_POS_BTC24_NEG_REBREAK_2PCT", armAfterImpulseBars: 0, signalAfterArmBars: 0, rebreakTolerance: 0.02, rebreakCondition: "BTC_EMA_POS_BTC24_NEG" },
  { name: "S11_BTC_EMA_POS_BTC24_NEG_REBREAK_1PCT", armAfterImpulseBars: 0, signalAfterArmBars: 0, rebreakTolerance: 0.01, rebreakCondition: "BTC_EMA_POS_BTC24_NEG" },
];

const LONG_SPECS: LongSpec[] = [
  { name: "L0_CURRENT", supplementalRegime72Min: Number.NEGATIVE_INFINITY, breakoutAtrFloor: PENGU_V8_V64_BASE.breakoutAtrFloor },
  { name: "L1_SUPP_REGIME_GE_0", supplementalRegime72Min: 0.0, breakoutAtrFloor: PENGU_V8_V64_BASE.breakoutAtrFloor },
  { name: "L2_SUPP_REGIME_GE_5PCT", supplementalRegime72Min: 0.05, breakoutAtrFloor: PENGU_V8_V64_BASE.breakoutAtrFloor },
  { name: "L3_SUPP_REGIME_GE_10PCT", supplementalRegime72Min: 0.10, breakoutAtrFloor: PENGU_V8_V64_BASE.breakoutAtrFloor },
  { name: "L4_SUPP_GE0_BREAKOUT_0P75", supplementalRegime72Min: 0.0, breakoutAtrFloor: 0.75 },
  { name: "L5_SUPP_GE0_BREAKOUT_1P00", supplementalRegime72Min: 0.0, breakoutAtrFloor: 1.0 },
  { name: "L6_BASE_ONLY", supplementalRegime72Min: 0.15, breakoutAtrFloor: Number.POSITIVE_INFINITY },
];

function envDate(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) throw new Error(`${name}_INVALID:${value}`);
  return ts;
}

const EVAL_START = envDate("PENGU_STUDY_EVAL_START");
const EVAL_END = envDate("PENGU_STUDY_EVAL_END");
const DATA_DIR = process.env.PENGU_LOCAL_DATA_DIR || ".research-state/pengu-study-data";
const OUT = process.env.PENGU_STUDY_OUT || ".research-state/pengu-entry-logic-repair-study.json";
const DATA_LABEL = process.env.PENGU_STUDY_DATA_LABEL || "UNKNOWN";

function fundingBetween(points: Funding[], entryTs: number, exitTs: number) {
  return points.filter((p) => p.fundingTime > entryTs && p.fundingTime <= exitTs).reduce((s, p) => s + p.fundingRate, 0);
}

function baseLongRaw(f: PenguDualLsV2Features) {
  const r = PENGU_DUAL_LS_V2.long;
  return f.penguReturn72h >= r.regimeReturn72hMinimum
    && f.close > f.priorHigh18h
    && f.penguReturn24h >= r.penguReturn24hMinimum
    && f.relativeReturn24h >= r.relativeReturn24hMinimum
    && f.btcReturn24h >= r.btcReturn24hMinimum
    && f.rsi14 >= r.rsiMinimum
    && f.rsi14 <= r.rsiMaximum
    && f.volumeRatio6OverPrior36 >= r.volumeRatioMinimum
    && f.volumeRatio6OverPrior36 <= r.volumeRatioMaximum
    && f.atr24Ratio <= r.atr24RatioMaximum
    && f.close > f.ema168;
}

function allLongExceptRegime(f: PenguDualLsV2Features) {
  const r = PENGU_DUAL_LS_V2.long;
  return f.close > f.priorHigh18h
    && f.penguReturn24h >= r.penguReturn24hMinimum
    && f.relativeReturn24h >= r.relativeReturn24hMinimum
    && f.btcReturn24h >= r.btcReturn24hMinimum
    && f.rsi14 >= r.rsiMinimum
    && f.rsi14 <= r.rsiMaximum
    && f.volumeRatio6OverPrior36 >= r.volumeRatioMinimum
    && f.volumeRatio6OverPrior36 <= r.volumeRatioMaximum
    && f.atr24Ratio <= r.atr24RatioMaximum
    && f.close > f.ema168;
}

function dynamicLongRaw(f: PenguDualLsV2Features, spec: LongSpec) {
  if (baseLongRaw(f)) return true;
  if (!allLongExceptRegime(f)) return false;
  if (f.penguReturn72h >= PENGU_DUAL_LS_V2.long.regimeReturn72hMinimum) return false;
  if (f.penguReturn72h < spec.supplementalRegime72Min) return false;
  return penguV8BreakoutAtrScore(f) >= spec.breakoutAtrFloor;
}

function buildLongSignals(rows: PenguDualLsV2EvaluationRow[], spec: LongSpec) {
  const signals = new Array<boolean>(rows.length).fill(false);
  const kinds = new Array<LongKind | undefined>(rows.length).fill(undefined);
  for (let i = 1; i < rows.length; i += 1) {
    const f = rows[i].features;
    if (!f) continue;
    const current = dynamicLongRaw(f, spec);
    const prevF = rows[i - 1].features;
    const previous = prevF ? dynamicLongRaw(prevF, spec) : false;
    if (current && !previous) {
      signals[i] = true;
      kinds[i] = baseLongRaw(f) ? "BASE_LONG" : "V64_SUPPLEMENTAL";
    }
  }
  return { signals, kinds };
}

function buildShortSignals(rows: PenguDualLsV2EvaluationRow[], spec: ShortSpec) {
  const rule = PENGU_DUAL_LS_V2.short;
  const signals = new Array<boolean>(rows.length).fill(false);
  let active = false;
  let armed = false;
  let localLow = 0;
  let armedLow = 0;
  let expiry = -1;
  let impulseIndex = -1;
  let armedIndex = -1;

  for (let index = 180; index < rows.length; index += 1) {
    const f = rows[index].features;
    if (!f) continue;
    if (active && index > expiry) {
      active = false; armed = false; localLow = 0; armedLow = 0; impulseIndex = -1; armedIndex = -1;
    }
    if (f.penguReturn24h <= rule.impulseReturn24hMaximum) {
      if (!active) {
        active = true;
        armed = false;
        localLow = f.low;
        armedLow = 0;
        impulseIndex = index;
        armedIndex = -1;
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
      active = false; armed = false; localLow = 0; armedLow = 0; impulseIndex = -1; armedIndex = -1;
      continue;
    }

    if (!armed
      && index >= impulseIndex + spec.armAfterImpulseBars
      && bounce + 1e-12 >= rule.armBounceMinimum) {
      armed = true;
      armedLow = localLow;
      armedIndex = index;
    }

    if (!armed || index < armedIndex + spec.signalAfterArmBars) continue;

    const conditionActive = spec.rebreakCondition === "ALWAYS"
      || (spec.rebreakCondition === "COUNTERWIND" && (f.btcEma168Distance >= 0 || f.btcReturn24h >= 0))
      || (spec.rebreakCondition === "BTC_EMA_POS" && f.btcEma168Distance >= 0)
      || (spec.rebreakCondition === "BTC_EMA_POS_BTC24_NEG" && f.btcEma168Distance >= 0 && f.btcReturn24h < 0);
    const structuralRebreak = spec.rebreakTolerance === null
      || !conditionActive
      || f.close <= armedLow * (1 + spec.rebreakTolerance) + 1e-12;

    const eligible = structuralRebreak
      && f.penguReturn72h <= rule.regimeReturn72hMaximum
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
      active = false; armed = false; localLow = 0; armedLow = 0; impulseIndex = -1; armedIndex = -1;
    }
  }
  return signals;
}

function metrics(trades: Trade[]) {
  let equity = 1, peak = 1, maxDd = 0, grossProfit = 0, grossLoss = 0;
  for (const t of trades) {
    equity *= 1 + t.accountReturn;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity / peak - 1);
    if (t.accountReturn > 0) grossProfit += t.accountReturn;
    else grossLoss -= t.accountReturn;
  }
  return {
    trades: trades.length,
    returnPct: (equity - 1) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownPct: maxDd * 100,
    winRatePct: trades.length ? trades.filter((t) => t.accountReturn > 0).length / trades.length * 100 : null,
    hardStops: trades.filter((t) => t.exitReason.includes("HARD_STOP")).length,
    longTrades: trades.filter((t) => t.side === "LONG").length,
    shortTrades: trades.filter((t) => t.side === "SHORT").length,
  };
}

function summarize(trades: Trade[]) {
  return {
    total: metrics(trades),
    short: metrics(trades.filter((t) => t.entryVersion === "SHORT_V20")),
    long: metrics(trades.filter((t) => t.entryVersion === "LONG_V2_FINAL")),
    baseLong: metrics(trades.filter((t) => t.longKind === "BASE_LONG")),
    supplementalLong: metrics(trades.filter((t) => t.longKind === "V64_SUPPLEMENTAL")),
    recovery: metrics(trades.filter((t) => t.entryVersion === "RECOVERY_V8")),
  };
}

function isHard(reason: string) {
  return reason === "LONG_HARD_STOP" || reason === "SHORT_HARD_STOP" || reason === "RECOVERY_V8_HARD_STOP";
}

function replay(
  rows: PenguDualLsV2EvaluationRow[],
  funding: Funding[],
  mode: Mode,
  shortSpec: ShortSpec,
  longSpec: LongSpec,
) {
  const shortSignals = buildShortSignals(rows, shortSpec);
  const longSignals = buildLongSignals(rows, longSpec);
  const costPerSide = NORMAL_FEE_PER_SIDE + (mode === "stress" ? STRESS_EXTRA_PER_SIDE : 0);
  let risk: PenguRiskOverlayState = createPenguRiskOverlayState();
  let position: PenguDualLsV2Position | undefined;
  let route: PenguRiskRoute | undefined;
  let entryFeatures: PenguDualLsV2Features | undefined;
  let longKind: LongKind | undefined;
  let signalTs = 0;
  let partial: Trade["partialDefense"] | undefined;
  let cooldownUntilTs = 0;
  const trades: Trade[] = [];
  const blocked = { cooldown: 0, routeQuarantine: 0, ddHold: 0 };

  const closeTrade = (input: {
    row: PenguDualLsV2EvaluationRow;
    exitPrice: number;
    exitReason: string;
    positionBefore: PenguDualLsV2Position;
  }) => {
    assert(route && entryFeatures);
    const p = input.positionBefore;
    const exitTs = input.row.candle.openTime;
    const side = p.side > 0 ? "LONG" as const : "SHORT" as const;
    let rawUnitReturn = 0, fundingUnitReturn = 0, costUnitReturn = 0, accountReturn = 0;

    if (p.entryVersion === "RECOVERY_V8" && partial) {
      const remainingGross = PENGU_RECOVERY_V8.partial.remainingGross;
      const rawRemaining = input.exitPrice / p.entryPrice - 1;
      const fundRemaining = -fundingBetween(funding, p.entryTs, exitTs);
      const costRemaining = -2 * costPerSide;
      const remainingReturn = remainingGross * (rawRemaining + fundRemaining + costRemaining);
      accountReturn = partial.accountReturn + remainingReturn;
      rawUnitReturn = (partial.gross * (partial.exitPrice / p.entryPrice - 1) + remainingGross * rawRemaining) / PENGU_RECOVERY_V8.initialGross;
      fundingUnitReturn = (partial.gross * (-fundingBetween(funding, p.entryTs, partial.exitTs)) + remainingGross * fundRemaining) / PENGU_RECOVERY_V8.initialGross;
      costUnitReturn = -2 * costPerSide;
    } else {
      rawUnitReturn = side === "LONG" ? input.exitPrice / p.entryPrice - 1 : p.entryPrice / input.exitPrice - 1;
      const fr = fundingBetween(funding, p.entryTs, exitTs);
      fundingUnitReturn = side === "LONG" ? -fr : fr;
      costUnitReturn = -2 * costPerSide;
      accountReturn = p.gross * (rawUnitReturn + fundingUnitReturn + costUnitReturn);
    }

    const trade: Trade = {
      route,
      entryVersion: (p.entryVersion === "LEGACY_V2" ? "LONG_V2_FINAL" : p.entryVersion) as EntryVersion,
      longKind,
      side,
      signalTs,
      entryTs: p.entryTs,
      exitTs,
      entryPrice: p.entryPrice,
      exitPrice: input.exitPrice,
      requestedGross: p.gross,
      exitReason: input.exitReason,
      rawUnitReturn,
      fundingUnitReturn,
      costUnitReturn,
      accountReturn,
      counterwind: p.shortV20?.counterwind,
      partialDefense: partial,
      entryFeatures,
    };
    if (trade.entryTs >= EVAL_START && trade.entryTs < EVAL_END) trades.push(trade);

    risk = recordPenguClosedTrade(risk, route, accountReturn, exitTs);
    if (isHard(input.exitReason)) risk = recordPenguHardStop(risk, route, exitTs);
    cooldownUntilTs = input.row.candle.openTime + cooldownHoursForPenguExit(input.exitReason as any) * HOUR;
    position = undefined; route = undefined; entryFeatures = undefined; longKind = undefined; partial = undefined; signalTs = 0;
  };

  for (let i = 180; i < rows.length - 1; i += 1) {
    const row = rows[i];
    const f = row.features;
    if (!f) continue;
    const longSignal = longSignals.signals[i] === true;
    const shortSignal = shortSignals[i] === true;
    const recoveryRow: RecoveryV8FeatureRow | undefined = row.recoveryV8
      ? { ...row.recoveryV8, ordinaryLongEligible: longSignal, ordinaryShortEligible: shortSignal, baseLongSignal: longSignal }
      : undefined;

    if (position) {
      if (position.entryVersion === "RECOVERY_V8" && position.recoveryV8 && recoveryRow) {
        const before = position;
        const ev = evaluateRecoveryV8PositionBar(position.recoveryV8, recoveryRow);
        if (ev.events.includes("PARTIAL_DEFENSE") && !partial && ev.triggerPrice) {
          const gross = PENGU_RECOVERY_V8.partial.gross;
          const exitTs = row.candle.openTime;
          const raw = ev.triggerPrice / before.entryPrice - 1;
          const fund = -fundingBetween(funding, before.entryTs, exitTs);
          const cost = -2 * costPerSide;
          partial = { gross, exitTs, exitPrice: ev.triggerPrice, accountReturn: gross * (raw + fund + cost) };
        }
        position = { ...position, quantity: ev.updatedPosition.quantity, recoveryV8: { ...position.recoveryV8, ...ev.updatedPosition } };
        if (ev.kind === "HARD_STOP" || ev.kind === "TRAILING_STOP" || ev.kind === "MAX_HOLD" || ev.kind === "YIELD_BASE_LONG") {
          closeTrade({
            row,
            exitPrice: ev.stopPrice ?? row.candle.close,
            exitReason: ev.kind === "HARD_STOP" ? "RECOVERY_V8_HARD_STOP"
              : ev.kind === "TRAILING_STOP" ? "RECOVERY_V8_TRAILING_STOP"
              : ev.kind === "MAX_HOLD" ? "RECOVERY_V8_MAX_HOLD" : "RECOVERY_V8_YIELD_BASE_LONG",
            positionBefore: before,
          });
        }
        continue;
      }

      const before = position;
      const ev = evaluatePenguDualLsV2PositionBar(position, f);
      position = ev.updatedPosition;
      if (ev.exit) closeTrade({ row, exitPrice: ev.exit.stopPrice ?? row.candle.close, exitReason: ev.exit.reason, positionBefore: before });
      continue;
    }

    if (f.referenceTs < cooldownUntilTs) { blocked.cooldown += 1; continue; }

    let entryVersion: EntryVersion | undefined;
    let side: 1 | -1 | undefined;
    let targetGross = 0;
    let selectedLongKind: LongKind | undefined;

    if (shortSignal) {
      entryVersion = "SHORT_V20"; side = -1; targetGross = targetGrossForAtr(f.atr24Ratio);
    } else if (longSignal) {
      entryVersion = "LONG_V2_FINAL"; side = 1; targetGross = penguV8V64RequestedLongGross(f);
      selectedLongKind = longSignals.kinds[i];
    } else if (recoveryRow) {
      const rec = selectPenguRecoveryV8Entry(recoveryRow, true);
      if (rec?.kind === "RECOVERY_V8") {
        entryVersion = "RECOVERY_V8"; side = 1; targetGross = rec.gross;
      }
    }
    if (!entryVersion || !side || !(targetGross > 0)) continue;

    const candidateRoute = routeForPenguEntryVersion(entryVersion);
    const gate = evaluatePenguNewEntryGate(risk, candidateRoute, f.referenceTs);
    if (!gate.allowed) {
      if (gate.reason === "PENGU_ROUTE_QUARANTINED") blocked.routeQuarantine += 1;
      else if (gate.reason === "PENGU_REALIZED_DD_HOLD") blocked.ddHold += 1;
      continue;
    }

    const entry = rows[i + 1].candle;
    if (!(entry.openTime < EVAL_END)) continue;
    signalTs = f.referenceTs;
    entryFeatures = { ...f };
    route = candidateRoute;
    longKind = selectedLongKind;

    if (entryVersion === "RECOVERY_V8") {
      position = {
        side: 1, entryTs: entry.openTime, entryPrice: entry.open, quantity: 1, gross: targetGross,
        highWaterMark: entry.open, lowWaterMark: entry.open, entryVersion,
        recoveryV8: {
          version: "RECOVERY_V8", side: 1, entryTs: entry.openTime, entryPrice: entry.open,
          quantity: 1, originalQuantity: 1, originalGross: PENGU_RECOVERY_V8.initialGross,
          remainingGross: PENGU_RECOVERY_V8.initialGross, partialDefenseTriggered: false,
          highWaterMark: entry.open, logicalEntryPrice: entry.open, recoveryExecutionPrice: entry.open,
          protectionLifecycle: "FULL_HARD_STOP",
        },
      };
    } else {
      position = {
        side, entryTs: entry.openTime, entryPrice: entry.open, quantity: 1, gross: targetGross,
        highWaterMark: entry.open, lowWaterMark: entry.open, entryVersion,
        shortV20: entryVersion === "SHORT_V20" ? createPenguShortV20State({
          entryPrice: entry.open, requestedGross: targetGross, entryAtr24Ratio: f.atr24Ratio,
          btcEma168Distance: f.btcEma168Distance, btcReturn24h: f.btcReturn24h,
        }) : undefined,
      };
    }
  }

  return { trades, summary: summarize(trades), blocked };
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, name), "utf8")) as T;
}

async function main() {
  assert.equal(PENGU_DUAL_LS_V2.id, "PENGU_DUAL_LS_V2_FINAL");
  assert.equal(PENGU_DUAL_LS_V2.logicProfile, "COMBINED_FILTERED_Q60_DD17_H72");
  assert.equal(PENGU_RECOVERY_V8.rule, "R_BTC3");
  assert.equal(PENGU_RECOVERY_V8.priority, "SHORT_FIRST");

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
  assert.ok(pengu.length >= 250, `Insufficient common rows: ${pengu.length}`);

  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: funding };
  const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);

  const results: Record<string, any> = {};
  for (const s of SHORT_SPECS) {
    for (const l of LONG_SPECS) {
      const key = `${s.name}__${l.name}`;
      const normal = replay(rows, funding, "normal", s, l);
      const stress = replay(rows, funding, "stress", s, l);
      results[key] = { shortSpec: s, longSpec: l, normal: normal.summary, stress: stress.summary, blocked: normal.blocked };
    }
  }

  const payload = {
    schema: "pengu-targeted-entry-repair-study/v1",
    productionSourceSha: SOURCE_SHA,
    dataLabel: DATA_LABEL,
    period: { startInclusive: new Date(EVAL_START).toISOString(), endExclusive: new Date(EVAL_END).toISOString() },
    data: {
      availableStart: new Date(pengu[0].openTime).toISOString(),
      availableEndExclusive: new Date(pengu.at(-1)!.openTime + HOUR).toISOString(),
      commonH1Rows: pengu.length,
      fundingRows: funding.length,
    },
    design: {
      exitsUnchanged: true,
      recoveryV8Unchanged: true,
      riskOverlayUnchanged: true,
      shortCandidates: SHORT_SPECS,
      longCandidates: LONG_SPECS,
      rationale: {
        short: "Require a completed bounce and then structural re-break near the armed setup low, instead of accepting a tiny previous-H1-low break far above the original impulse low.",
        long: "Keep the original base Long intact; constrain only V64 supplemental Long so missing 72h regime cannot be replaced by a weak breakout.",
      },
    },
    baselineKey: "S0_CURRENT__L0_CURRENT",
    results,
    safety: { researchOnly: true, ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log("PENGU_TARGETED_REPAIR_STUDY=" + JSON.stringify({
    dataLabel: DATA_LABEL,
    period: payload.period,
    data: payload.data,
    baseline: results[payload.baselineKey],
    candidateCount: SHORT_SPECS.length * LONG_SPECS.length,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
