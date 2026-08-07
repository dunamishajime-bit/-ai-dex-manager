import { DISDEX_V97_CORE } from "@/config/disdexV97Runtime";
import { buildDisDexV97Candidates, type DisDexV97History, type DisDexV97Symbol } from "@/lib/disdex-v97-signal-engine";

const BAR_MS = 4 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const BASE_GROSS = 0.75;
const HOLD_BARS = 84 / 4;
const NORMAL_COST_BPS = 10;

export interface DisDexV97ControllerParameters {
    lookbackDays: number;
    weakReturnPct: number;
    weakGross: number;
    strongReturnPct: number;
    strongGross: number;
    ddTriggerPct: number;
    ddGross: number;
    recentTrades: number;
    minRecentEwmaPct: number;
    lossStreakLimit: number;
    lossStreakGross: number;
}

interface ShadowPosition { symbol: DisDexV97Symbol; entryTs: number; entryPrice: number; barsHeld: number; }
interface ShadowTrade { symbol: DisDexV97Symbol; entryTs: number; exitTs: number; returnValue: number; }
interface ShadowRow { ts: number; returnValue: number; gross: number; }

export interface DisDexV97ControllerDecision {
    targetGross: number;
    state: "NORMAL" | "DD" | "LOSS_STREAK" | "RECENT_WEAK" | "ROLLING_WEAK" | "STRONG";
    entryTs: number;
    trailingReturnPct: number;
    trailingDrawdownPct: number;
    recentSample: number;
    recentEwmaPct: number;
    recentLossStreak: number;
    recentProfitFactor?: number;
    reconstructedRows: number;
    reconstructedCompletedTrades: number;
}

function finite(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function compound(values: number[]) { let equity = 1; for (const value of values) equity *= Math.max(0.001, 1 + value); return equity - 1; }
function profitFactor(values: number[]) { const wins = values.filter((v) => v > 0).reduce((a, b) => a + b, 0); const losses = -values.filter((v) => v < 0).reduce((a, b) => a + b, 0); return losses > 1e-15 ? wins / losses : wins > 0 ? 999 : undefined; }
function indexAt(history: DisDexV97History, symbol: DisDexV97Symbol, ts: number) { const rows = history.bars4h[symbol]; for (let i = rows.length - 1; i >= 0; i -= 1) { if (rows[i].openTime === ts) return i; if (rows[i].openTime < ts) break; } return -1; }
function fundingInBar(history: DisDexV97History, symbol: DisDexV97Symbol, ts: number) { return history.funding[symbol].filter((row) => row.fundingTime >= ts && row.fundingTime < ts + BAR_MS).reduce((sum, row) => sum + finite(row.fundingRate), 0); }
function fundingBetween(history: DisDexV97History, symbol: DisDexV97Symbol, start: number, end: number) { return history.funding[symbol].filter((row) => row.fundingTime >= start && row.fundingTime < end).reduce((sum, row) => sum + finite(row.fundingRate), 0); }

export function reconstructDisDexV97FixedShadow(history: DisDexV97History) {
    const times = history.bars4h.BTCUSDT.map((row) => row.openTime).filter((ts) => DISDEX_V97_CORE.symbols.every((symbol) => indexAt(history, symbol, ts) >= 0));
    let position: ShadowPosition | undefined;
    let pending: { symbol: DisDexV97Symbol; entryTs: number } | undefined;
    let previousWeights = new Map<string, number>();
    const rows: ShadowRow[] = [];
    const trades: ShadowTrade[] = [];
    for (const ts of times) {
        if (!position && pending?.entryTs === ts) {
            const idx = indexAt(history, pending.symbol, ts);
            position = { symbol: pending.symbol, entryTs: ts, entryPrice: history.bars4h[pending.symbol][idx].open, barsHeld: 0 };
            pending = undefined;
        }
        const weights = new Map<string, number>();
        let value = 0;
        if (position) {
            weights.set(position.symbol, -BASE_GROSS);
            const idx = indexAt(history, position.symbol, ts);
            const bar = history.bars4h[position.symbol][idx];
            value += -BASE_GROSS * (bar.close / bar.open - 1);
            value += BASE_GROSS * fundingInBar(history, position.symbol, ts);
        }
        const symbols = new Set([...previousWeights.keys(), ...weights.keys()]);
        let turnover = 0;
        for (const symbol of symbols) turnover += Math.abs((weights.get(symbol) || 0) - (previousWeights.get(symbol) || 0));
        value -= turnover * NORMAL_COST_BPS / 10_000;
        rows.push({ ts, returnValue: value, gross: position ? BASE_GROSS : 0 });
        previousWeights = weights;
        if (position) {
            position.barsHeld += 1;
            if (position.barsHeld >= HOLD_BARS) {
                const exitTs = ts + BAR_MS;
                const exitIndex = indexAt(history, position.symbol, exitTs);
                if (exitIndex >= 0) {
                    const exitPrice = history.bars4h[position.symbol][exitIndex].open;
                    const funding = fundingBetween(history, position.symbol, position.entryTs, exitTs);
                    const tradeReturn = -BASE_GROSS * (exitPrice / position.entryPrice - 1) + BASE_GROSS * funding - 2 * BASE_GROSS * NORMAL_COST_BPS / 10_000;
                    trades.push({ symbol: position.symbol, entryTs: position.entryTs, exitTs, returnValue: tradeReturn });
                }
                position = undefined;
            }
        }
        if (!position && !pending) {
            const candidate = buildDisDexV97Candidates(history, ts)[0];
            if (candidate) pending = { symbol: candidate.symbol, entryTs: ts + BAR_MS };
        }
    }
    return { rows, trades };
}

function trailing(rows: ShadowRow[], entryTs: number, days: number) {
    const values = rows.filter((row) => row.ts >= entryTs - days * DAY_MS && row.ts < entryTs).map((row) => row.returnValue);
    if (!values.length) return { returnPct: 0, drawdownPct: 0 };
    let equity = 1, peak = 1, dd = 0;
    for (const value of values) { equity *= Math.max(0.001, 1 + value); peak = Math.max(peak, equity); dd = Math.min(dd, equity / peak - 1); }
    return { returnPct: (equity - 1) * 100, drawdownPct: dd * 100 };
}

function recentStats(trades: ShadowTrade[], entryTs: number, count: number) {
    const completed = trades.filter((trade) => trade.exitTs <= entryTs).slice(-count);
    if (!completed.length) return { sample: 0, ewmaPct: 0, lossStreak: 0, profitFactor: undefined as number | undefined };
    const values = completed.map((trade) => trade.returnValue); const weights = values.map((_, index) => index + 1); const weightTotal = weights.reduce((a, b) => a + b, 0);
    const ewmaPct = values.reduce((sum, value, index) => sum + value * weights[index], 0) / weightTotal * 100;
    let lossStreak = 0; for (let i = values.length - 1; i >= 0 && values[i] < 0; i -= 1) lossStreak += 1;
    return { sample: values.length, ewmaPct, lossStreak, profitFactor: profitFactor(values) };
}

export function resolveDisDexV97ControllerGross(history: DisDexV97History, entryTs: number, parameters: DisDexV97ControllerParameters): DisDexV97ControllerDecision {
    const reconstructed = reconstructDisDexV97FixedShadow(history);
    const roll = trailing(reconstructed.rows, entryTs, parameters.lookbackDays);
    const recent = recentStats(reconstructed.trades, entryTs, parameters.recentTrades);
    let targetGross = BASE_GROSS;
    let state: DisDexV97ControllerDecision["state"] = "NORMAL";
    if (roll.drawdownPct <= parameters.ddTriggerPct) { targetGross = parameters.ddGross; state = "DD"; }
    else if (recent.sample >= Math.min(3, parameters.recentTrades) && recent.lossStreak >= parameters.lossStreakLimit) { targetGross = parameters.lossStreakGross; state = "LOSS_STREAK"; }
    else if (recent.sample >= Math.min(3, parameters.recentTrades) && recent.ewmaPct < parameters.minRecentEwmaPct) { targetGross = Math.min(parameters.weakGross, BASE_GROSS); state = "RECENT_WEAK"; }
    else if (roll.returnPct <= parameters.weakReturnPct) { targetGross = parameters.weakGross; state = "ROLLING_WEAK"; }
    else if (roll.returnPct >= parameters.strongReturnPct && recent.ewmaPct > Math.max(0, parameters.minRecentEwmaPct)) { targetGross = parameters.strongGross; state = "STRONG"; }
    targetGross = Math.max(0, Math.min(DISDEX_V97_CORE.maximumAdaptiveGross, targetGross));
    return { targetGross, state, entryTs, trailingReturnPct: roll.returnPct, trailingDrawdownPct: roll.drawdownPct, recentSample: recent.sample, recentEwmaPct: recent.ewmaPct, recentLossStreak: recent.lossStreak, recentProfitFactor: recent.profitFactor, reconstructedRows: reconstructed.rows.length, reconstructedCompletedTrades: reconstructed.trades.length };
}
