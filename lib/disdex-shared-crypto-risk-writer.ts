import { AsterV3Client } from "@/lib/aster-v3-client";
import { buildSharedCryptoDailyRiskState, SHARED_CRYPTO_STRATEGIES, writeSharedCryptoDailyRisk, type SharedCryptoDailyRiskState } from "@/lib/disdex-shared-crypto-daily-risk";

export const SHARED_CRYPTO_SYMBOLS = new Set([
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT", "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
]);
function finite(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function utcStart(now: number) { const date = new Date(now); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }

/** Builds the single fail-closed crypto daily-risk snapshot consumed by both
 * V12 and PENGU. Only the frozen V12 universe + PENGU are counted; unrelated
 * stock/perp income cannot dilute or inflate the crypto sleeve's 5% gate. */
export async function refreshSharedCryptoDailyRisk(input: { client: AsterV3Client; path: string; now?: number; maximumLossPct?: number }): Promise<SharedCryptoDailyRiskState> {
    const now = input.now ?? Date.now();
    const startTime = utcStart(now);
    const [balances, positions, income] = await Promise.all([
        input.client.getBalances(),
        input.client.getPositions(),
        input.client.getIncomeHistory({ startTime, endTime: now, limit: 1000 }),
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
        utcDay: new Date(now).toISOString().slice(0, 10),
        strategyIds: [...SHARED_CRYPTO_STRATEGIES],
        lossPct,
        maximumLossPct,
        tripped: lossPct >= maximumLossPct,
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
