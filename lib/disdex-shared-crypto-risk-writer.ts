import { readFile } from "node:fs/promises";

import { AsterV3Client } from "@/lib/aster-v3-client";
import {
    buildSharedCryptoDailyRiskState,
    SHARED_CRYPTO_DAILY_RISK_SCHEMA,
    SHARED_CRYPTO_STRATEGIES,
    validateSharedCryptoDailyRisk,
    writeSharedCryptoDailyRisk,
    type SharedCryptoDailyRiskState,
} from "@/lib/disdex-shared-crypto-daily-risk";

export const SHARED_CRYPTO_SYMBOLS = new Set([
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT", "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
]);
function finite(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function utcStart(now: number) { const date = new Date(now); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }

async function priorTripForUtcDay(path: string, utcDay: string, now: number) {
    try {
        const raw = JSON.parse(await readFile(path, "utf8")) as Partial<SharedCryptoDailyRiskState>;
        if (raw.schema !== SHARED_CRYPTO_DAILY_RISK_SCHEMA || raw.accountScope !== "ASTER_FUTURES" || typeof raw.utcDay !== "string") {
            throw new Error("SHARED_CRYPTO_RISK_PRIOR_STATE_SCHEMA_INVALID");
        }
        if (raw.utcDay !== utcDay) return false;
        const validation = validateSharedCryptoDailyRisk(raw, now, Number.MAX_SAFE_INTEGER);
        if (validation.reason === "DAILY_LOSS_TRIPPED" && validation.state?.tripped) return true;
        if (!validation.ok) throw new Error(`SHARED_CRYPTO_RISK_PRIOR_STATE_INVALID:${validation.reason}`);
        return validation.state?.tripped === true;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return false;
        if (error instanceof SyntaxError) throw new Error("SHARED_CRYPTO_RISK_PRIOR_STATE_MALFORMED");
        throw error;
    }
}

/** Builds the fail-closed crypto daily-risk snapshot consumed by V12 and PENGU.
 * Only the frozen V12 universe + PENGU are counted. A same-day trip is sticky:
 * later profitable marks cannot automatically clear the 5% daily-loss latch. */
export async function refreshSharedCryptoDailyRisk(input: { client: AsterV3Client; path: string; now?: number; maximumLossPct?: number }): Promise<SharedCryptoDailyRiskState> {
    const now = input.now ?? Date.now();
    const startTime = utcStart(now);
    const utcDay = new Date(now).toISOString().slice(0, 10);
    const [balances, positions, income, priorTripped] = await Promise.all([
        input.client.getBalances(),
        input.client.getPositions(),
        input.client.getIncomeHistory({ startTime, endTime: now, limit: 1000 }),
        priorTripForUtcDay(input.path, utcDay, now),
    ]);
    if (income.length >= 1000) throw new Error("SHARED_CRYPTO_RISK_INCOME_PAGE_INCOMPLETE");
    const relevant = income.filter((row) => SHARED_CRYPTO_SYMBOLS.has(String(row.symbol || "").toUpperCase()));
    let realizedPnl = 0; let fees = 0; let funding = 0;
    for (const row of relevant) {
        const amount = finite(row.income);
        if (row.incomeType === "REALIZED_PNL") realizedPnl += amount;
        else if (row.incomeType === "COMMISSION") fees += amount;
        else if (row.incomeType === "FUNDING_FEE") funding += amount;
    }
    const unrealizedPnl = positions.filter((row) => SHARED_CRYPTO_SYMBOLS.has(row.symbol.toUpperCase())).reduce((sum, row) => sum + finite(row.unRealizedProfit ?? row.unrealizedProfit), 0);
    const walletBalance = balances.filter((row) => row.asset === "USDT" || row.asset === "USDC").reduce((sum, row) => sum + finite(row.balance), 0);
    const settledToday = realizedPnl + fees + funding;
    const referenceEquity = walletBalance - settledToday;
    if (!(referenceEquity > 0)) throw new Error("SHARED_CRYPTO_RISK_REFERENCE_EQUITY_INVALID");
    const netDailyPnl = settledToday + unrealizedPnl;
    const lossPct = Math.max(0, -netDailyPnl / referenceEquity * 100);
    const maximumLossPct = input.maximumLossPct ?? 5;
    const state = buildSharedCryptoDailyRiskState({
        accountScope: "ASTER_FUTURES",
        utcDay,
        strategyIds: [...SHARED_CRYPTO_STRATEGIES],
        lossPct,
        maximumLossPct,
        tripped: priorTripped || lossPct >= maximumLossPct,
        updatedAt: now,
        realizedPnl,
        unrealizedPnl,
        fees,
        funding,
        netDailyPnl,
        referenceEquity,
        sourceComplete: true,
    });
    await writeSharedCryptoDailyRisk(input.path, state);
    return state;
}
