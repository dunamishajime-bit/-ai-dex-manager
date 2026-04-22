import fs from "fs/promises";
import path from "path";

import type { BacktestResult } from "./types";

function toCsv(rows: Record<string, unknown>[]) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const escape = (value: unknown) => {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
    ].join("\n");
}

export async function writeBacktestArtifacts(result: BacktestResult, outDir: string) {
    await fs.mkdir(outDir, { recursive: true });

    const prefix = result.mode.toLowerCase();
    const tradeEventsPath = path.join(outDir, `${prefix}-trade_events.csv`);
    const tradePairsPath = path.join(outDir, `${prefix}-trade_pairs.csv`);
    const equityCurvePath = path.join(outDir, `${prefix}-equity_curve.csv`);
    const monthlyPath = path.join(outDir, `${prefix}-monthly_returns.csv`);
    const annualPath = path.join(outDir, `${prefix}-annual_returns.csv`);
    const summaryPath = path.join(outDir, `${prefix}-summary.json`);

    await fs.writeFile(tradeEventsPath, toCsv(result.trade_events as unknown as Record<string, unknown>[]), "utf8");
    await fs.writeFile(tradePairsPath, toCsv(result.trade_pairs as unknown as Record<string, unknown>[]), "utf8");
    await fs.writeFile(equityCurvePath, toCsv(result.equity_curve as unknown as Record<string, unknown>[]), "utf8");
    await fs.writeFile(monthlyPath, toCsv(result.monthly_returns as unknown as Record<string, unknown>[]), "utf8");
    await fs.writeFile(annualPath, toCsv(result.annual_returns as unknown as Record<string, unknown>[]), "utf8");
    await fs.writeFile(summaryPath, JSON.stringify(result.summary, null, 2), "utf8");

    return {
        tradeEventsPath,
        tradePairsPath,
        equityCurvePath,
        monthlyPath,
        annualPath,
        summaryPath,
    };
}

export function formatResultSummary(result: BacktestResult) {
    return [
        `- mode: ${result.mode}`,
        `- end_equity: ${result.summary.end_equity.toFixed(2)}`,
        `- CAGR: ${result.summary.cagr_pct.toFixed(2)}%`,
        `- MaxDD: ${result.summary.max_drawdown_pct.toFixed(2)}%`,
        `- WinRate: ${result.summary.win_rate_pct.toFixed(2)}%`,
        `- PF: ${result.summary.profit_factor.toFixed(2)}`,
        `- Trades: ${result.summary.trade_count}`,
    ].join("\n");
}

export function renderComparisonMarkdown(base: BacktestResult, retq22: BacktestResult) {
    const row = (label: string, getter: (result: BacktestResult) => number) =>
        `| ${label} | ${getter(base).toFixed(2)} | ${getter(retq22).toFixed(2)} | ${(getter(retq22) - getter(base)).toFixed(2)} |`;

    return [
        "# RETQ22 比較レポート",
        "",
        "| 指標 | 現行ロジック | RETQ22追加版 | 差分 |",
        "| --- | ---: | ---: | ---: |",
        row("End Equity", (result) => result.summary.end_equity),
        row("CAGR %", (result) => result.summary.cagr_pct),
        row("MaxDD %", (result) => result.summary.max_drawdown_pct),
        row("Win Rate %", (result) => result.summary.win_rate_pct),
        row("Profit Factor", (result) => result.summary.profit_factor),
        row("Trade Count", (result) => result.summary.trade_count),
        row("Exposure %", (result) => result.summary.exposure_pct),
        "",
        "## 現行ロジック要約",
        formatResultSummary(base),
        "",
        "## RETQ22追加版要約",
        formatResultSummary(retq22),
        "",
        "## 年次リターン",
        ...base.annual_returns.map((item, index) => {
            const newer = retq22.annual_returns[index];
            return `- ${item.period}: base ${item.return_pct.toFixed(2)}% / retq22 ${newer?.return_pct.toFixed(2) || "0.00"}%`;
        }),
        "",
        "## 月次リターン",
        ...base.monthly_returns.map((item, index) => {
            const newer = retq22.monthly_returns[index];
            return `- ${item.period}: base ${item.return_pct.toFixed(2)}% / retq22 ${newer?.return_pct.toFixed(2) || "0.00"}%`;
        }),
    ].join("\n");
}
