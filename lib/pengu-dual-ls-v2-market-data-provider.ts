import { AsterV3Client, type AsterKline } from "@/lib/aster-v3-client";
import type { DisDexV35Candle } from "@/lib/disdex-v35-signal-engine";
import type { PenguDualLsV2History } from "@/lib/pengu-dual-ls-v2";

export interface PenguDualLsV2MarketDataProviderOptions {
    hourlyLimit?: number;
    cacheTtlMs?: number;
    now?: () => number;
}

function finite(value: unknown, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function candle(row: AsterKline): DisDexV35Candle | null {
    const value: DisDexV35Candle = {
        openTime: finite(row[0]),
        open: finite(row[1]),
        high: finite(row[2]),
        low: finite(row[3]),
        close: finite(row[4]),
        volume: finite(row[5]),
        closeTime: finite(row[6]),
    };
    return value.openTime > 0
        && value.closeTime > value.openTime
        && value.open > 0
        && value.high >= value.low
        && value.low > 0
        && value.close > 0
        && value.volume >= 0
        ? value
        : null;
}

function completed(rows: AsterKline[], now: number) {
    return rows
        .map(candle)
        .filter((row): row is DisDexV35Candle => Boolean(row) && row!.closeTime < now)
        .sort((left, right) => left.openTime - right.openTime)
        .filter((row, index, source) => index === 0 || row.openTime !== source[index - 1].openTime);
}

export class PenguDualLsV2AsterMarketDataProvider {
    private readonly hourlyLimit: number;
    private readonly cacheTtlMs: number;
    private readonly now: () => number;
    private cached?: { expiresAt: number; history: PenguDualLsV2History };

    constructor(
        private readonly client: AsterV3Client,
        options: PenguDualLsV2MarketDataProviderOptions = {},
    ) {
        this.hourlyLimit = Math.max(400, Math.min(1500, options.hourlyLimit ?? 1000));
        this.cacheTtlMs = Math.max(30_000, options.cacheTtlMs ?? 5 * 60_000);
        this.now = options.now || Date.now;
    }

    async load(force = false): Promise<PenguDualLsV2History> {
        const now = this.now();
        if (!force && this.cached && this.cached.expiresAt > now) return this.cached.history;
        const [btcRows, penguRows] = await Promise.all([
            this.client.getKlines("BTCUSDT", "1h", this.hourlyLimit),
            this.client.getKlines("PENGUUSDT", "1h", this.hourlyLimit),
        ]);
        const history: PenguDualLsV2History = {
            btc1h: completed(btcRows, now),
            pengu1h: completed(penguRows, now),
            // V2's frozen specification does not consume funding. Avoid an
            // unrelated endpoint dependency that could alter signal parity.
            penguFunding: [],
        };
        if (history.btc1h.length < 400 || history.pengu1h.length < 400) {
            throw new Error(`PENGU Dual LS hourly history is insufficient: BTC=${history.btc1h.length}, PENGU=${history.pengu1h.length}.`);
        }
        this.cached = { expiresAt: now + this.cacheTtlMs, history };
        return history;
    }
}
