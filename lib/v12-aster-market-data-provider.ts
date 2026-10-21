import { AsterV3Client, type AsterKline } from "@/lib/aster-v3-client";
import { resampleV12H1ToH2, type V12Bar } from "@/lib/v12-x1-all";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

function parse(row: AsterKline) {
    const ts = Number(row[0]); const close = Number(row[4]); const high = Number(row[2]); const low = Number(row[3]); const open = Number(row[1]); const volume = Number(row[5]); const closeTs = Number(row[6]);
    if (![ts, open, high, low, close, volume, closeTs].every(Number.isFinite) || closeTs >= Date.now() || ts % 3_600_000 !== 0 || !(open > 0 && high >= low && low > 0 && close > 0 && volume >= 0)) return null;
    return { ts, open, high, low, close, volume, closed: true } as const;
}

export interface V12AsterMarketDataProviderOptions { hourlyLimit?: number; now?: () => number; }

export class V12AsterMarketDataProvider {
    private readonly limit: number;
    private readonly now: () => number;
    constructor(private readonly client: AsterV3Client, options: V12AsterMarketDataProviderOptions = {}) { this.limit = Math.max(200, Math.min(1500, options.hourlyLimit ?? 500)); this.now = options.now || Date.now; }
    async load(): Promise<Record<string, V12Bar[]>> {
        const rows = await Promise.all(V12_X1_ALL.universe.map(async (symbol) => ({ symbol, rows: await this.client.getKlines(`${symbol}USDT`, "1h", this.limit) })));
        const result: Record<string, V12Bar[]> = {};
        let expectedLength: number | undefined;
        for (const row of rows) {
            const parsed = row.rows.map(parse).filter((value): value is NonNullable<ReturnType<typeof parse>> => Boolean(value)).filter((value) => value.ts + 3_600_000 <= this.now());
            const bars = resampleV12H1ToH2(parsed);
            if (bars.length < 80) throw new Error(`V12 hourly history insufficient for ${row.symbol}: ${bars.length}`);
            if (expectedLength === undefined) expectedLength = bars.length;
            if (bars.length !== expectedLength) throw new Error(`V12 universe alignment mismatch: ${row.symbol}`);
            result[row.symbol] = bars;
        }
        return result;
    }
}
