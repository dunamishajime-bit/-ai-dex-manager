import { classifyAsterSymbol, type AsterPortfolioSleeve } from "@/lib/disdex-aster-portfolio-classifier";

export const V12_PENGU_V52_PORTFOLIO_POLICY = Object.freeze({
    priority: "STOCK_FIRST" as const,
    v12Multiplier: 1,
    v12MaximumGross: 1.5,
    penguMaximumGross: 0.75,
    cryptoGrossCap: 1.5,
    stockGrossCap: 1.5,
    totalGrossCap: 2.5,
    maximumV12Positions: 2,
    preemptions: false,
    forcedRebalance: false,
    topUp: false,
    v96Included: false,
});

export interface PortfolioIntent { sleeve: AsterPortfolioSleeve; symbol: string; side: "LONG" | "SHORT"; gross: number; notionalUsd: number; signalTs: number; }
export interface ActivePortfolioPosition { sleeve: AsterPortfolioSleeve; symbol: string; gross: number; }
export interface PortfolioPlan { accepted: PortfolioIntent[]; rejected: Array<{ intent: PortfolioIntent; reason: string }>; totalGross: number; cryptoGross: number; stockGross: number; }

function sortPriority(intent: PortfolioIntent) {
    const stock = intent.sleeve === "V11_EQ" || intent.sleeve === "V50_POST_OPEN_BASIS";
    return stock ? 1 : intent.sleeve === "PENGU_DUAL_LS_V2" ? 2 : 3;
}

/** Deterministic, no-preemption capacity planner shared by V12/PENGU/V52.
 * It only creates a plan; callers still need sleeve-specific execution gates. */
export function planUnifiedPortfolio(intents: PortfolioIntent[], active: ActivePortfolioPosition[] = []): PortfolioPlan {
    const accepted: PortfolioIntent[] = [];
    const rejected: Array<{ intent: PortfolioIntent; reason: string }> = [];
    let cryptoGross = active.filter((row) => row.sleeve === "V12" || row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + Math.abs(row.gross), 0);
    let stockGross = active.filter((row) => row.sleeve === "V11_EQ" || row.sleeve === "V50_POST_OPEN_BASIS").reduce((sum, row) => sum + Math.abs(row.gross), 0);
    let occupiedV12 = active.filter((row) => row.sleeve === "V12").length;
    let v12Gross = active.filter((row) => row.sleeve === "V12").reduce((sum, row) => sum + Math.abs(row.gross), 0);
    for (const intent of [...intents].sort((a, b) => sortPriority(a) - sortPriority(b) || a.symbol.localeCompare(b.symbol))) {
        const classification = classifyAsterSymbol(intent.symbol, intent.sleeve);
        if (!classification.tradable || classification.sleeve !== intent.sleeve) { rejected.push({ intent, reason: "UNKNOWN_OR_SLEEVE_MISMATCH" }); continue; }
        if (!(intent.gross > 0 && intent.notionalUsd >= 0 && Number.isFinite(intent.signalTs))) { rejected.push({ intent, reason: "INVALID_INTENT" }); continue; }
        if (intent.sleeve === "V12" && occupiedV12 >= V12_PENGU_V52_PORTFOLIO_POLICY.maximumV12Positions) { rejected.push({ intent, reason: "V12_MAX_POSITIONS_REACHED" }); continue; }
        const sleeveCap = intent.sleeve === "V12" ? 1 : intent.sleeve === "PENGU_DUAL_LS_V2" ? 0.75 : 1;
        const gross = Math.min(intent.gross, sleeveCap);
        const isStock = intent.sleeve === "V11_EQ" || intent.sleeve === "V50_POST_OPEN_BASIS";
        const sleeveRemaining = isStock
            ? V12_PENGU_V52_PORTFOLIO_POLICY.stockGrossCap - stockGross
            : intent.sleeve === "V12"
                ? V12_PENGU_V52_PORTFOLIO_POLICY.v12MaximumGross - v12Gross
                : V12_PENGU_V52_PORTFOLIO_POLICY.cryptoGrossCap - cryptoGross;
        const remaining = Math.min(sleeveRemaining, V12_PENGU_V52_PORTFOLIO_POLICY.cryptoGrossCap - cryptoGross, V12_PENGU_V52_PORTFOLIO_POLICY.totalGrossCap - cryptoGross - stockGross);
        if (remaining <= 0 || gross <= 0) { rejected.push({ intent, reason: "CAPACITY_BLOCKED" }); continue; }
        const planned = { ...intent, gross: Math.min(gross, remaining) };
        accepted.push(planned);
        if (intent.sleeve === "V12") { occupiedV12 += 1; v12Gross += planned.gross; }
        if (isStock) stockGross += planned.gross; else cryptoGross += planned.gross;
    }
    return { accepted, rejected, totalGross: cryptoGross + stockGross, cryptoGross, stockGross };
}
