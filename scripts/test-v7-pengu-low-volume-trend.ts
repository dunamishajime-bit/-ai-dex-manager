import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-low-volume-trend");
const START_TS = process.env.BT_START ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`) : Date.UTC(2024, 11, 17);
const END_TS = process.env.BT_END ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`) : Date.UTC(2026, 4, 22, 23, 59, 59, 999);
const EXECUTION_START_TS = process.env.BT_EXEC_START ? Date.parse(`${process.env.BT_EXEC_START}T00:00:00.000Z`) : START_TS;
const PATTERN = process.env.PATTERN ? new Set(process.env.PATTERN.split(",").map((value) => value.trim()).filter(Boolean)) : null;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function currentBase(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  return {
    ...(buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    backtestExecutionStartTs: EXECUTION_START_TS,
    ...extra,
  };
}

function looseMain(params: {
  volume: number;
  accel: number;
  breakout: number;
  efficiency: number;
  lookback?: number;
  disableBreakout?: boolean;
  minSmaDistance?: number;
  minMom20?: number;
  allowGateOff?: boolean;
}): Partial<HybridVariantOptions> {
  return {
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "15m",
    idleBreakoutSymbols: ["PENGU"],
    idleBreakoutMinVolumeRatio: params.volume,
    idleBreakoutMinMomAccel: params.accel,
    idleBreakoutBreakoutLookbackBars: params.disableBreakout ? null : params.lookback ?? 16,
    idleBreakoutBreakoutMinPct: params.breakout,
    idleBreakoutMinEfficiencyRatio: params.efficiency,
    idleBreakoutAllowTradeGateOff: params.allowGateOff,
    idleCashTrendMinMom20: params.minMom20,
    trendMinSmaDistancePct: params.minSmaDistance,
  };
}

function lowVolumeSidecar(params: {
  volume: number;
  accel: number;
  breakout: number;
  efficiency: number;
  maxNotionalUsd: number;
  lookback?: number;
  minRange?: number;
  maxRange?: number;
  minPath?: number;
  disableBreakout?: boolean;
  minSmaDistance?: number;
  minMom20?: number;
  allowGateOff?: boolean;
}): Partial<HybridVariantOptions> {
  return {
    idleNightBreakoutEntryWhileCash: true,
    idleNightBreakoutEntryTimeframe: "15m",
    idleNightBreakoutSymbols: ["PENGU"],
    idleNightBreakoutJstStartHour: 0,
    idleNightBreakoutJstEndHour: 0,
    idleNightBreakoutAllowTradeGateOff: params.allowGateOff ?? false,
    idleNightBreakoutMinVolumeRatio: params.volume,
    idleNightBreakoutMinMomAccel: params.accel,
    idleNightBreakoutBreakoutLookbackBars: params.disableBreakout ? null : params.lookback ?? 16,
    idleNightBreakoutBreakoutMinPct: params.breakout,
    idleNightBreakoutMinEfficiencyRatio: params.efficiency,
    idleNightBreakoutMaxNotionalUsd: params.maxNotionalUsd,
    idleNightBreakoutMinRecentRangePct: params.minRange,
    idleNightBreakoutMaxRecentRangePct: params.maxRange,
    idleNightBreakoutMinRecentPathPct: params.minPath,
    idleCashTrendMinMom20: params.minMom20,
    trendMinSmaDistancePct: params.minSmaDistance,
  };
}

function penguRiskOffGuard(params: {
  maxCloseBelowSma: number;
  minMom20: number;
  minAccel: number;
}): Partial<HybridVariantOptions> {
  return {
    idleBreakoutRiskOffGuardSymbols: ["PENGU"],
    idleBreakoutRiskOffGuardMaxCloseBelowSmaPct: params.maxCloseBelowSma,
    idleBreakoutRiskOffGuardMinMom20: params.minMom20,
    idleBreakoutRiskOffGuardMinMomAccel: params.minAccel,
    idleBreakoutSmaBreakGuardSymbols: ["PENGU"],
    idleBreakoutSmaBreakGuardMaxCloseBelowSmaPct: params.maxCloseBelowSma,
    idleBreakoutSmaBreakGuardMinMom20: params.minMom20,
    idleBreakoutSmaBreakGuardMinMomAccel: params.minAccel,
  };
}

function penguDowProxy(): Partial<HybridVariantOptions> {
  return {
    trendAllowDowBreakoutProxySymbols: ["PENGU"],
  };
}

function summarize(key: string, result: Awaited<ReturnType<typeof runHybridBacktest>>, elapsedMs: number, baseline = 0) {
  const penguTrades = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
  const idleTrades = penguTrades.filter((trade) => trade.sub_variant === "idle-breakout");
  const sidecarTrades = penguTrades.filter((trade) => trade.sub_variant === "idle-breakout-night");
  return {
    key,
    endEquity: round(result.summary.end_equity),
    delta: baseline ? round(result.summary.end_equity - baseline) : 0,
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: round(Number(result.summary.symbol_contribution.PENGU || 0)),
    penguTrades: penguTrades.length,
    idlePnl: round(idleTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    idleTrades: idleTrades.length,
    sidecarPnl: round(sidecarTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    sidecarTrades: sidecarTrades.length,
    sidecarWins: sidecarTrades.filter((trade) => trade.net_pnl > 0).length,
    sidecarLosses: sidecarTrades.filter((trade) => trade.net_pnl <= 0).length,
    elapsedSec: round(elapsedMs / 1000, 1),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const variants: Array<{ key: string; options: HybridVariantOptions }> = [
    { key: "current_v7", options: currentBase({ label: "current_v7" }) },
    { key: "main_vol020_accelNeg005_bo0_er08", options: currentBase({ label: "main_vol020_accelNeg005_bo0_er08", ...looseMain({ volume: 0.2, accel: -0.005, breakout: 0, efficiency: 0.08 }) }) },
    { key: "main_vol020_accelNeg005_bom150_er08", options: currentBase({ label: "main_vol020_accelNeg005_bom150_er08", ...looseMain({ volume: 0.2, accel: -0.005, breakout: -0.015, efficiency: 0.08 }) }) },
    { key: "main_vol020_accelNeg005_bom250_er08", options: currentBase({ label: "main_vol020_accelNeg005_bom250_er08", ...looseMain({ volume: 0.2, accel: -0.005, breakout: -0.025, efficiency: 0.08 }) }) },
    { key: "main_drift_vol020_accelNeg005_er08", options: currentBase({ label: "main_drift_vol020_accelNeg005_er08", ...looseMain({ volume: 0.2, accel: -0.005, breakout: 0, efficiency: 0.08, disableBreakout: true }) }) },
    { key: "main_drift_vol010_accelNeg010_er08", options: currentBase({ label: "main_drift_vol010_accelNeg010_er08", ...looseMain({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, disableBreakout: true }) }) },
    { key: "main_drift_sma03_vol010_accelNeg010_er08", options: currentBase({ label: "main_drift_sma03_vol010_accelNeg010_er08", ...looseMain({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, disableBreakout: true, minSmaDistance: -0.003 }) }) },
    { key: "main_drift_sma05_vol010_accelNeg010_er08", options: currentBase({ label: "main_drift_sma05_vol010_accelNeg010_er08", ...looseMain({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, disableBreakout: true, minSmaDistance: -0.005 }) }) },
    { key: "main_drift_momNeg005_sma05_vol010_accelNeg010_er08", options: currentBase({ label: "main_drift_momNeg005_sma05_vol010_accelNeg010_er08", ...looseMain({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, disableBreakout: true, minSmaDistance: -0.005, minMom20: -0.005 }) }) },
    { key: "main_drift_gateoff_momNeg005_sma05_vol010_accelNeg010_er08", options: currentBase({ label: "main_drift_gateoff_momNeg005_sma05_vol010_accelNeg010_er08", ...looseMain({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, disableBreakout: true, minSmaDistance: -0.005, minMom20: -0.005, allowGateOff: true }) }) },
    { key: "main_drift_gateoff_momNeg010_sma08_vol010_accelNeg015_er12", options: currentBase({ label: "main_drift_gateoff_momNeg010_sma08_vol010_accelNeg015_er12", ...looseMain({ volume: 0.1, accel: -0.015, breakout: 0, efficiency: 0.12, disableBreakout: true, minSmaDistance: -0.008, minMom20: -0.01, allowGateOff: true }) }) },
    { key: "main_breakout_gateoff_sma05_momNeg005", options: currentBase({ label: "main_breakout_gateoff_sma05_momNeg005", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.005, minMom20: -0.005, allowGateOff: true }) }) },
    { key: "main_breakout_gateoff_sma03_mom0", options: currentBase({ label: "main_breakout_gateoff_sma03_mom0", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.003, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout_gateoff_sma00_mom0", options: currentBase({ label: "main_breakout_gateoff_sma00_mom0", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout_gateoff_sma02_mom0", options: currentBase({ label: "main_breakout_gateoff_sma02_mom0", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.002, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout_gateoff_sma03_vol100_mom0", options: currentBase({ label: "main_breakout_gateoff_sma03_vol100_mom0", ...looseMain({ volume: 1.0, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.003, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout_gateoff_sma03_accelNeg001_mom0", options: currentBase({ label: "main_breakout_gateoff_sma03_accelNeg001_mom0", ...looseMain({ volume: 1.15, accel: -0.001, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.003, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout03_gateoff_base", options: currentBase({ label: "main_breakout03_gateoff_base", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.003, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout03_gateoff_er12", options: currentBase({ label: "main_breakout03_gateoff_er12", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.003, efficiency: 0.12, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout02_gateoff_base", options: currentBase({ label: "main_breakout02_gateoff_base", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.002, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout03_lb24_gateoff", options: currentBase({ label: "main_breakout03_lb24_gateoff", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.003, efficiency: 0.18, lookback: 24, minSmaDistance: 0, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_breakout02_lb24_gateoff", options: currentBase({ label: "main_breakout02_lb24_gateoff", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.002, efficiency: 0.18, lookback: 24, minSmaDistance: 0, minMom20: 0, allowGateOff: true }) }) },
    { key: "main_gateoff_trail5_25", options: currentBase({ label: "main_gateoff_trail5_25", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }), idleBreakoutProfitTrailActivationPct: 0.05, idleBreakoutProfitTrailRetracePct: 0.025 }) },
    { key: "main_gateoff_trail4_2", options: currentBase({ label: "main_gateoff_trail4_2", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }), idleBreakoutProfitTrailActivationPct: 0.04, idleBreakoutProfitTrailRetracePct: 0.02 }) },
    { key: "main_gateoff_trail3_15", options: currentBase({ label: "main_gateoff_trail3_15", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }), idleBreakoutProfitTrailActivationPct: 0.03, idleBreakoutProfitTrailRetracePct: 0.015 }) },
    { key: "main_gateoff_trail8_4", options: currentBase({ label: "main_gateoff_trail8_4", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }), idleBreakoutProfitTrailActivationPct: 0.08, idleBreakoutProfitTrailRetracePct: 0.04 }) },
    { key: "main_gateoff_weakexit_off", options: currentBase({ label: "main_gateoff_weakexit_off", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }), idleBreakoutWeakExitMom20Below: null, idleBreakoutWeakExitMomAccelBelow: null }) },
    { key: "main_gateoff_weakexit_loss_only", options: currentBase({ label: "main_gateoff_weakexit_loss_only", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }), idleBreakoutWeakExitOnlyWhenLoss: true }) },
    { key: "main_gateoff_weakexit_hold8", options: currentBase({ label: "main_gateoff_weakexit_hold8", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: 0, minMom20: 0, allowGateOff: true }), idleBreakoutWeakExitMinHoldBars: 8 }) },
    { key: "main_breakout_gateoff_guard1_mom0", options: currentBase({ label: "main_breakout_gateoff_guard1_mom0", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.003, minMom20: 0, allowGateOff: true }), ...penguRiskOffGuard({ maxCloseBelowSma: 0.01, minMom20: 0, minAccel: -0.01 }) }) },
    { key: "main_breakout_gateoff_guard2_momNeg1", options: currentBase({ label: "main_breakout_gateoff_guard2_momNeg1", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.003, minMom20: 0, allowGateOff: true }), ...penguRiskOffGuard({ maxCloseBelowSma: 0.02, minMom20: -0.01, minAccel: -0.02 }) }) },
    { key: "main_breakout_gateoff_guard3_momNeg2", options: currentBase({ label: "main_breakout_gateoff_guard3_momNeg2", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.003, minMom20: 0, allowGateOff: true }), ...penguRiskOffGuard({ maxCloseBelowSma: 0.03, minMom20: -0.02, minAccel: -0.03 }) }) },
    { key: "main_breakout_gateoff_guard1_trail4_2", options: currentBase({ label: "main_breakout_gateoff_guard1_trail4_2", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, minSmaDistance: -0.003, minMom20: 0, allowGateOff: true }), ...penguRiskOffGuard({ maxCloseBelowSma: 0.01, minMom20: 0, minAccel: -0.01 }), idleBreakoutProfitTrailActivationPct: 0.04, idleBreakoutProfitTrailRetracePct: 0.02 }) },
    { key: "main_drift_guard03_momNeg005", options: currentBase({ label: "main_drift_guard03_momNeg005", ...looseMain({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, disableBreakout: true, minSmaDistance: -0.005, minMom20: -0.005, allowGateOff: true }), ...penguRiskOffGuard({ maxCloseBelowSma: 0.003, minMom20: -0.005, minAccel: -0.01 }) }) },
    { key: "main_drift_guard05_momNeg010", options: currentBase({ label: "main_drift_guard05_momNeg010", ...looseMain({ volume: 0.1, accel: -0.015, breakout: 0, efficiency: 0.12, disableBreakout: true, minSmaDistance: -0.008, minMom20: -0.01, allowGateOff: true }), ...penguRiskOffGuard({ maxCloseBelowSma: 0.005, minMom20: -0.01, minAccel: -0.015 }) }) },
    { key: "current_v7_guard03_momNeg005", options: currentBase({ label: "current_v7_guard03_momNeg005", ...penguRiskOffGuard({ maxCloseBelowSma: 0.003, minMom20: -0.005, minAccel: -0.01 }) }) },
    { key: "main_drift_quality_mom2_vol50_er30", options: currentBase({ label: "main_drift_quality_mom2_vol50_er30", ...looseMain({ volume: 0.5, accel: -0.003, breakout: 0, efficiency: 0.3, disableBreakout: true, minSmaDistance: 0, minMom20: 0.02, allowGateOff: true }) }) },
    { key: "main_drift_quality_mom3_vol75_er35", options: currentBase({ label: "main_drift_quality_mom3_vol75_er35", ...looseMain({ volume: 0.75, accel: 0, breakout: 0, efficiency: 0.35, disableBreakout: true, minSmaDistance: 0, minMom20: 0.03, allowGateOff: true }) }) },
    { key: "main_drift_quality_mom5_vol100_er40", options: currentBase({ label: "main_drift_quality_mom5_vol100_er40", ...looseMain({ volume: 1.0, accel: 0, breakout: 0, efficiency: 0.4, disableBreakout: true, minSmaDistance: 0, minMom20: 0.05, allowGateOff: true }) }) },
    { key: "main_dow_proxy_current", options: currentBase({ label: "main_dow_proxy_current", ...penguDowProxy() }) },
    { key: "main_dow_proxy_gateoff", options: currentBase({ label: "main_dow_proxy_gateoff", ...looseMain({ volume: 1.15, accel: 0, breakout: 0.006, efficiency: 0.18, lookback: 16, allowGateOff: true }), ...penguDowProxy() }) },
    { key: "main_dow_proxy_loose_vol75_er12", options: currentBase({ label: "main_dow_proxy_loose_vol75_er12", ...looseMain({ volume: 0.75, accel: -0.001, breakout: 0.006, efficiency: 0.12, lookback: 16, allowGateOff: true }), ...penguDowProxy() }) },
    { key: "main_vol030_accelNeg003_bo0_er12", options: currentBase({ label: "main_vol030_accelNeg003_bo0_er12", ...looseMain({ volume: 0.3, accel: -0.003, breakout: 0, efficiency: 0.12 }) }) },
    { key: "main_vol030_accelNeg003_bom150_er12", options: currentBase({ label: "main_vol030_accelNeg003_bom150_er12", ...looseMain({ volume: 0.3, accel: -0.003, breakout: -0.015, efficiency: 0.12 }) }) },
    { key: "main_vol050_accel0_bo0_er12", options: currentBase({ label: "main_vol050_accel0_bo0_er12", ...looseMain({ volume: 0.5, accel: 0, breakout: 0, efficiency: 0.12 }) }) },
    { key: "main_vol075_accel0_bo3_er12", options: currentBase({ label: "main_vol075_accel0_bo3_er12", ...looseMain({ volume: 0.75, accel: 0, breakout: 0.003, efficiency: 0.12 }) }) },
    { key: "sidecar_cap300_vol020_accelNeg005_bo0_er08", options: currentBase({ label: "sidecar_cap300_vol020_accelNeg005_bo0_er08", ...lowVolumeSidecar({ volume: 0.2, accel: -0.005, breakout: 0, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025 }) }) },
    { key: "sidecar_cap300_vol020_accelNeg005_bom150_er08", options: currentBase({ label: "sidecar_cap300_vol020_accelNeg005_bom150_er08", ...lowVolumeSidecar({ volume: 0.2, accel: -0.005, breakout: -0.015, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025 }) }) },
    { key: "sidecar_cap300_vol020_accelNeg005_bom250_er08", options: currentBase({ label: "sidecar_cap300_vol020_accelNeg005_bom250_er08", ...lowVolumeSidecar({ volume: 0.2, accel: -0.005, breakout: -0.025, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025 }) }) },
    { key: "sidecar_cap300_drift_vol020_accelNeg005_er08", options: currentBase({ label: "sidecar_cap300_drift_vol020_accelNeg005_er08", ...lowVolumeSidecar({ volume: 0.2, accel: -0.005, breakout: 0, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025, disableBreakout: true }) }) },
    { key: "sidecar_cap300_drift_vol010_accelNeg010_er08", options: currentBase({ label: "sidecar_cap300_drift_vol010_accelNeg010_er08", ...lowVolumeSidecar({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025, disableBreakout: true }) }) },
    { key: "sidecar_cap300_drift_sma03_vol010_accelNeg010_er08", options: currentBase({ label: "sidecar_cap300_drift_sma03_vol010_accelNeg010_er08", ...lowVolumeSidecar({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025, disableBreakout: true, minSmaDistance: -0.003 }) }) },
    { key: "sidecar_cap300_drift_sma05_vol010_accelNeg010_er08", options: currentBase({ label: "sidecar_cap300_drift_sma05_vol010_accelNeg010_er08", ...lowVolumeSidecar({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025, disableBreakout: true, minSmaDistance: -0.005 }) }) },
    { key: "sidecar_cap300_drift_gateoff_momNeg005_sma05_vol010_accelNeg010_er08", options: currentBase({ label: "sidecar_cap300_drift_gateoff_momNeg005_sma05_vol010_accelNeg010_er08", ...lowVolumeSidecar({ volume: 0.1, accel: -0.01, breakout: 0, efficiency: 0.08, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025, disableBreakout: true, minSmaDistance: -0.005, minMom20: -0.005, allowGateOff: true }) }) },
    { key: "sidecar_cap300_drift_gateoff_momNeg010_sma08_vol010_accelNeg015_er12", options: currentBase({ label: "sidecar_cap300_drift_gateoff_momNeg010_sma08_vol010_accelNeg015_er12", ...lowVolumeSidecar({ volume: 0.1, accel: -0.015, breakout: 0, efficiency: 0.12, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.12, minPath: 0.025, disableBreakout: true, minSmaDistance: -0.008, minMom20: -0.01, allowGateOff: true }) }) },
    { key: "sidecar_cap500_vol020_accelNeg005_bo0_er08", options: currentBase({ label: "sidecar_cap500_vol020_accelNeg005_bo0_er08", ...lowVolumeSidecar({ volume: 0.2, accel: -0.005, breakout: 0, efficiency: 0.08, maxNotionalUsd: 500, minRange: 0.015, maxRange: 0.12, minPath: 0.025 }) }) },
    { key: "sidecar_cap300_vol030_accelNeg003_bo0_er12", options: currentBase({ label: "sidecar_cap300_vol030_accelNeg003_bo0_er12", ...lowVolumeSidecar({ volume: 0.3, accel: -0.003, breakout: 0, efficiency: 0.12, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.1, minPath: 0.025 }) }) },
    { key: "sidecar_cap300_vol050_accel0_bo0_er12", options: currentBase({ label: "sidecar_cap300_vol050_accel0_bo0_er12", ...lowVolumeSidecar({ volume: 0.5, accel: 0, breakout: 0, efficiency: 0.12, maxNotionalUsd: 300, minRange: 0.015, maxRange: 0.1, minPath: 0.025 }) }) },
  ].filter((variant) => !PATTERN || PATTERN.has(variant.key));

  const rows = [];
  const tradeRows = [];
  let baselineEquity = 0;
  for (const variant of variants) {
    const started = Date.now();
    console.log(`running ${variant.key}`);
    const result = await runHybridBacktest("RETQ22", variant.options);
    if (variant.key === "current_v7") baselineEquity = result.summary.end_equity;
    const row = summarize(variant.key, result, Date.now() - started, baselineEquity);
    rows.push(row);
    tradeRows.push(...result.trade_pairs.map((trade) => ({ variant: variant.key, ...trade })));
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.json"), JSON.stringify(rows, null, 2), "utf8");
    console.log(`${row.key} end=${row.endEquity.toLocaleString()} delta=${row.delta.toLocaleString()} dd=${row.maxDrawdownPct}% pengu=${row.penguPnl.toLocaleString()} sidecar=${row.sidecarTrades}/${row.sidecarPnl.toLocaleString()} elapsed=${row.elapsedSec}s`);
  }

  const sorted = [...rows].sort((left, right) => right.endEquity - left.endEquity);
  const md = [
    "# V7 PENGU Low Volume Trend Test",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue profile",
    "- purpose: test PENGU 15m entries that catch low-volume trend continuation while USDT/cash",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    `- execution start: ${new Date(EXECUTION_START_TS).toISOString()}`,
    "",
    "| rank | variant | End Equity | delta | MaxDD | PF | trades | exposure | PENGU PnL | PENGU trades | main idle PnL/trades | sidecar PnL/trades | sidecar W/L | elapsed |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...sorted.map((row, index) => `| ${index + 1} | ${row.key} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.penguTrades} | ${row.idlePnl.toLocaleString()}/${row.idleTrades} | ${row.sidecarPnl.toLocaleString()}/${row.sidecarTrades} | ${row.sidecarWins}/${row.sidecarLosses} | ${row.elapsedSec}s |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(sorted, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
