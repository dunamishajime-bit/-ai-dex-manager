import { refreshResidentProtectionObservation } from "./resident-stop-observation";
import { readFile } from "node:fs/promises";

import { QUALITY102_CAUSAL_V4_S34_MODEL } from "@/config/disdexQuality102CausalV4Model";
import { resolveSharedCryptoDailyLossPct } from "@/config/sharedCryptoRiskPolicy";
import { AsterV3Client } from "@/lib/aster-v3-client";
import { governorIncomeStartTime, refreshPortfolioDdGovernor, type PortfolioDdGovernorState } from "@/lib/disdex-portfolio-dd-governor";
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

export const QUALITY102_CAUSAL_V4_S34_SHARED_SYMBOLS = [...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map((row) => row.symbol))].sort();

export const SHARED_CRYPTO_SYMBOLS = new Set([
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT", "DOGEUSDT", "INJUSDT",
    "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT", "AAVEUSDT", "NEARUSDT", "FETUSDT", "PENGUUSDT",
    "HYPEUSDT", "DOTUSDT",
    ...QUALITY102_CAUSAL_V1_SHARED_SYMBOLS,
    ...QUALITY102_CAUSAL_V4_S34_SHARED_SYMBOLS,
]);

function sourceNumber(value: unknown, field: string): number {
    if ((typeof value !== "number" && typeof value !== "string")
        || (typeof value === "string" && (!value.trim()
            || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())))
        || !Number.isFinite(Number(value))) {
        throw new Error("SHARED_CRYPTO_RISK_SOURCE_NUMBER_INVALID:" + field);
    }
    return Number(value);
}

function utcStart(now: number): number {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

async function priorTripForUtcDay(path: string, utcDay: string): Promise<boolean> {
    try {
        const raw = JSON.parse(await readFile(path, "utf8")) as Partial<SharedCryptoDailyRiskState>;
        if (raw.schema !== SHARED_CRYPTO_DAILY_RISK_SCHEMA || raw.accountScope !== "ASTER_FUTURES" || typeof raw.utcDay !== "string"
            || typeof raw.tripped !== "boolean") {
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
    portfolioDdGovernorPath?: string;
    protectionObservationPath?: string;
    runtimeSha?: string;
}): Promise<SharedCryptoDailyRiskState & { portfolioDdGovernor?: PortfolioDdGovernorState }> {
    const now = input.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now <= 0) throw new Error("SHARED_CRYPTO_RISK_SOURCE_CLOCK_INVALID");
    const startTime = utcStart(now);
    const incomeStartTime = input.portfolioDdGovernorPath
        ? await governorIncomeStartTime(input.portfolioDdGovernorPath, now, startTime)
        : startTime;
    const utcDay = new Date(now).toISOString().slice(0, 10);
    const [balances, positions, income, priorTripped] = await Promise.all([
        input.client.getBalances(),
        input.client.getPositions(),
        input.client.getIncomeHistory({ startTime: incomeStartTime, endTime: now, limit: 1000 }),
        priorTripForUtcDay(input.path, utcDay),
    ]);
    if (![balances, positions, income].every(Array.isArray)) throw new Error("SHARED_CRYPTO_RISK_SOURCE_ARRAY_INVALID");
    if (income.length >= 1000) throw new Error("SHARED_CRYPTO_RISK_INCOME_PAGE_INCOMPLETE");

    // Validate before filtering: invalid timestamps or missing symbols must
    // never silently remove a real loss from a sourceComplete snapshot.
    for (const row of income) {
        if (!row || typeof row.symbol !== "string") throw new Error("SHARED_CRYPTO_RISK_SOURCE_INCOME_SYMBOL_INVALID");
        const at = sourceNumber(row.time, "income.time");
        if (!Number.isSafeInteger(at) || at <= 0 || at > now) throw new Error("SHARED_CRYPTO_RISK_SOURCE_INCOME_TIME_INVALID");
    }
    for (const row of positions) {
        if (!row || typeof row.symbol !== "string" || !row.symbol) throw new Error("SHARED_CRYPTO_RISK_SOURCE_POSITION_SYMBOL_INVALID");
    }
    for (const row of balances) {
        if (!row || typeof row.asset !== "string" || !row.asset) throw new Error("SHARED_CRYPTO_RISK_SOURCE_BALANCE_ASSET_INVALID");
    }

    const relevant = income.filter((row) => Number(row.time) >= startTime && SHARED_CRYPTO_SYMBOLS.has(String(row.symbol || "").toUpperCase()));
    let realizedPnl = 0;
    let fees = 0;
    let funding = 0;
    for (const row of relevant) {
        const amount = sourceNumber(row.income, "income");
        if (row.incomeType === "REALIZED_PNL") realizedPnl += amount;
        else if (row.incomeType === "COMMISSION") fees += amount;
        else if (row.incomeType === "FUNDING_FEE") funding += amount;
    }

    const unrealizedPnl = positions
        .filter((row) => SHARED_CRYPTO_SYMBOLS.has(String(row.symbol || "").toUpperCase()))
        .reduce((sum, row) => sum + sourceNumber(row.unRealizedProfit ?? row.unrealizedProfit, "unrealizedPnl"), 0);
    const walletBalance = balances
        .filter((row) => /^(USDT|USDC)$/i.test(String(row.asset || "")))
        .reduce((sum, row) => sum + sourceNumber(row.balance, "balance"), 0);
    const settledToday = realizedPnl + fees + funding;
    const referenceEquity = walletBalance - settledToday;
    if (!(referenceEquity > 0)) throw new Error("SHARED_CRYPTO_RISK_REFERENCE_EQUITY_INVALID");
    const netDailyPnl = settledToday + unrealizedPnl;
    const lossPct = Math.max(0, (-netDailyPnl / referenceEquity) * 100);
    const maximumLossPct = resolveSharedCryptoDailyLossPct(input.maximumLossPct);

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
    let portfolioDdGovernor: PortfolioDdGovernorState | undefined;
    if (input.portfolioDdGovernorPath) {
        try {
            portfolioDdGovernor = await refreshPortfolioDdGovernor({
                path: input.portfolioDdGovernorPath,
                now,
                walletBalanceUsd: walletBalance,
                income,
            });
        } catch {
            // Daily risk remains independent. Q102 boost fails closed to family gross
            // when the governor state is missing or stale.
        }
    }
    if (input.protectionObservationPath && input.runtimeSha) {
        // Read-only projection failure never changes the already written daily-risk latch.
        await refreshResidentProtectionObservation(input.client, positions, input.protectionObservationPath, input.runtimeSha).catch(error => console.warn("RESIDENT_STOP_OBSERVATION_WRITE_FAILED", error instanceof Error ? error.message : String(error)));
    }
    return Object.assign(state, { portfolioDdGovernor });
}
