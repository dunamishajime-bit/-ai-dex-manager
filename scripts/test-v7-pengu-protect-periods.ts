import fs from "node:fs/promises";
import path from "node:path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-protect-periods");

type Period = {
  key: string;
  start: string;
  end: string;
};

const periods: Period[] = [
  { key: "2023", start: "2023-01-01", end: "2023-12-31" },
  { key: "2024", start: "2024-01-01", end: "2024-12-31" },
  { key: "2024_pengu_start", start: "2024-12-17", end: "2024-12-31" },
  { key: "2025_h1", start: "2025-01-01", end: "2025-06-30" },
  { key: "2025_h2", start: "2025-07-01", end: "2025-12-31" },
  { key: "pengu_start_2025", start: "2024-12-17", end: "2025-12-31" },
  { key: "2026_ytd", start: "2026-01-01", end: "2026-05-15" },
  { key: "pengu_era", start: "2024-12-17", end: "2026-05-15" },
  { key: "full", start: "2022-01-01", end: "2026-05-15" },
];

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

function protectOverrides(currentTiers: readonly { activationPct: number; retracePct: number }[] = []) {
  const withoutDuplicate = currentTiers.filter((tier) => tier.activationPct !== 0.03);
  return {
    idleBreakoutTieredTrailBySymbol: {
      PENGU: [
        { activationPct: 0.03, retracePct: 0.015 },
        ...withoutDuplicate,
      ],
    },
  };
}

async function main() {
  const strategy = await import("../config/reclaimHybridStrategy");
  const engine = await import("../lib/backtest/hybrid-engine");
  const {
    RECLAIM_HYBRID_EXECUTION_PROFILE,
    buildReclaimHybridCashRescueVariantOptions,
  } = strategy;
  const { runHybridBacktest } = engine;

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseProfileOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const currentTiers = baseProfileOptions.idleBreakoutTieredTrailBySymbol?.PENGU ?? [];
  const requested = process.env.BT_PERIODS
    ? new Set(process.env.BT_PERIODS.split(",").map((item) => item.trim()))
    : null;
  const rows = [];

  for (const period of periods) {
    if (requested && !requested.has(period.key)) continue;
    const base = {
      ...baseProfileOptions,
      backtestStartTs: parseStart(period.start),
      backtestEndTs: parseEnd(period.end),
    };
    for (const variant of [
      { key: "current", overrides: {} },
      { key: "pengu_protect_3_15", overrides: protectOverrides(currentTiers) },
    ]) {
      const started = Date.now();
      const result = await runHybridBacktest("RETQ22", {
        ...base,
        ...variant.overrides,
        label: `v7_${period.key}_${variant.key}`,
      } as typeof base);
      const pengu = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
      const idleTrailing = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-trailing");
      const idleTime = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-time");
      rows.push({
        period: period.key,
        variant: variant.key,
        start: period.start,
        end: period.end,
        elapsedSec: round((Date.now() - started) / 1000, 1),
        endEquity: round(result.summary.end_equity),
        maxDrawdownPct: round(result.summary.max_drawdown_pct),
        profitFactor: round(result.summary.profit_factor, 3),
        trades: result.summary.trade_count,
        exposurePct: round(result.summary.exposure_pct),
        penguTrades: pengu.length,
        penguPnl: round(pengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        idleTrailingTrades: idleTrailing.length,
        idleTimeTrades: idleTime.length,
        idleTimePnl: round(idleTime.reduce((sum, trade) => sum + trade.net_pnl, 0)),
      });
      await fs.writeFile(
        path.join(REPORT_DIR, `${period.key}-${variant.key}-trades.json`),
        JSON.stringify(result.trade_pairs, null, 2),
        "utf8",
      );
    }
  }

  const byPeriod = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byPeriod.get(row.period) ?? [];
    list.push(row);
    byPeriod.set(row.period, list);
  }

  const lines = [
    "# V7 PENGU +3% / 1.5% Protect Period Test",
    "",
    "| period | variant | End Equity | vs current | MaxDD | PF | trades | exposure | PENGU PnL | PENGU trades | idle-time PnL | sec |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const [period, periodRows] of byPeriod.entries()) {
    const baseline = periodRows.find((row) => row.variant === "current")?.endEquity ?? 0;
    for (const row of periodRows) {
      lines.push(`| ${period} | ${row.variant} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.penguTrades} | ${row.idleTimePnl.toLocaleString()} | ${row.elapsedSec} |`);
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
