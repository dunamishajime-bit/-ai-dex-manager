import { AsterV3Client, type AsterKline } from "@/lib/aster-v3-client";
import { resampleV12H1ToH2, type V12Bar } from "@/lib/v12-x1-all";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

function parse(row: AsterKline) {
    const ts = Number(row[0]); const close = Number(row[4]); const high = Number(row[2]); const low = Number(row[3]); const open = Number(row[1]); const volume = Number(row[5]); const closeTs = Number(row[6]);
    if (![ts, open, high, low, close, volume, closeTs].every(Number.isFinite) || closeTs >= Date.now() || ts % 3_600_000 !== 0 || !(open > 0 && high >= low && low > 0 && close > 0 && volume >= 0)) return null;
    return { ts, open, high, low, close, volume, closed: true } as const;
}

export interface V12AsterMarketDataProviderOptions { hourlyLimit?: number; requestSpacingMs?: number; now?: () => number; }

export class V12AsterMarketDataProvider {
    private readonly limit: number;
    private readonly requestSpacingMs: number;
    private readonly now: () => number;
    constructor(private readonly client: AsterV3Client, options: V12AsterMarketDataProviderOptions = {}) { this.limit = Math.max(200, Math.min(1500, options.hourlyLimit ?? 500)); this.requestSpacingMs = Math.max(0, Math.min(10_000, options.requestSpacingMs ?? 100)); this.now = options.now || Date.now; }
    private async loadSymbol(symbol: string) {
        if (this.requestSpacingMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, this.requestSpacingMs));
        return this.client.getKlines(`${symbol}USDT`, "1h", this.limit);
    }
    async load(): Promise<Record<string, V12Bar[]>> {
        // Keep the 14-symbol historical burst below the venue IP limit. The
        // strategy and bar semantics are unchanged; only request scheduling is
        // serialized. Read-only 429/418 recovery is handled by AsterV3Client.
        const rows: { symbol: string; rows: AsterKline[] }[] = [];
        for (const symbol of V12_X1_ALL.universe) rows.push({ symbol, rows: await this.loadSymbol(symbol) });
        const parsedRows = rows.map((row) => {
            const parsed = row.rows.map(parse).filter((value): value is NonNullable<ReturnType<typeof parse>> => Boolean(value)).filter((value) => value.ts + 3_600_000 <= this.now());
            const bars = resampleV12H1ToH2(parsed);
            if (bars.length < 80) throw new Error(`V12 hourly history insufficient for ${row.symbol}: ${bars.length}`);
            return { symbol: row.symbol, bars };
        });

        // A venue can omit one completed candle for a single symbol while the
        // remaining symbols are current.  Equal array lengths are not a safe
        // alignment contract: intersect the completed H2 timestamps instead
        // of failing the whole V12 runner on a harmless per-symbol gap.
        const commonEndTs = parsedRows.reduce<Set<number> | undefined>((common, row) => {
            const timestamps = new Set(row.bars.map((bar) => bar.endTs));
            if (!common) return timestamps;
            return new Set([...common].filter((endTs) => timestamps.has(endTs)));
        }, undefined);
        if (!commonEndTs || commonEndTs.size < 80) throw new Error(`V12 common H2 history insufficient: ${commonEndTs?.size || 0}`);

        const result: Record<string, V12Bar[]> = {};
        for (const row of parsedRows) result[row.symbol] = row.bars.filter((bar) => commonEndTs.has(bar.endTs));
        return result;
    }
}
