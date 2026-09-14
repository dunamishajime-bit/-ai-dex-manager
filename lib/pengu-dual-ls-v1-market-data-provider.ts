import { AsterV3Client, type AsterKline } from "@/lib/aster-v3-client";
import type { DisDexV35Candle } from "@/lib/disdex-v35-signal-engine";
import type { PenguDualLsV1FundingPoint, PenguDualLsV1History } from "@/lib/pengu-dual-ls-v1";

interface FundingRow {
    fundingTime?: number | string;
    fundingRate?: number | string;
    time?: number | string;
    rate?: number | string;
}

export interface PenguDualLsV1MarketDataProviderOptions {
    hourlyLimit?: number;
    fundingLimit?: number;
    fundingBaseUrl?: string;
    cacheTtlMs?: number;
    fundingCacheTtlMs?: number;
    now?: () => number;
    fetchImpl?: typeof fetch;
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

export class PenguDualLsV1AsterMarketDataProvider {
    private readonly hourlyLimit: number;
    private readonly fundingLimit: number;
    private readonly fundingBaseUrl: string;
    private readonly cacheTtlMs: number;
    private readonly fundingCacheTtlMs: number;
    private readonly now: () => number;
    private readonly fetchImpl: typeof fetch;
    private cached?: { expiresAt: number; history: PenguDualLsV1History };
    private cachedFunding?: { expiresAt: number; points: PenguDualLsV1FundingPoint[] };

    constructor(
        private readonly client: AsterV3Client,
        options: PenguDualLsV1MarketDataProviderOptions = {},
    ) {
        this.hourlyLimit = Math.max(400, Math.min(1500, options.hourlyLimit ?? 1000));
        this.fundingLimit = Math.max(100, Math.min(1000, options.fundingLimit ?? 1000));
        this.fundingBaseUrl = String(options.fundingBaseUrl || "https://fapi.asterdex.com").replace(/\/+$/, "");
        this.cacheTtlMs = Math.max(30_000, options.cacheTtlMs ?? 5 * 60_000);
        this.fundingCacheTtlMs = Math.max(30_000, options.fundingCacheTtlMs ?? 5 * 60_000);
        this.now = options.now || Date.now;
        this.fetchImpl = options.fetchImpl || fetch;
    }

    private async loadFunding(force: boolean) {
        const now = this.now();
        if (!force && this.cachedFunding && this.cachedFunding.expiresAt > now) return this.cachedFunding.points;
        const url = new URL(`${this.fundingBaseUrl}/fapi/v3/fundingRate`);
        url.searchParams.set("symbol", "PENGUUSDT");
        url.searchParams.set("limit", String(this.fundingLimit));
        const response = await this.fetchImpl(url, {
            method: "GET",
            cache: "no-store",
            headers: { "user-agent": "DisDex-PENGU-Dual-LS-V1/1.0" },
        });
        if (!response.ok) throw new Error(`Aster V3 PENGU funding HTTP ${response.status}.`);
        const payload = await response.json() as unknown;
        if (!Array.isArray(payload)) throw new Error("Aster V3 PENGU funding payload is not an array.");
        const points = payload
            .map((row) => row as FundingRow)
            .map((row) => ({
                fundingTime: finite(row.fundingTime ?? row.time),
                fundingRate: finite(row.fundingRate ?? row.rate, Number.NaN),
            }))
            .filter((point) => point.fundingTime > 0 && Number.isFinite(point.fundingRate))
            .sort((left, right) => left.fundingTime - right.fundingTime)
            .filter((point, index, source) => index === 0 || point.fundingTime !== source[index - 1].fundingTime);
        this.cachedFunding = { expiresAt: now + this.fundingCacheTtlMs, points };
        return points;
    }

    async load(force = false): Promise<PenguDualLsV1History> {
        const now = this.now();
        if (!force && this.cached && this.cached.expiresAt > now) return this.cached.history;
        const [btcRows, penguRows, funding] = await Promise.all([
            this.client.getKlines("BTCUSDT", "1h", this.hourlyLimit),
            this.client.getKlines("PENGUUSDT", "1h", this.hourlyLimit),
            this.loadFunding(force),
        ]);
        const history: PenguDualLsV1History = {
            btc1h: completed(btcRows, now),
            pengu1h: completed(penguRows, now),
            penguFunding: funding,
        };
        if (history.btc1h.length < 400 || history.pengu1h.length < 400) {
            throw new Error(`PENGU Dual LS hourly history is insufficient: BTC=${history.btc1h.length}, PENGU=${history.pengu1h.length}.`);
        }
        this.cached = { expiresAt: now + this.cacheTtlMs, history };
        return history;
    }
}
