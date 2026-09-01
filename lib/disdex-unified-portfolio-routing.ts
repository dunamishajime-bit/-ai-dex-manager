import { STRICT_BT33404708902 } from "@/config/disdexStrictBt33404708902Runtime";
import { classifyAsterSymbol, type AsterPortfolioSleeve } from "@/lib/disdex-aster-portfolio-classifier";

export { markToMarketReducePosition, planStrictPortfolio } from "@/lib/disdex-strict-portfolio-planner";
export type { MarkToMarketReduction, StrictPortfolioIntent, StrictPortfolioPlan, StrictPortfolioPosition, StrictStrategy } from "@/lib/disdex-strict-portfolio-planner";

export const V12_PENGU_V52_PORTFOLIO_POLICY = Object.freeze({
    priority: "BASE_STRATEGIES_BEFORE_QUALITY102" as const,
    v12Multiplier: 1,
    v12MaximumGross: STRICT_BT33404708902.v12MaximumGross,
    penguMaximumGross: STRICT_BT33404708902.penguMaximumGross,
    cryptoGrossCap: STRICT_BT33404708902.cryptoGrossCap,
    stockGrossCap: STRICT_BT33404708902.stockGrossCap,
    totalGrossCap: STRICT_BT33404708902.totalGrossCap,
    maximumV12Positions: STRICT_BT33404708902.v12MaximumPositions,
    preemptions: false,
    forcedRebalance: false,
    topUp: false,
    v96Included: false,
});

export interface PortfolioIntent { sleeve: AsterPortfolioSleeve; symbol: string; side: "LONG" | "SHORT"; gross: number; notionalUsd: number; signalTs: number; }
export interface ActivePortfolioPosition { sleeve: AsterPortfolioSleeve; symbol: string; gross: number; }
export interface PortfolioPlan {
    accepted: PortfolioIntent[];
    rejected: Array<{ intent: PortfolioIntent; reason: string }>;
    totalGross: number;
    cryptoGross: number;
    stockGross: number;
    quality102LiveSelectorParity: false;
    quality102LiveBlockedFailClosed: true;
}

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
    let occupiedV12 = active.some((row) => row.sleeve === "V12");
    for (const intent of [...intents].sort((a, b) => sortPriority(a) - sortPriority(b) || a.symbol.localeCompare(b.symbol))) {
        const classification = classifyAsterSymbol(intent.symbol, intent.sleeve);
        if (!classification.tradable || classification.sleeve !== intent.sleeve) { rejected.push({ intent, reason: "UNKNOWN_OR_SLEEVE_MISMATCH" }); continue; }
        if (!(intent.gross > 0 && intent.notionalUsd >= 0 && Number.isFinite(intent.signalTs))) { rejected.push({ intent, reason: "INVALID_INTENT" }); continue; }
        if (intent.sleeve === "V12" && occupiedV12) { rejected.push({ intent, reason: "V12_SLOT_OCCUPIED_NO_PREEMPTION" }); continue; }
        const sleeveCap = intent.sleeve === "V12" ? V12_PENGU_V52_PORTFOLIO_POLICY.v12MaximumGross : intent.sleeve === "PENGU_DUAL_LS_V2" ? V12_PENGU_V52_PORTFOLIO_POLICY.penguMaximumGross : 1;
        const gross = Math.min(intent.gross, sleeveCap);
        const isStock = intent.sleeve === "V11_EQ" || intent.sleeve === "V50_POST_OPEN_BASIS";
        const remaining = Math.min(isStock ? V12_PENGU_V52_PORTFOLIO_POLICY.stockGrossCap - stockGross : V12_PENGU_V52_PORTFOLIO_POLICY.cryptoGrossCap - cryptoGross, V12_PENGU_V52_PORTFOLIO_POLICY.totalGrossCap - cryptoGross - stockGross);
        if (remaining <= 0 || gross <= 0) { rejected.push({ intent, reason: "CAPACITY_BLOCKED" }); continue; }
        const planned = { ...intent, gross: Math.min(gross, remaining) };
        accepted.push(planned);
        if (intent.sleeve === "V12") occupiedV12 = true;
        if (isStock) stockGross += planned.gross; else cryptoGross += planned.gross;
    }
    return { accepted, rejected, totalGross: cryptoGross + stockGross, cryptoGross, stockGross, quality102LiveSelectorParity: false, quality102LiveBlockedFailClosed: true };
}
