import { AsterV3Client, type AsterKline } from "@/lib/aster-v3-client";
import {
    type DisDexV35Candle,
    type DisDexV35CoreSymbol,
    type DisDexV35MarketHistory,
} from "@/lib/disdex-v35-signal-engine";

const CORE_SYMBOLS: DisDexV35CoreSymbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];

export interface DisDexV35MarketDataProviderOptions {
    coreLimit?: number;
    hourlyLimit?: number;
    cacheTtlMs?: number;
    now?: () => number;
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
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
        && value.high > 0
        && value.low > 0
        && value.close > 0
        ? value
        : null;
}

function completed(rows: AsterKline[], now: number) {
    return rows
        .map(candle)
        .filter((row): row is DisDexV35Candle => Boolean(row) && row!.closeTime < now)
        .sort((left, right) => left.openTime - right.openTime);
}

export class DisDexV35AsterMarketDataProvider {
    private readonly coreLimit: number;
    private readonly hourlyLimit: number;
    private readonly cacheTtlMs: number;
    private readonly now: () => number;
    private cached?: { expiresAt: number; history: DisDexV35MarketHistory };

    constructor(
        private readonly client: AsterV3Client,
        options: DisDexV35MarketDataProviderOptions = {},
    ) {
        this.coreLimit = Math.max(180, Math.min(1500, options.coreLimit ?? 400));
        this.hourlyLimit = Math.max(400, Math.min(1500, options.hourlyLimit ?? 1000));
        this.cacheTtlMs = Math.max(30_000, options.cacheTtlMs ?? 5 * 60_000);
        this.now = options.now || Date.now;
    }

    async load(force = false): Promise<DisDexV35MarketHistory> {
        const now = this.now();
        if (!force && this.cached && this.cached.expiresAt > now) return this.cached.history;
        const [btc12h, eth12h, bnb12h, sol12h, btc1h, pengu1h] = await Promise.all([
            this.client.getKlines("BTCUSDT", "12h", this.coreLimit),
            this.client.getKlines("ETHUSDT", "12h", this.coreLimit),
            this.client.getKlines("BNBUSDT", "12h", this.coreLimit),
            this.client.getKlines("SOLUSDT", "12h", this.coreLimit),
            this.client.getKlines("BTCUSDT", "1h", this.hourlyLimit),
            this.client.getKlines("PENGUUSDT", "1h", this.hourlyLimit),
        ]);
        const history: DisDexV35MarketHistory = {
            core12h: {
                BTCUSDT: completed(btc12h, now),
                ETHUSDT: completed(eth12h, now),
                BNBUSDT: completed(bnb12h, now),
                SOLUSDT: completed(sol12h, now),
            },
            btc1h: completed(btc1h, now),
            pengu1h: completed(pengu1h, now),
        };
        for (const symbol of CORE_SYMBOLS) {
            if (history.core12h[symbol].length < 140) {
                throw new Error(`V35 Aster ${symbol} 12h history is insufficient: ${history.core12h[symbol].length}.`);
            }
        }
        if (history.btc1h.length < 400 || history.pengu1h.length < 400) {
            throw new Error(`V35 hourly history is insufficient: BTC=${history.btc1h.length}, PENGU=${history.pengu1h.length}.`);
        }
        this.cached = { expiresAt: now + this.cacheTtlMs, history };
        return history;
    }
}
