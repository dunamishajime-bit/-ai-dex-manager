import type { AsterV3Client } from "@/lib/aster-v3-client";
import { DisDexV35AsterMarketDataProvider, type DisDexV35MarketDataProviderOptions } from "@/lib/disdex-v35-market-data-provider";
import type { DisDexPenguFundingPoint, DisDexPenguV46History } from "@/lib/pengu-dual-engine-v46";

interface AsterFundingRateRow {
    symbol?: string;
    fundingTime?: number | string;
    fundingRate?: number | string;
    time?: number | string;
    rate?: number | string;
}

export interface DisDexV46MarketDataProviderOptions extends DisDexV35MarketDataProviderOptions {
    fundingLimit?: number;
    fundingCacheTtlMs?: number;
    fetchImpl?: typeof fetch;
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export class DisDexV46AsterMarketDataProvider {
    private readonly core: DisDexV35AsterMarketDataProvider;
    private readonly fundingLimit: number;
    private readonly fundingCacheTtlMs: number;
    private readonly fetchImpl: typeof fetch;
    private cachedFunding?: { expiresAt: number; points: DisDexPenguFundingPoint[] };

    constructor(
        private readonly client: AsterV3Client,
        options: DisDexV46MarketDataProviderOptions = {},
    ) {
        this.core = new DisDexV35AsterMarketDataProvider(client, options);
        this.fundingLimit = Math.max(100, Math.min(1000, options.fundingLimit ?? 1000));
        this.fundingCacheTtlMs = Math.max(30_000, options.fundingCacheTtlMs ?? 5 * 60_000);
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    private async loadFunding(force: boolean): Promise<DisDexPenguFundingPoint[]> {
        const now = Date.now();
        if (!force && this.cachedFunding && this.cachedFunding.expiresAt > now) return this.cachedFunding.points;
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 10_000);
        try {
            const url = new URL(`${this.client.baseUrl}/fapi/v3/fundingRate`);
            url.searchParams.set("symbol", "PENGUUSDT");
            url.searchParams.set("limit", String(this.fundingLimit));
            const response = await this.fetchImpl(url, {
                method: "GET",
                cache: "no-store",
                signal: abort.signal,
                headers: { "user-agent": "DisDex-PENGU-V46/1.0" },
            });
            if (!response.ok) throw new Error(`Aster funding history HTTP ${response.status}.`);
            const payload = await response.json() as unknown;
            if (!Array.isArray(payload)) throw new Error("Aster funding history payload is not an array.");
            const points = payload
                .map((row) => row as AsterFundingRateRow)
                .map((row) => ({
                    fundingTime: finite(row.fundingTime ?? row.time),
                    fundingRate: finite(row.fundingRate ?? row.rate, Number.NaN),
                }))
                .filter((point) => point.fundingTime > 0 && Number.isFinite(point.fundingRate))
                .sort((left, right) => left.fundingTime - right.fundingTime)
                .filter((point, index, source) => index === 0 || point.fundingTime !== source[index - 1].fundingTime);
            this.cachedFunding = { expiresAt: now + this.fundingCacheTtlMs, points };
            return points;
        } catch {
            // Long is fail-closed when this list is empty. The independently validated
            // breakdown Short remains available because it has no funding entry gate.
            this.cachedFunding = { expiresAt: now + Math.min(60_000, this.fundingCacheTtlMs), points: [] };
            return [];
        } finally {
            clearTimeout(timeout);
        }
    }

    async load(force = false): Promise<DisDexPenguV46History> {
        const [history, penguFunding] = await Promise.all([
            this.core.load(force),
            this.loadFunding(force),
        ]);
        return { ...history, penguFunding };
    }
}
