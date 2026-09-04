import { readFile } from "node:fs/promises";

import { AsterV3Client } from "@/lib/aster-v3-client";
import {
    buildSharedCryptoDailyRiskState,
    SHARED_CRYPTO_DAILY_RISK_SCHEMA,
    SHARED_CRYPTO_STRATEGIES,
    writeSharedCryptoDailyRisk,
    type SharedCryptoDailyRiskState,
} from "@/lib/disdex-shared-crypto-daily-risk";

export const QUALITY102_CAUSAL_V1_SHARED_SYMBOLS = [
    "SUIUSDT", "SEIUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "WIFUSDT", "TIAUSDT",
    "JUPUSDT", "ENAUSDT", "ONDOUSDT", "FILUSDT", "RENDERUSDT", "TAOUSDT", "TRXUSDT",
] as const;

export const SHARED_CRYPTO_SYMBOLS = new Set([
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT", "INJUSDT",
    "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT", "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
    ...QUALITY102_CAUSAL_V1_SHARED_SYMBOLS,
]);

function finite(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function utcStart(now: number): number {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

async function priorTripForUtcDay(path: string, utcDay: string): Promise<boolean> {
    try {
        const raw = JSON.parse(await readFile(path, "utf8")) as Partial<SharedCryptoDailyRiskState>;
        if (raw.schema !== SHARED_CRYPTO_DAILY_RISK_SCHEMA || raw.accountScope !== "ASTER_FUTURES" || typeof raw.utcDay !== "string") {
            throw new Error("SHARED_CRYPTO_RISK_PRIOR_STATE_SCHEMA_INVALID");
        }
        if (raw.utcDay !== utcDay) return false;
        // Read only the latch during migration. The next successful refresh rewrites the
        // complete Q102-aware schema, while a same-day trip remains sticky.
        return raw.tripped === true;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        if (code === "ENOENT") return false;
        if (error instanceof SyntaxError) throw new Error("SHARED_CRYPTO_RISK_PRIOR_STATE_MALFORMED");
        throw error;
    }
}

/** Builds the single fail-closed daily-risk snapshot consumed by all crypto
 * sleeves. Q102 symbols are included so its realized/unrealized losses cannot
 * bypass the shared daily-loss latch. */
export async function refreshSharedCryptoDailyRisk(input: {
    client: AsterV3Client;
    path: string;
    now?: number;
    maximumLossPct?: number;
}): Promise<SharedCryptoDailyRiskState> {
    const now = input.now ?? Date.now();
    const startTime = utcStart(now);
    const utcDay = new Date(now).toISOString().slice(0, 10);
    const [balances, positions, income, priorTripped] = await Promise.all([
        input.client.getBalances(),
        input.client.getPositions(),
        input.client.getIncomeHistory({ startTime, endTime: now, limit: 1000 }),
        priorTripForUtcDay(input.path, utcDay),
    ]);
    if (income.length >= 1000) throw new Error("SHARED_CRYPTO_RISK_INCOME_PAGE_INCOMPLETE");

    const relevant = income.filter((row) => SHARED_CRYPTO_SYMBOLS.has(String(row.symbol || "").toUpperCase()));
    let realizedPnl = 0;
    let fees = 0;
    let funding = 0;
    for (const row of relevant) {
        const amount = finite(row.income);
        if (row.incomeType === "REALIZED_PNL") realizedPnl += amount;
        else if (row.incomeType === "COMMISSION") fees += amount;
        else if (row.incomeType === "FUNDING_FEE") funding += amount;
    }

    const unrealizedPnl = positions
        .filter((row) => SHARED_CRYPTO_SYMBOLS.has(String(row.symbol || "").toUpperCase()))
        .reduce((sum, row) => sum + finite(row.unRealizedProfit ?? row.unrealizedProfit), 0);
    const walletBalance = balances
        .filter((row) => /^(USDT|USDC)$/i.test(String(row.asset || "")))
        .reduce((sum, row) => sum + finite(row.balance), 0);
    const settledToday = realizedPnl + fees + funding;
    const referenceEquity = walletBalance - settledToday;
    if (!(referenceEquity > 0)) throw new Error("SHARED_CRYPTO_RISK_REFERENCE_EQUITY_INVALID");
    const netDailyPnl = settledToday + unrealizedPnl;
    const lossPct = Math.max(0, (-netDailyPnl / referenceEquity) * 100);
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
