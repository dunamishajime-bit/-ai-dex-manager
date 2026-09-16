export const SHARED_CRYPTO_DAILY_LOSS_PCT = 7.5 as const;

export function resolveSharedCryptoDailyLossPct(value?: string | number | null): number {
    if (value === undefined || value === null || String(value).trim() === "") {
        return SHARED_CRYPTO_DAILY_LOSS_PCT;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || Math.abs(parsed - SHARED_CRYPTO_DAILY_LOSS_PCT) > 1e-12) {
        throw new Error(`SHARED_CRYPTO_DAILY_LOSS_CONTRACT_MISMATCH:${String(value)}`);
    }
    return SHARED_CRYPTO_DAILY_LOSS_PCT;
}
