import { QUALITY102_CAUSAL_V4_S34_MODEL, type Quality102CausalV4Family } from "../config/disdexQuality102CausalV4Model";
import type { Quality102Candle, Quality102Side } from "./disdex-quality102-causal-pipeline";
import {
  QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN,
  evaluateQuality102CausalV4FeatureGate,
  evaluateQuality102CausalV4ImprovementGate,
  evaluateS34QualityGate,
} from "./disdex-quality102-causal-selector";
import {
  detectQuality102CausalV4S34RawSignal,
  type Quality102CausalV4EntryOpen,
} from "./disdex-quality102-causal-v4-s34";

export interface Quality102GateDiagnostic {
  name: string;
  pass: boolean;
  reason: string;
  value?: number | string | boolean;
  threshold?: number | string;
}

export interface Quality102S34ModelDiagnostic {
  key: string;
  symbol: string;
  family: Quality102CausalV4Family;
  layer: "S3" | "S4";
  variant: string;
  gridOpen: boolean;
  rawDetected: boolean;
  candidateSide?: Quality102Side;
  proximitySide?: Quality102Side;
  proximityScore: number;
  rankingScore: number;
  rankingStage: "GRID_WAIT" | "NO_RAW" | "RAW_REJECTED" | "QUALITY_PASS" | "FEATURE_PASS" | "IMPROVEMENT_PASS" | "SIGNAL_READY";
  reason: string;
  metrics: Record<string, number | string | boolean>;
  gates: Quality102GateDiagnostic[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sampleStdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ret14(rows: readonly Quality102Candle[], entryOpen: Quality102CausalV4EntryOpen): number | undefined {
  if (rows.length < 336) return undefined;
  const prior = rows[rows.length - 336];
  return prior?.open > 0 && entryOpen.open > 0 ? entryOpen.open / prior.open - 1 : undefined;
}

function pbMetrics(rows: readonly Quality102Candle[], variant: string) {
  const match = /^PB(72|168)_([0-9.]+)_P(12|24)_([0-9.]+)_H(12|24)$/.exec(variant);
  if (!match || !rows.length) return undefined;
  const lookback = Number(match[1]);
  const trendThreshold = Number(match[2]);
  const pullback = Number(match[3]);
  const pullThreshold = Number(match[4]);
  const t = rows.length - 1;
  if (t < Math.max(lookback, pullback)) return undefined;
  const longRet = rows[t].close / rows[t - lookback].close - 1;
  const pullRet = rows[t].close / rows[t - pullback].close - 1;
  const longProgress = Math.min(clamp01(longRet / trendThreshold), clamp01((-pullRet) / pullThreshold));
  const shortProgress = Math.min(clamp01((-longRet) / trendThreshold), clamp01(pullRet / pullThreshold));
  const side: Quality102Side = longProgress >= shortProgress ? 1 : -1;
  return {
    side,
    proximity: Math.max(longProgress, shortProgress),
    metrics: {
      longRet: round(longRet),
      pullRet: round(pullRet),
      trendThreshold,
      pullThreshold,
      longProgress: round(longProgress, 4),
      shortProgress: round(shortProgress, 4),
    },
  };
}

function mrMetrics(rows: readonly Quality102Candle[], variant: string) {
  const match = /^MR(24|48|72)_Z([0-9.]+)_H(12|24)$/.exec(variant);
  if (!match || !rows.length) return undefined;
  const lookback = Number(match[1]);
  const zThreshold = Number(match[2]);
  const t = rows.length - 1;
  if (t - lookback + 1 < 0) return undefined;
  const closes = rows.slice(t - lookback + 1, t + 1).map((row) => row.close);
  const stdev = sampleStdev(closes);
  if (!(stdev > 0)) return undefined;
  const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const z = (rows[t].close - mean) / stdev;
  return {
    side: (z >= 0 ? -1 : 1) as Quality102Side,
    proximity: clamp01(Math.abs(z) / zThreshold),
    metrics: { zScore: round(z, 4), zThreshold, mean: round(mean), stdev: round(stdev) },
  };
}

function revMetrics(rows: readonly Quality102Candle[], variant: string) {
  const match = /^REV(6|12|24)_T([0-9.]+)_H(8|12|24)$/.exec(variant);
  if (!match || !rows.length) return undefined;
  const lookback = Number(match[1]);
  const threshold = Number(match[2]);
  const t = rows.length - 1;
  if (t < lookback) return undefined;
  const move = rows[t].close / rows[t - lookback].close - 1;
  return {
    side: (move >= 0 ? -1 : 1) as Quality102Side,
    proximity: clamp01(Math.abs(move) / threshold),
    metrics: { move: round(move), threshold },
  };
}

function brkMetrics(rows: readonly Quality102Candle[], variant: string) {
  const match = /^BRK(24|48|72|168)_H(12|24|48)_V([0-9.]+)$/.exec(variant);
  if (!match || !rows.length) return undefined;
  const lookback = Number(match[1]);
  const volumeThreshold = Number(match[3]);
  const t = rows.length - 1;
  if (t < Math.max(lookback, 72)) return undefined;
  const current = rows[t];
  const prior = rows.slice(t - lookback, t);
  const priorHigh = Math.max(...prior.map((row) => row.high));
  const priorLow = Math.min(...prior.map((row) => row.low));
  const volumes = rows.slice(t - 72, t).map((row) => Number(row.baseVolume ?? 0));
  const medianVolume = median(volumes);
  const currentVolume = Number(current.baseVolume ?? 0);
  const volumeRatio = medianVolume > 0 ? currentVolume / medianVolume : 0;
  const longPriceProgress = clamp01(current.close / priorHigh);
  const shortPriceProgress = clamp01(priorLow / current.close);
  const volumeProgress = clamp01(volumeRatio / volumeThreshold);
  const longProgress = Math.min(longPriceProgress, volumeProgress);
  const shortProgress = Math.min(shortPriceProgress, volumeProgress);
  const side: Quality102Side = longProgress >= shortProgress ? 1 : -1;
  const breakoutDistance = side === 1 ? current.close / priorHigh - 1 : priorLow / current.close - 1;
  return {
    side,
    proximity: Math.max(longProgress, shortProgress),
    metrics: {
      close: round(current.close),
      priorHigh: round(priorHigh),
      priorLow: round(priorLow),
      breakoutDistance: round(breakoutDistance),
      volumeRatio: round(volumeRatio, 4),
      volumeThreshold,
      volumeProgress: round(volumeProgress, 4),
      longPriceProgress: round(longPriceProgress, 4),
      shortPriceProgress: round(shortPriceProgress, 4),
    },
  };
}

function proximityFor(rows: readonly Quality102Candle[], variant: string) {
  if (variant.startsWith("PB")) return pbMetrics(rows, variant);
  if (variant.startsWith("MR")) return mrMetrics(rows, variant);
  if (variant.startsWith("REV")) return revMetrics(rows, variant);
  if (variant.startsWith("BRK")) return brkMetrics(rows, variant);
  return undefined;
}

function rankingScore(input: {
  gridOpen: boolean;
  proximity: number;
  raw: boolean;
  historical: boolean;
  feature: boolean;
  improvement: boolean;
}): { score: number; stage: Quality102S34ModelDiagnostic["rankingStage"] } {
  const proximityPct = Math.max(0, Math.min(100, input.proximity * 100));
  let score = 0.60 * proximityPct;
  let stage: Quality102S34ModelDiagnostic["rankingStage"] = "NO_RAW";
  if (input.raw) {
    score = 60 + 0.10 * proximityPct;
    stage = "RAW_REJECTED";
  }
  if (input.raw && input.historical) {
    score = 70 + 0.10 * proximityPct;
    stage = "QUALITY_PASS";
  }
  if (input.raw && input.historical && input.feature) {
    score = 80 + 0.10 * proximityPct;
    stage = "FEATURE_PASS";
  }
  if (input.raw && input.historical && input.feature && input.improvement) {
    score = 90 + 0.10 * proximityPct;
    stage = "IMPROVEMENT_PASS";
  }
  if (input.gridOpen && input.raw && input.historical && input.feature && input.improvement) {
    score = 100;
    stage = "SIGNAL_READY";
  } else if (!input.gridOpen && score >= 90) {
    score = 89;
    stage = "GRID_WAIT";
  }
  return { score: Math.round(score * 100) / 100, stage };
}

/**
 * Computes observability-only S34 gate diagnostics from the same completed bars.
 * It is not used by the trading selector and cannot arm or place orders.
 */
export function diagnoseQuality102CausalV4S34Symbol(input: {
  symbol: string;
  rows: readonly Quality102Candle[];
  entryOpen: Quality102CausalV4EntryOpen;
}): Quality102S34ModelDiagnostic[] {
  const symbol = input.symbol.trim().toUpperCase();
  const gridOpen = new Date(input.entryOpen.timestampMs).getUTCHours() % 4 === 1;
  const models = QUALITY102_CAUSAL_V4_S34_MODEL.filter((row) => row.symbol === symbol);
  const observedRet14 = ret14(input.rows, input.entryOpen);

  return models.map((model) => {
    const proximity = proximityFor(input.rows, model.variant);
    let raw;
    let rawError: string | undefined;
    try {
      raw = detectQuality102CausalV4S34RawSignal(input.rows, input.entryOpen, model.variant);
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error);
    }

    const historical = raw ? evaluateS34QualityGate({
      family: model.family,
      variant: model.variant,
      side: raw.side,
      strength: raw.strength,
      ret14: raw.ret14,
    }) : undefined;
    const feature = raw && historical?.accepted ? evaluateQuality102CausalV4FeatureGate({
      family: model.family,
      symbol: model.symbol.replace(/USDT$/, ""),
      variant: model.variant,
      side: raw.side,
      ret14: raw.ret14,
      margin: raw.margin,
      developmentN: model.developmentN,
      developmentSpf: model.developmentSpf,
      developmentAvg: model.developmentAvg,
    }) : undefined;
    const improvement = raw && historical?.accepted && feature?.accepted
      ? evaluateQuality102CausalV4ImprovementGate({
          family: model.family,
          side: raw.side,
          ret14: raw.ret14,
        })
      : undefined;

    const scored = rankingScore({
      gridOpen,
      proximity: proximity?.proximity ?? 0,
      raw: Boolean(raw),
      historical: historical?.accepted === true,
      feature: feature?.accepted === true,
      improvement: improvement?.accepted === true,
    });

    const gates: Quality102GateDiagnostic[] = [
      {
        name: "S34_4H_GRID",
        pass: gridOpen,
        reason: gridOpen ? "UTC_HOUR_MOD4_EQ1" : "UTC_HOUR_MOD4_NOT1",
        value: new Date(input.entryOpen.timestampMs).getUTCHours(),
        threshold: "hour % 4 == 1",
      },
      {
        name: "RAW_DETECTOR",
        pass: Boolean(raw),
        reason: raw ? "RAW_SIGNAL_DETECTED" : rawError || "RAW_THRESHOLD_NOT_REACHED",
      },
    ];
    if (historical) gates.push({ name: "HISTORICAL_QUALITY", pass: historical.accepted, reason: historical.reason });
    if (feature) gates.push({ name: "V4_FEATURE", pass: feature.accepted, reason: feature.reason });
    if (improvement) {
      gates.push({
        name: "V4_IMPROVEMENT",
        pass: improvement.accepted,
        reason: improvement.reason,
        ...(model.family === "REV" && raw?.side === 1
          ? { value: round(raw.ret14), threshold: QUALITY102_CAUSAL_V4_REV_LONG_RET14_MIN }
          : {}),
      });
    }

    const reason = scored.stage === "SIGNAL_READY"
      ? "S34_SIGNAL_READY"
      : scored.stage === "GRID_WAIT"
        ? "S34_GRID_WAIT"
        : rawError
          ? rawError
          : improvement && !improvement.accepted
            ? improvement.reason
            : feature && !feature.accepted
              ? feature.reason
              : historical && !historical.accepted
                ? historical.reason
                : "RAW_THRESHOLD_NOT_REACHED";

    return {
      key: model.key,
      symbol,
      family: model.family,
      layer: model.layer,
      variant: model.variant,
      gridOpen,
      rawDetected: Boolean(raw),
      ...(raw ? { candidateSide: raw.side } : proximity ? { candidateSide: proximity.side } : {}),
      ...(proximity ? { proximitySide: proximity.side } : {}),
      proximityScore: Math.round((proximity?.proximity ?? 0) * 10000) / 100,
      rankingScore: scored.score,
      rankingStage: scored.stage,
      reason,
      metrics: {
        ...(proximity?.metrics ?? {}),
        ...(observedRet14 !== undefined ? { ret14: round(observedRet14) } : {}),
        ...(raw ? {
          strength: round(raw.strength),
          margin: round(raw.margin),
          hardStop: round(raw.hardStop),
          holdHours: raw.holdHours,
        } : {}),
        developmentN: model.developmentN,
        developmentSpf: round(model.developmentSpf),
        developmentAvg: round(model.developmentAvg),
      },
      gates,
    };
  }).sort((left, right) => right.rankingScore - left.rankingScore || left.key.localeCompare(right.key));
}
