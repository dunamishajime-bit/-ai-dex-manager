import fs from "fs/promises";
import path from "path";

import {
    export_equity_curve,
    export_monthly_report,
    export_summary_json,
    export_trade_log,
    explain_strategy_mode,
    run_backtest,
} from "@/lib/strategy/bnb-rotation";
import { getStrategyModeFromEnv, resolveStrategyRuntimeConfig, selectStrategyPreset, type StrategyMode, type StrategyRuntimeConfig } from "@/config/strategyMode";

const REPORT_DIR = path.join(process.cwd(), "reports", "bnb-rotation");

async function loadStrategyConfigFile(): Promise<Partial<StrategyRuntimeConfig>> {
    const filePath = path.join(process.cwd(), "strategy.config.json");
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw) as Partial<StrategyRuntimeConfig>;
    } catch {
        return {};
    }
}

function parseStrategyMode(argv: string[], configFile?: Partial<StrategyRuntimeConfig>): StrategyMode {
    const explicitArg = argv.find((value) => value.startsWith("--strategy-mode="));
    const explicit = explicitArg?.split("=")[1] || process.env.STRATEGY_MODE || configFile?.strategy_mode || getStrategyModeFromEnv();
    const normalized = String(explicit || "").trim().toUpperCase();
    return normalized === "A_ATTACK" ? "A_ATTACK" : "A_BALANCE";
}

async function main() {
    const configFile = await loadStrategyConfigFile();
    const mode = parseStrategyMode(process.argv.slice(2), configFile);
    const runtimeConfig = resolveStrategyRuntimeConfig({
        strategy_mode: mode,
        fee_rate: configFile.fee_rate,
        target_alloc: configFile.target_alloc,
        symbols: configFile.symbols,
    });
    const preset = selectStrategyPreset(mode);
    const result = await run_backtest(mode, undefined, {
        feeRate: runtimeConfig.fee_rate ?? preset.feeRate,
        targetAlloc: runtimeConfig.target_alloc ?? preset.targetAlloc,
    });
    await fs.mkdir(REPORT_DIR, { recursive: true });

    const tradeLogPath = await export_trade_log(result, REPORT_DIR);
    const equityCurvePath = await export_equity_curve(result, REPORT_DIR);
    const monthlyPath = await export_monthly_report(result, REPORT_DIR);
    const summaryPath = await export_summary_json(result, REPORT_DIR);
    const summaryMd = path.join(REPORT_DIR, `${mode.toLowerCase()}-summary.md`);

    await fs.writeFile(summaryMd, [
        `# BNB Rotation Backtest - ${mode}`,
        "",
        `- btc_sma: ${preset.btcSma}`,
        `- candidate_sma: ${preset.candidateSma}`,
        `- rebalance_bars: ${preset.rebalanceBars}`,
        `- avax_mom_threshold: ${preset.avaxMomThreshold}`,
        `- sol_overheat_limit: ${preset.solOverheatLimit}`,
        `- target_alloc: ${preset.targetAlloc}`,
        `- fee_rate: ${preset.feeRate}`,
        `- runtime_config: ${JSON.stringify(runtimeConfig)}`,
        "",
        "## Strategy Snapshot",
        `- ${JSON.stringify(explain_strategy_mode(mode))}`,
        "",
        "## Summary",
        `- CAGR: ${result.summary.cagr_pct.toFixed(2)}%`,
        `- Max DD: ${result.summary.max_drawdown_pct.toFixed(2)}%`,
        `- Win Rate: ${result.summary.win_rate_pct.toFixed(2)}%`,
        `- PF: ${result.summary.profit_factor.toFixed(2)}`,
        `- Trades: ${result.summary.trade_count}`,
        `- Exposure: ${result.summary.exposure_pct.toFixed(2)}%`,
        "",
        "## Symbol Contribution",
        ...Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => `- ${symbol}: ${pnl.toFixed(2)}`),
        "",
        "## Files",
        `- ${tradeLogPath}`,
        `- ${equityCurvePath}`,
        `- ${monthlyPath}`,
        `- ${summaryPath}`,
    ].join("\n"), "utf8");

    console.log(JSON.stringify({
        strategy_mode: mode,
        preset,
        summary: result.summary,
        files: {
            tradeLogPath,
            equityCurvePath,
            monthlyPath,
            summaryPath,
            summaryMd,
        },
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
