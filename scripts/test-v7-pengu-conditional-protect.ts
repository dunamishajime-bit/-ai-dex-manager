import fs from "node:fs/promises";
import path from "node:path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-conditional-protect");

const periods = [
  { key: "2026_ytd", start: "2026-01-01", end: "2026-05-15" },
  { key: "pengu_start_2025", start: "2024-12-17", end: "2025-12-31" },
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

function allProtect(currentTiers: readonly { activationPct: number; retracePct: number }[] = []) {
  return {
    idleBreakoutTieredTrailBySymbol: {
      PENGU: [
        { activationPct: 0.03, retracePct: 0.015 },
        ...currentTiers.filter((tier) => tier.activationPct !== 0.03),
      ],
    },
  };
}

function conditionalProtect(rule: {
  maxMom20?: number;
  maxMom80?: number;
  maxMomAccel?: number;
  maxVolumeRatio?: number;
  maxEfficiencyRatio?: number;
  minRecentHighDrawdownPct?: number;
  minClose?: number;
  maxClose?: number;
  activeFromTs?: number;
  activeUntilTs?: number;
  minHoldBars?: number;
  minBarsSincePeak?: number;
  disableWhenMom20AtLeast?: number;
  disableWhenMom80AtLeast?: number;
  disableWhenMomAccelAtLeast?: number;
  disableWhenVolumeRatioAtLeast?: number;
  disableWhenEfficiencyRatioAtLeast?: number;
  disableMode?: "any" | "all";
}) {
  return {
    idleBreakoutConditionalEarlyTrailBySymbol: {
      PENGU: {
        activationPct: 0.03,
        retracePct: 0.015,
        ...rule,
      },
    },
  };
}

function takeProfitExit(takeProfitPct: number) {
  return {
    idleBreakoutTakeProfitExitBySymbol: {
      PENGU: { takeProfitPct },
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
  const variants = [
    { key: "range25_125_m80_5_dd2", note: "PENGU +2.5%/1.25%, mom80<=5%, high-dd>=2%", overrides: conditionalProtect({ activationPct: 0.025, retracePct: 0.0125, maxMom80: 0.05, minRecentHighDrawdownPct: 0.02 }) },
    { key: "range25_15_m80_5_dd2", note: "PENGU +2.5%/1.5%, mom80<=5%, high-dd>=2%", overrides: conditionalProtect({ activationPct: 0.025, retracePct: 0.015, maxMom80: 0.05, minRecentHighDrawdownPct: 0.02 }) },
    { key: "fixed3_all_exit", note: "PENGU +3%到達で全決済", overrides: takeProfitExit(0.03) },
    {
      key: "fixed15_reentry15_96",
      note: "PENGU +1.5%到達で全決済後、+1.5%再上昇で全額再エントリー",
      overrides: {
        ...takeProfitExit(0.015),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.015, maxBarsAfterExit: 96 } },
      },
    },
    { key: "current", note: "現行V7", overrides: {} },
    { key: "all_3_15", note: "全PENGU +3%/1.5%", overrides: allProtect(currentTiers) },
    { key: "mom20_le_5", note: "mom20<=5%だけ+3%/1.5%", overrides: conditionalProtect({ maxMom20: 0.05 }) },
    { key: "mom20_le_8", note: "mom20<=8%だけ+3%/1.5%", overrides: conditionalProtect({ maxMom20: 0.08 }) },
    { key: "accel_le_0", note: "momAccel<=0だけ+3%/1.5%", overrides: conditionalProtect({ maxMomAccel: 0 }) },
    { key: "accel_le_005", note: "momAccel<=0.5%だけ+3%/1.5%", overrides: conditionalProtect({ maxMomAccel: 0.005 }) },
    { key: "volume_le_115", note: "volumeRatio<=1.15だけ+3%/1.5%", overrides: conditionalProtect({ maxVolumeRatio: 1.15 }) },
    { key: "volume_le_13", note: "volumeRatio<=1.30だけ+3%/1.5%", overrides: conditionalProtect({ maxVolumeRatio: 1.3 }) },
    { key: "mom20_8_accel_005", note: "mom20<=8%かつmomAccel<=0.5%だけ+3%/1.5%", overrides: conditionalProtect({ maxMom20: 0.08, maxMomAccel: 0.005 }) },
    { key: "mom20_8_volume_13", note: "mom20<=8%かつvolumeRatio<=1.30だけ+3%/1.5%", overrides: conditionalProtect({ maxMom20: 0.08, maxVolumeRatio: 1.3 }) },
    { key: "price_le_014", note: "PENGU価格<=0.014だけ+3%/1.5%", overrides: conditionalProtect({ maxClose: 0.014 }) },
    { key: "price_le_012", note: "PENGU価格<=0.012だけ+3%/1.5%", overrides: conditionalProtect({ maxClose: 0.012 }) },
    { key: "price_le_010", note: "PENGU価格<=0.010だけ+3%/1.5%", overrides: conditionalProtect({ maxClose: 0.010 }) },
    { key: "price_le_014_volume_13", note: "価格<=0.014かつvolumeRatio<=1.30だけ+3%/1.5%", overrides: conditionalProtect({ maxClose: 0.014, maxVolumeRatio: 1.3 }) },
    { key: "price_le_014_mom20_8", note: "価格<=0.014かつmom20<=8%だけ+3%/1.5%", overrides: conditionalProtect({ maxClose: 0.014, maxMom20: 0.08 }) },
    { key: "from_2026_all", note: "2026以降だけ全PENGU +3%/1.5%", overrides: conditionalProtect({ activeFromTs: Date.parse("2026-01-01T00:00:00.000Z") }) },
    { key: "from_2026_price_012", note: "2026以降かつ価格<=0.012だけ+3%/1.5%", overrides: conditionalProtect({ activeFromTs: Date.parse("2026-01-01T00:00:00.000Z"), maxClose: 0.012 }) },
    { key: "from_2026_price_014", note: "2026以降かつ価格<=0.014だけ+3%/1.5%", overrides: conditionalProtect({ activeFromTs: Date.parse("2026-01-01T00:00:00.000Z"), maxClose: 0.014 }) },
    { key: "not_big_mom20_15_accel_005", note: "mom20>=15%かつmomAccel>=0.5%なら大波扱いで+3%保護なし", overrides: conditionalProtect({ disableWhenMom20AtLeast: 0.15, disableWhenMomAccelAtLeast: 0.005, disableMode: "all" }) },
    { key: "not_big_mom20_20_accel_01", note: "mom20>=20%かつmomAccel>=1%なら大波扱いで+3%保護なし", overrides: conditionalProtect({ disableWhenMom20AtLeast: 0.2, disableWhenMomAccelAtLeast: 0.01, disableMode: "all" }) },
    { key: "not_big_mom20_12_vol_14", note: "mom20>=12%かつvolumeRatio>=1.4なら大波扱いで+3%保護なし", overrides: conditionalProtect({ disableWhenMom20AtLeast: 0.12, disableWhenVolumeRatioAtLeast: 1.4, disableMode: "all" }) },
    { key: "not_big_mom20_15_vol_13", note: "mom20>=15%かつvolumeRatio>=1.3なら大波扱いで+3%保護なし", overrides: conditionalProtect({ disableWhenMom20AtLeast: 0.15, disableWhenVolumeRatioAtLeast: 1.3, disableMode: "all" }) },
    { key: "not_big_any_mom20_20_vol_18", note: "mom20>=20%またはvolumeRatio>=1.8なら大波扱いで+3%保護なし", overrides: conditionalProtect({ disableWhenMom20AtLeast: 0.2, disableWhenVolumeRatioAtLeast: 1.8, disableMode: "any" }) },
    { key: "from_2026_not_big_mom20_15_accel_005", note: "2026以降、mom20>=15%かつmomAccel>=0.5%なら+3%保護なし", overrides: conditionalProtect({ activeFromTs: Date.parse("2026-01-01T00:00:00.000Z"), disableWhenMom20AtLeast: 0.15, disableWhenMomAccelAtLeast: 0.005, disableMode: "all" }) },
    { key: "minhold_4", note: "4本保有後だけ+3%/1.5%", overrides: conditionalProtect({ minHoldBars: 4 }) },
    { key: "minhold_8", note: "8本保有後だけ+3%/1.5%", overrides: conditionalProtect({ minHoldBars: 8 }) },
    { key: "minhold_16", note: "16本保有後だけ+3%/1.5%", overrides: conditionalProtect({ minHoldBars: 16 }) },
    { key: "minhold_24", note: "24本保有後だけ+3%/1.5%", overrides: conditionalProtect({ minHoldBars: 24 }) },
    { key: "from_2026_minhold_8", note: "2026以降、8本保有後だけ+3%/1.5%", overrides: conditionalProtect({ activeFromTs: Date.parse("2026-01-01T00:00:00.000Z"), minHoldBars: 8 }) },
    { key: "from_2026_minhold_16", note: "2026以降、16本保有後だけ+3%/1.5%", overrides: conditionalProtect({ activeFromTs: Date.parse("2026-01-01T00:00:00.000Z"), minHoldBars: 16 }) },
    { key: "stall_peak_1", note: "+3%後ピーク更新から1本経過して戻した時だけ保護", overrides: conditionalProtect({ minBarsSincePeak: 1 }) },
    { key: "stall_peak_2", note: "+3%後ピーク更新から2本経過して戻した時だけ保護", overrides: conditionalProtect({ minBarsSincePeak: 2 }) },
    { key: "stall_peak_4", note: "+3%後ピーク更新から4本経過して戻した時だけ保護", overrides: conditionalProtect({ minBarsSincePeak: 4 }) },
    { key: "stall_peak_8", note: "+3%後ピーク更新から8本経過して戻した時だけ保護", overrides: conditionalProtect({ minBarsSincePeak: 8 }) },
    { key: "stall_peak_2_mom20_12", note: "ピーク2本停滞かつmom20<12%だけ保護", overrides: conditionalProtect({ minBarsSincePeak: 2, maxMom20: 0.12 }) },
    { key: "stall_peak_2_vol_16", note: "ピーク2本停滞かつvolumeRatio<1.6だけ保護", overrides: conditionalProtect({ minBarsSincePeak: 2, maxVolumeRatio: 1.6 }) },
    { key: "vol_le_20", note: "volumeRatio<=2.0だけ+3%/1.5%", overrides: conditionalProtect({ maxVolumeRatio: 2.0 }) },
    { key: "vol_le_22", note: "volumeRatio<=2.2だけ+3%/1.5%", overrides: conditionalProtect({ maxVolumeRatio: 2.2 }) },
    { key: "vol_le_25", note: "volumeRatio<=2.5だけ+3%/1.5%", overrides: conditionalProtect({ maxVolumeRatio: 2.5 }) },
    { key: "mom20_le_4_vol_le_25", note: "mom20<=4%かつvolumeRatio<=2.5だけ+3%/1.5%", overrides: conditionalProtect({ maxMom20: 0.04, maxVolumeRatio: 2.5 }) },
    { key: "mom20_le_3_vol_le_25", note: "mom20<=3%かつvolumeRatio<=2.5だけ+3%/1.5%", overrides: conditionalProtect({ maxMom20: 0.03, maxVolumeRatio: 2.5 }) },
    { key: "partial25_3_runner", note: "+3%で25%だけ利確、残りは現行trail", overrides: { idleBreakoutPartialExitBySymbol: { PENGU: { fraction: 0.25, baseTakeProfitPct: 0.03 } } } },
    { key: "partial33_3_runner", note: "+3%で33%だけ利確、残りは現行trail", overrides: { idleBreakoutPartialExitBySymbol: { PENGU: { fraction: 0.33, baseTakeProfitPct: 0.03 } } } },
    { key: "partial50_3_runner", note: "+3%で50%だけ利確、残りは現行trail", overrides: { idleBreakoutPartialExitBySymbol: { PENGU: { fraction: 0.5, baseTakeProfitPct: 0.03 } } } },
    { key: "partial25_3_stop1", note: "+3%で25%利確、残りは+1%割れで撤退", overrides: { idleBreakoutPartialExitBySymbol: { PENGU: { fraction: 0.25, baseTakeProfitPct: 0.03, stopAfterPartialPct: 0.01 } } } },
    { key: "partial25_3_runner12_5", note: "+3%で25%利確、残りは+12%/5%戻し", overrides: { idleBreakoutPartialExitBySymbol: { PENGU: { fraction: 0.25, baseTakeProfitPct: 0.03, runnerTrailActivationPct: 0.12, runnerTrailRetracePct: 0.05 } } } },
    {
      key: "early3_reentry15_96",
      note: "+3%/1.5%で一度決済、+1.5%再上昇で再エントリー",
      overrides: {
        ...conditionalProtect({}),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.015, maxBarsAfterExit: 96 } },
      },
    },
    {
      key: "early3_reentry10_96",
      note: "+3%/1.5%決済後、+1.0%再上昇で再エントリー",
      overrides: {
        ...conditionalProtect({}),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.01, maxBarsAfterExit: 96 } },
      },
    },
    {
      key: "early3_reentry20_96",
      note: "+3%/1.5%決済後、+2.0%再上昇で再エントリー",
      overrides: {
        ...conditionalProtect({}),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.02, maxBarsAfterExit: 96 } },
      },
    },
    {
      key: "early3_reentry15_24",
      note: "+3%/1.5%決済後、24本以内に+1.5%再上昇で再エントリー",
      overrides: {
        ...conditionalProtect({}),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.015, maxBarsAfterExit: 24 } },
      },
    },
    { key: "range_mom80_0_dd2", note: "mom80<=0かつ直近高値から2%以上下だけ+3%保護", overrides: conditionalProtect({ maxMom80: 0, minRecentHighDrawdownPct: 0.02 }) },
    { key: "range_mom80_3_dd2", note: "mom80<=3%かつ直近高値から2%以上下だけ+3%保護", overrides: conditionalProtect({ maxMom80: 0.03, minRecentHighDrawdownPct: 0.02 }) },
    { key: "range_mom80_5_dd2", note: "mom80<=5%かつ直近高値から2%以上下だけ+3%保護", overrides: conditionalProtect({ maxMom80: 0.05, minRecentHighDrawdownPct: 0.02 }) },
    { key: "range_mom80_5_dd4", note: "mom80<=5%かつ直近高値から4%以上下だけ+3%保護", overrides: conditionalProtect({ maxMom80: 0.05, minRecentHighDrawdownPct: 0.04 }) },
    { key: "range_mom80_8_dd2", note: "mom80<=8%かつ直近高値から2%以上下だけ+3%保護", overrides: conditionalProtect({ maxMom80: 0.08, minRecentHighDrawdownPct: 0.02 }) },
    { key: "no_big_mom80_8", note: "mom80>=8%なら大波扱いで+3%保護なし", overrides: conditionalProtect({ disableWhenMom80AtLeast: 0.08, disableMode: "any" }) },
    { key: "no_big_mom80_12", note: "mom80>=12%なら大波扱いで+3%保護なし", overrides: conditionalProtect({ disableWhenMom80AtLeast: 0.12, disableMode: "any" }) },
    {
      key: "stall2_reentry15_96",
      note: "+3%到達後、ピーク2本停滞+1.5%戻しで決済、+1.5%再上昇で再エントリー",
      overrides: {
        ...conditionalProtect({ minBarsSincePeak: 2 }),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.015, maxBarsAfterExit: 96 } },
      },
    },
    {
      key: "stall4_reentry15_96",
      note: "+3%到達後、ピーク4本停滞+1.5%戻しで決済、+1.5%再上昇で再エントリー",
      overrides: {
        ...conditionalProtect({ minBarsSincePeak: 4 }),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.015, maxBarsAfterExit: 96 } },
      },
    },
    {
      key: "stall2_reentry10_96",
      note: "+3%到達後、ピーク2本停滞+1.5%戻しで決済、+1.0%再上昇で再エントリー",
      overrides: {
        ...conditionalProtect({ minBarsSincePeak: 2 }),
        idleBreakoutEarlyTrailReentryBySymbol: { PENGU: { reentryPct: 0.01, maxBarsAfterExit: 96 } },
      },
    },
    {
      key: "partial50_runner_reentry15",
      note: "+3%で半分決済、残り半分はピークから1.5%戻し決済、+1.5%で半分再エントリー",
      overrides: {
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.03,
            runnerTrailActivationPct: 0.03,
            runnerTrailRetracePct: 0.015,
          },
        },
        idleBreakoutPartialRunnerReentryBySymbol: { PENGU: { reentryPct: 0.015, maxBarsAfterExit: 96, alloc: 0.5 } },
      },
    },
    {
      key: "partial50_runner_reentry10",
      note: "+3%で半分決済、残り半分はピークから1.5%戻し決済、+1.0%で半分再エントリー",
      overrides: {
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.03,
            runnerTrailActivationPct: 0.03,
            runnerTrailRetracePct: 0.015,
          },
        },
        idleBreakoutPartialRunnerReentryBySymbol: { PENGU: { reentryPct: 0.01, maxBarsAfterExit: 96, alloc: 0.5 } },
      },
    },
  ].filter((variant) => {
    const wanted = process.env.BT_VARIANTS;
    if (!wanted) return true;
    return wanted.split(",").map((item) => item.trim()).includes(variant.key);
  });

  const requestedPeriods = process.env.BT_PERIODS
    ? new Set(process.env.BT_PERIODS.split(",").map((item) => item.trim()))
    : null;

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
        label: `v7_peng_cond_${period.key}_${variant.key}`,
      } as typeof base);
      const pengu = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
      const idleTrailing = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-trailing");
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
        exposurePct: round(result.summary.exposure_pct),
        penguTrades: pengu.length,
        penguPnl: round(pengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        idleTrailingTrades: idleTrailing.length,
        idleTrailingPnl: round(idleTrailing.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        idleTimeTrades: idleTime.length,
        idleTimePnl: round(idleTime.reduce((sum, trade) => sum + trade.net_pnl, 0)),
      });
    }
  }

  const lines = [
    "# V7 PENGU Conditional +3% / 1.5% Protect Test",
    "",
    "| period | variant | note | End Equity | vs current | MaxDD | PF | trades | PENGU PnL | idle-trail PnL | idle-time PnL | sec |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const period of periods) {
    if (requestedPeriods && !requestedPeriods.has(period.key)) continue;
    const periodRows = rows.filter((row) => row.period === period.key);
    const baseline = periodRows.find((row) => row.variant === "current")?.endEquity ?? 0;
    for (const row of periodRows) {
      lines.push(`| ${row.period} | ${row.variant} | ${row.note} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.idleTrailingPnl.toLocaleString()} | ${row.idleTimePnl.toLocaleString()} | ${row.elapsedSec} |`);
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
