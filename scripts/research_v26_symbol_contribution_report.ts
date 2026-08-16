import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import type { PerpExecutionAssumptions, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 120 * 24 * HOUR;
const STARTING_EQUITY = 10_000;
const UNIVERSE = ["BTC","ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","PENGU","XRP","ADA","LTC","ATOM","AAVE","NEAR"];

const NORMAL: PerpExecutionAssumptions = {
  feeBpsPerSide: 5,
  slippageBpsPerSide: 0,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};

const FROZEN: PerpStrategyGenome = {
  id: "bp11-0015",
  generation: 11,
  parentIds: ["bp10-0012", "bp10-0007"],
  createdBy: "quant-regime",
  family: "relative_strength",
  thesis: "ボラティリティ調整後の相対強弱で最も優位な銘柄を選ぶ。Profile=balanced、担当=quant-regime",
  symbols: [...UNIVERSE],
  parameters: {
    timeframeHours: 2,
    leverage: 1,
    riskPerTradePct: 3.19,
    maxMarginUsagePct: 100,
    btcRegimeSmaBars: 53,
    btcRegimeMomentumBars: 52,
    regimeThresholdPct: 0.0377,
    momentumBars: 45,
    breakoutBars: 18,
    breakoutBufferPct: 0.0233,
    minimumMomentumPct: 0.0227,
    minimumVolumeRatio: 0.9845,
    minimumEdgeToCostRatio: 6.0879,
    volatilityLookbackBars: 15,
    volatilityPenalty: 2.3953,
    atrBars: 31,
    stopAtr: 2.477,
    takeProfitAtr: 3.1995,
    trailingAtr: 0.4,
    maxHoldBars: 23,
    rebalanceBars: 20,
    cooldownBars: 1,
    allowLong: true,
    allowShort: true,
    allowNeutralRegime: true,
    neutralScoreThreshold: 1.4649,
  },
};

function pf(trades: Array<{ netPnl: number }>) {
  const gp = trades.filter(t => t.netPnl > 0).reduce((s,t)=>s+t.netPnl,0);
  const gl = Math.abs(trades.filter(t => t.netPnl < 0).reduce((s,t)=>s+t.netPnl,0));
  return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
}

async function main() {
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END });
  const result = runPerpBacktest({
    genome: FROZEN,
    data,
    window: { label: "combined3y", startTs: START, endTs: END },
    execution: NORMAL,
    targetMonthlyReturnPct: 6,
  });
  const totalNetPnl = result.trades.reduce((s,t)=>s+t.netPnl,0);
  const symbols = UNIVERSE.map(symbol => {
    const trades = result.trades.filter(t => t.symbol === symbol);
    const netPnl = trades.reduce((s,t)=>s+t.netPnl,0);
    const wins = trades.filter(t=>t.netPnl>0).length;
    return {
      symbol,
      trades: trades.length,
      winRatePct: trades.length ? wins / trades.length * 100 : 0,
      netPnl,
      contributionPctOfStartingEquity: netPnl / STARTING_EQUITY * 100,
      shareOfTotalNetProfitPct: totalNetPnl !== 0 ? netPnl / totalNetPnl * 100 : 0,
      profitFactor: pf(trades),
      longTrades: trades.filter(t=>t.side==="long").length,
      shortTrades: trades.filter(t=>t.side==="short").length,
    };
  }).sort((a,b)=>b.netPnl-a.netPnl);
  const out = {
    researchLine: "V26_FROZEN_WINNER_SYMBOL_CONTRIBUTION",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    frozenGenomeId: FROZEN.id,
    universe: UNIVERSE,
    portfolio: {
      cagrPct: result.metrics.cagrPct,
      endingEquity: result.risk.endingEquity,
      totalNetPnl,
      tradeCount: result.trades.length,
      profitFactor: result.metrics.profitFactor,
      maxDrawdownPct: result.metrics.maxDrawdownPct,
    },
    symbols,
    note: "Per-symbol values are contribution to the shared rotating portfolio, not standalone per-symbol CAGR.",
  };
  const root = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(root,"v26-symbol-contribution-report.json"), JSON.stringify(out,null,2), "utf8");
  console.log(JSON.stringify(out,null,2));
}

main().catch(error=>{console.error(error); process.exit(1);});
