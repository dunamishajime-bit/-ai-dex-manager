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
  `v7-other-symbol-early-trail-${new Date(START_TS).toISOString().slice(0, 10)}-${new Date(END_TS).toISOString().slice(0, 10)}`,
);

const NORMAL_SYMBOLS = ["ETH", "SOL", "AVAX", "UNI", "INJ", "TWT"] as const;
const TRAIL_ACT = 0.03;
const TRAIL_RET = 0.015;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mapSymbols(value: number) {
  return Object.fromEntries(NORMAL_SYMBOLS.map((symbol) => [symbol, value]));
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

  const variants = [
    {
      key: "current",
      note: "現行V7",
      overrides: {},
    },
    ...NORMAL_SYMBOLS.map((symbol) => ({
      key: `${symbol.toLowerCase()}_only_3_15`,
      note: `${symbol}の通常トレンドだけ+3%/1.5%戻し`,
      overrides: {
        trendProfitTrailActivationPctBySymbol: {
          ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
          [symbol]: TRAIL_ACT,
        },
        trendProfitTrailRetracePctBySymbol: {
          ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
          [symbol]: TRAIL_RET,
        },
      },
    })),
    {
      key: "normal_symbols_3_15",
      note: "ETH/SOL/AVAX/UNI/INJ/TWT 通常トレンドに+3%/1.5%戻し",
      overrides: {
        trendProfitTrailActivationPctBySymbol: {
          ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
          ...mapSymbols(TRAIL_ACT),
        },
        trendProfitTrailRetracePctBySymbol: {
          ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
          ...mapSymbols(TRAIL_RET),
        },
      },
    },
    {
      key: "doge_strict_3_15",
      note: "DOGE strict extraに+3%/1.5%戻し",
      overrides: {
        strictExtraTrendTrailActivationPctBySymbol: {
          ...(base.strictExtraTrendTrailActivationPctBySymbol ?? {}),
          DOGE: TRAIL_ACT,
        },
        strictExtraTrendTrailRetracePctBySymbol: {
          ...(base.strictExtraTrendTrailRetracePctBySymbol ?? {}),
          DOGE: TRAIL_RET,
        },
      },
    },
    {
      key: "inj_spring_3_15",
      note: "INJ春cashに+3%/1.5%戻し",
      overrides: {
        injSpringCashTrailActivationPct: TRAIL_ACT,
        injSpringCashTrailRetracePct: TRAIL_RET,
      },
    },
    {
      key: "normal_plus_doge_3_15",
      note: "通常トレンド全対象 + DOGEに+3%/1.5%戻し",
      overrides: {
        trendProfitTrailActivationPctBySymbol: {
          ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
          ...mapSymbols(TRAIL_ACT),
        },
        trendProfitTrailRetracePctBySymbol: {
          ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
          ...mapSymbols(TRAIL_RET),
        },
        strictExtraTrendTrailActivationPctBySymbol: {
          ...(base.strictExtraTrendTrailActivationPctBySymbol ?? {}),
          DOGE: TRAIL_ACT,
        },
        strictExtraTrendTrailRetracePctBySymbol: {
          ...(base.strictExtraTrendTrailRetracePctBySymbol ?? {}),
          DOGE: TRAIL_RET,
        },
      },
    },
    {
      key: "all_other_3_15",
      note: "PENGU以外の通常/DOGE/INJ春すべてに+3%/1.5%戻し",
      overrides: {
        trendProfitTrailActivationPctBySymbol: {
          ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
          ...mapSymbols(TRAIL_ACT),
        },
        trendProfitTrailRetracePctBySymbol: {
          ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
          ...mapSymbols(TRAIL_RET),
        },
        strictExtraTrendTrailActivationPctBySymbol: {
          ...(base.strictExtraTrendTrailActivationPctBySymbol ?? {}),
          DOGE: TRAIL_ACT,
        },
        strictExtraTrendTrailRetracePctBySymbol: {
          ...(base.strictExtraTrendTrailRetracePctBySymbol ?? {}),
          DOGE: TRAIL_RET,
        },
        injSpringCashTrailActivationPct: TRAIL_ACT,
        injSpringCashTrailRetracePct: TRAIL_RET,
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
      label: `v7_other_symbol_early_trail_${variant.key}`,
    } as typeof base);
    const elapsedSec = round((Date.now() - started) / 1000, 1);
    const symbolRows = Object.entries(result.summary.symbol_contribution)
      .map(([symbol, pnl]) => ({
        symbol,
        pnl: round(Number(pnl)),
        trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
      }))
      .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
    rows.push({
      key: variant.key,
      note: variant.note,
      endEquity: round(result.summary.end_equity),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      trades: result.summary.trade_count,
      exposurePct: round(result.summary.exposure_pct),
      symbolRows,
      trailingExits: result.trade_pairs.filter((trade) =>
        ["trend-profit-trailing", "strict-extra-trailing", "inj-spring-trailing"].includes(trade.exit_reason),
      ).length,
      elapsedSec,
    });
  }

  const baseline = rows[0]?.endEquity ?? 0;
  const lines = [
    "# V7 other-symbol early trail test",
    "",
    `Period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    `Trail: +${(TRAIL_ACT * 100).toFixed(1)}% / ${(TRAIL_RET * 100).toFixed(1)}% retrace`,
    "",
    "| variant | note | End Equity | vs current | MaxDD | PF | trades | exposure | trail exits | sec |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => {
      const diff = round(row.endEquity - baseline);
      return `| ${row.key} | ${row.note} | ${row.endEquity.toLocaleString()} | ${diff.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.trailingExits} | ${row.elapsedSec} |`;
    }),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.key}`,
      "",
      "| symbol | pnl | trades |",
      "|---|---:|---:|",
      ...row.symbolRows.map((symbolRow) => `| ${symbolRow.symbol} | ${symbolRow.pnl.toLocaleString()} | ${symbolRow.trades} |`),
      "",
    ]),
  ];

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
