import fs from "node:fs/promises";
import path from "node:path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2026, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 15, 23, 59, 59, 999);
const REPORT_DIR = path.join(
  process.cwd(),
  "reports",
  `v7-exit-tightening-${new Date(START_TS).toISOString().slice(0, 10)}-${new Date(END_TS).toISOString().slice(0, 10)}`,
);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function main() {
  const strategy = await import("../config/reclaimHybridStrategy");
  const engine = await import("../lib/backtest/hybrid-engine");
  const {
    RECLAIM_HYBRID_EXECUTION_PROFILE,
    buildReclaimHybridCashRescueVariantOptions,
  } = strategy;
  const { runHybridBacktest } = engine;

  const base = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };

  const variants: Array<{ key: string; note: string; overrides: Record<string, unknown> }> = [
    {
      key: "current",
      note: "現行V7そのまま",
      overrides: {},
    },
    {
      key: "pengu_protect_3pct",
      note: "+3%到達から1.5%戻しでPENGU利益保護を始める",
      overrides: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.03, retracePct: 0.015 },
            { activationPct: 0.05, retracePct: 0.025 },
            { activationPct: 0.18, retracePct: 0.0475 },
            { activationPct: 0.21, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
      },
    },
    {
      key: "pengu_protect_2pct",
      note: "+2%到達から1.2%戻しでPENGU利益保護を始める",
      overrides: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.02, retracePct: 0.012 },
            { activationPct: 0.05, retracePct: 0.025 },
            { activationPct: 0.18, retracePct: 0.0475 },
            { activationPct: 0.21, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
      },
    },
    {
      key: "pengu_maxhold_96",
      note: "PENGU maxHoldを96本=24時間へ短縮",
      overrides: {
        idleBreakoutMaxHoldBars: 96,
      },
    },
    {
      key: "pengu_maxhold_72",
      note: "PENGU maxHoldを72本=18時間へ短縮",
      overrides: {
        idleBreakoutMaxHoldBars: 72,
      },
    },
    {
      key: "pengu_weak_loose_16",
      note: "16本後にmom20<=4%かつmomAccel<=0ならSMA40条件なしで弱退出",
      overrides: {
        idleBreakoutWeakExitMom20Below: 0.04,
        idleBreakoutWeakExitMomAccelBelow: 0,
        idleBreakoutWeakExitMinHoldBars: 16,
        idleBreakoutWeakExitRequireCloseBelowSma40: false,
      },
    },
    {
      key: "pengu_protect_3pct_weak16",
      note: "+3%利益保護と16本後弱退出の複合",
      overrides: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.03, retracePct: 0.015 },
            { activationPct: 0.05, retracePct: 0.025 },
            { activationPct: 0.18, retracePct: 0.0475 },
            { activationPct: 0.21, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
        idleBreakoutWeakExitMom20Below: 0.04,
        idleBreakoutWeakExitMomAccelBelow: 0,
        idleBreakoutWeakExitMinHoldBars: 16,
        idleBreakoutWeakExitRequireCloseBelowSma40: false,
      },
    },
  ].filter((variant) => {
    const wanted = process.env.BT_VARIANTS;
    if (!wanted) return true;
    return wanted.split(",").map((item) => item.trim()).includes(variant.key);
  });

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];

  for (const variant of variants) {
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...base,
      ...variant.overrides,
      label: `v7_2026_exit_${variant.key}`,
    } as typeof base);
    const elapsedSec = round((Date.now() - started) / 1000, 1);
    const pengu = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
    const idleTime = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-time");
    rows.push({
      key: variant.key,
      note: variant.note,
      endEquity: round(result.summary.end_equity),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      trades: result.summary.trade_count,
      exposurePct: round(result.summary.exposure_pct),
      penguTrades: pengu.length,
      penguPnl: round(pengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
      idleTimeTrades: idleTime.length,
      idleTimePnl: round(idleTime.reduce((sum, trade) => sum + trade.net_pnl, 0)),
      elapsedSec,
    });
  }

  const baseline = rows[0].endEquity;
  const lines = [
    "# V7 2026 exit tightening test",
    "",
    `Period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | note | End Equity | vs current | MaxDD | PF | trades | exposure | PENGU PnL | idle-time trades | idle-time PnL | sec |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => {
      const diff = round(row.endEquity - baseline);
      return `| ${row.key} | ${row.note} | ${row.endEquity.toLocaleString()} | ${diff.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.idleTimeTrades} | ${row.idleTimePnl.toLocaleString()} | ${row.elapsedSec} |`;
    }),
    "",
  ];

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
