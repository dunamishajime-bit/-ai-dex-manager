import { AsterV3Client, type AsterKline } from "@/lib/aster-v3-client";
import { resampleV12H1ToH2, type V12Bar } from "@/lib/v12-x1-all";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

function parse(row: AsterKline) {
    const ts = Number(row[0]); const close = Number(row[4]); const high = Number(row[2]); const low = Number(row[3]); const open = Number(row[1]); const volume = Number(row[5]); const closeTs = Number(row[6]);
    if (![ts, open, high, low, close, volume, closeTs].every(Number.isFinite) || closeTs >= Date.now() || ts % 3_600_000 !== 0 || !(open > 0 && high >= low && low > 0 && close > 0 && volume >= 0)) return null;
    return { ts, open, high, low, close, volume, closed: true } as const;
}

export interface V12AsterMarketDataProviderOptions { hourlyLimit?: number; now?: () => number; }

export function alignV12H2Bars(rows: readonly { symbol: string; bars: V12Bar[] }[]): Record<string, V12Bar[]> {
    const commonTimestamps = rows.reduce<number[] | undefined>((common, row) => {
        const timestamps = new Set(row.bars.map((bar) => bar.endTs));
        if (!common) return [...timestamps].sort((a, b) => a - b);
        return common.filter((timestamp) => timestamps.has(timestamp));
    }, undefined) || [];
    if (commonTimestamps.length < 80) {
        const counts = rows.map((row) => `${row.symbol}:${row.bars.length}`).join(",");
        throw new Error(`V12 universe common alignment insufficient: ${commonTimestamps.length} (${counts})`);
    }

    const result: Record<string, V12Bar[]> = {};
    for (const row of rows) {
        const byTimestamp = new Map(row.bars.map((bar) => [bar.endTs, bar] as const));
        const aligned = commonTimestamps.map((timestamp) => byTimestamp.get(timestamp)).filter((bar): bar is V12Bar => Boolean(bar));
        if (aligned.length !== commonTimestamps.length) throw new Error(`V12 universe alignment mismatch: ${row.symbol}`);
        result[row.symbol] = aligned;
    }
    return result;
}

export class V12AsterMarketDataProvider {
    private readonly limit: number;
    private readonly now: () => number;
    constructor(private readonly client: AsterV3Client, options: V12AsterMarketDataProviderOptions = {}) { this.limit = Math.max(200, Math.min(1500, options.hourlyLimit ?? 500)); this.now = options.now || Date.now; }
    async load(): Promise<Record<string, V12Bar[]>> {
        const rows = await Promise.all(V12_X1_ALL.universe.map(async (symbol) => ({ symbol, rows: await this.client.getKlines(`${symbol}USDT`, "1h", this.limit) })));
        const parsedRows = rows.map((row) => {
            const parsed = row.rows.map(parse).filter((value): value is NonNullable<ReturnType<typeof parse>> => Boolean(value)).filter((value) => value.ts + 3_600_000 <= this.now());
            const bars = resampleV12H1ToH2(parsed);
            if (bars.length < 80) throw new Error(`V12 hourly history insufficient for ${row.symbol}: ${bars.length}`);
            return { symbol: row.symbol, bars };
        });

        // Aster can return one symbol with a missing/late candle while the
        // others are complete. Comparing raw array lengths made that benign
        // data-quality blip trip the V12 kill switch. Align every symbol to
        // the intersection of its actual closed H2 timestamps instead. A
        // materially incomplete universe still fails closed below.
        return alignV12H2Bars(parsedRows);
    }
}
