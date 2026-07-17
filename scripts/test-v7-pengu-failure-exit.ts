import fs from "node:fs/promises";
import path from "node:path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-failure-exit");

const periods = [
  { key: "2026_ytd", start: "2026-01-01", end: "2026-05-15" },
  { key: "pengu_era", start: "2024-12-17", end: "2026-05-15" },
  { key: "full", start: "2022-01-01", end: "2026-05-15" },
] as const;

function parseStart(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function parseEnd(date: string) {
  return Date.parse(`${date}T23:59:59.999Z`);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function failure(rule: {
  minHoldBars: number;
  maxPeakProfitPct: number;
  requireLoss?: boolean;
  maxMom20?: number;
  maxMomAccel?: number;
  requireCloseBelowSma40?: boolean;
}) {
  return { idleBreakoutFailureExitBySymbol: { PENGU: rule } };
}

async function main() {
  const strategy = await import("../config/reclaimHybridStrategy");
  const engine = await import("../lib/backtest/hybrid-engine");
  const {
    RECLAIM_HYBRID_EXECUTION_PROFILE,
    buildReclaimHybridCashRescueVariantOptions,
  } = strategy;
  const { runHybridBacktest } = engine;

  const variants = [
    { key: "current", note: "現行V7", overrides: {} },
    { key: "h24_peak15_loss_mom3", note: "24本後 peak<1.5% かつ損失 かつmom20<=3%", overrides: failure({ minHoldBars: 24, maxPeakProfitPct: 0.015, requireLoss: true, maxMom20: 0.03 }) },
    { key: "h32_peak15_loss_mom3", note: "32本後 peak<1.5% かつ損失 かつmom20<=3%", overrides: failure({ minHoldBars: 32, maxPeakProfitPct: 0.015, requireLoss: true, maxMom20: 0.03 }) },
    { key: "h48_peak15_loss_mom3", note: "48本後 peak<1.5% かつ損失 かつmom20<=3%", overrides: failure({ minHoldBars: 48, maxPeakProfitPct: 0.015, requireLoss: true, maxMom20: 0.03 }) },
    { key: "h24_peak20_loss_mom5", note: "24本後 peak<2.0% かつ損失 かつmom20<=5%", overrides: failure({ minHoldBars: 24, maxPeakProfitPct: 0.02, requireLoss: true, maxMom20: 0.05 }) },
    { key: "h32_peak20_loss_mom5", note: "32本後 peak<2.0% かつ損失 かつmom20<=5%", overrides: failure({ minHoldBars: 32, maxPeakProfitPct: 0.02, requireLoss: true, maxMom20: 0.05 }) },
    { key: "h24_peak20_mom5", note: "24本後 peak<2.0% かつmom20<=5%", overrides: failure({ minHoldBars: 24, maxPeakProfitPct: 0.02, maxMom20: 0.05 }) },
    { key: "h32_peak20_mom5", note: "32本後 peak<2.0% かつmom20<=5%", overrides: failure({ minHoldBars: 32, maxPeakProfitPct: 0.02, maxMom20: 0.05 }) },
    { key: "h24_peak15_sma", note: "24本後 peak<1.5% かつclose<SMA40", overrides: failure({ minHoldBars: 24, maxPeakProfitPct: 0.015, requireCloseBelowSma40: true }) },
    { key: "h32_peak15_sma", note: "32本後 peak<1.5% かつclose<SMA40", overrides: failure({ minHoldBars: 32, maxPeakProfitPct: 0.015, requireCloseBelowSma40: true }) },
    { key: "h24_peak35_loss_mom5", note: "24本後 peak<3.5% かつ損失 かつmom20<=5%", overrides: failure({ minHoldBars: 24, maxPeakProfitPct: 0.035, requireLoss: true, maxMom20: 0.05 }) },
    { key: "h32_peak35_loss_mom5", note: "32本後 peak<3.5% かつ損失 かつmom20<=5%", overrides: failure({ minHoldBars: 32, maxPeakProfitPct: 0.035, requireLoss: true, maxMom20: 0.05 }) },
    { key: "h48_peak35_loss_mom5", note: "48本後 peak<3.5% かつ損失 かつmom20<=5%", overrides: failure({ minHoldBars: 48, maxPeakProfitPct: 0.035, requireLoss: true, maxMom20: 0.05 }) },
    { key: "h24_peak35_loss", note: "24本後 peak<3.5% かつ損失", overrides: failure({ minHoldBars: 24, maxPeakProfitPct: 0.035, requireLoss: true }) },
    { key: "h32_peak35_loss", note: "32本後 peak<3.5% かつ損失", overrides: failure({ minHoldBars: 32, maxPeakProfitPct: 0.035, requireLoss: true }) },
  ].filter((variant) => {
    const wanted = process.env.BT_VARIANTS;
    if (!wanted) return true;
    return wanted.split(",").map((item) => item.trim()).includes(variant.key);
  });

  const requestedPeriods = process.env.BT_PERIODS
    ? new Set(process.env.BT_PERIODS.split(",").map((item) => item.trim()))
    : null;

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseProfileOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const rows = [];

  for (const period of periods) {
    if (requestedPeriods && !requestedPeriods.has(period.key)) continue;
    const base = {
      ...baseProfileOptions,
      backtestStartTs: parseStart(period.start),
      backtestEndTs: parseEnd(period.end),
    };
    for (const variant of variants) {
      const started = Date.now();
      const result = await runHybridBacktest("RETQ22", {
        ...base,
        ...variant.overrides,
        label: `v7_peng_fail_${period.key}_${variant.key}`,
      } as typeof base);
      const pengu = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
      const failureExits = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-failure");
      const idleTime = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-time");
      rows.push({
        period: period.key,
        variant: variant.key,
        note: variant.note,
        elapsedSec: round((Date.now() - started) / 1000, 1),
        endEquity: round(result.summary.end_equity),
        maxDrawdownPct: round(result.summary.max_drawdown_pct),
        profitFactor: round(result.summary.profit_factor, 3),
        trades: result.summary.trade_count,
        penguPnl: round(pengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        penguTrades: pengu.length,
        failureTrades: failureExits.length,
        failurePnl: round(failureExits.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        idleTimeTrades: idleTime.length,
        idleTimePnl: round(idleTime.reduce((sum, trade) => sum + trade.net_pnl, 0)),
      });
    }
  }

  const lines = [
    "# V7 PENGU Failure Exit Test",
    "",
    "| period | variant | note | End Equity | vs current | MaxDD | PF | trades | PENGU PnL | failure trades | failure PnL | idle-time PnL | sec |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const period of periods) {
    if (requestedPeriods && !requestedPeriods.has(period.key)) continue;
    const periodRows = rows.filter((row) => row.period === period.key);
    const baseline = periodRows.find((row) => row.variant === "current")?.endEquity ?? 0;
    for (const row of periodRows) {
      lines.push(`| ${row.period} | ${row.variant} | ${row.note} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.failureTrades} | ${row.failurePnl.toLocaleString()} | ${row.idleTimePnl.toLocaleString()} | ${row.elapsedSec} |`);
    }
  }
  lines.push("");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
