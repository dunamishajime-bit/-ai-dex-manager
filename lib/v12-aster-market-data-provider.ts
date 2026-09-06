import { AsterV3Client, type AsterKline } from "@/lib/aster-v3-client";
import { resampleV12H1ToH2, type V12Bar } from "@/lib/v12-x1-all";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

function parse(row: AsterKline) {
    const ts = Number(row[0]); const close = Number(row[4]); const high = Number(row[2]); const low = Number(row[3]); const open = Number(row[1]); const volume = Number(row[5]); const closeTs = Number(row[6]);
    if (![ts, open, high, low, close, volume, closeTs].every(Number.isFinite) || closeTs >= Date.now() || ts % 3_600_000 !== 0 || !(open > 0 && high >= low && low > 0 && close > 0 && volume >= 0)) return null;
    return { ts, open, high, low, close, volume, closed: true } as const;
}

export interface V12AsterMarketDataProviderOptions {
    hourlyLimit?: number;
    now?: () => number;
    alignmentRetryAttempts?: number;
}

export class V12AsterMarketDataProvider {
    private readonly limit: number;
    private readonly now: () => number;
    private readonly alignmentRetryAttempts: number;
    constructor(private readonly client: AsterV3Client, options: V12AsterMarketDataProviderOptions = {}) {
        this.limit = Math.max(200, Math.min(1500, options.hourlyLimit ?? 500));
        this.now = options.now || Date.now;
        this.alignmentRetryAttempts = Math.max(1, Math.min(3, Math.floor(options.alignmentRetryAttempts ?? 3)));
    }
    private async loadAligned(): Promise<Record<string, V12Bar[]>> {
        const rows = await Promise.all(V12_X1_ALL.universe.map(async (symbol) => ({ symbol, rows: await this.client.getKlines(`${symbol}USDT`, "1h", this.limit) })));
        const parsedRows = rows.map((row) => {
            const parsed = row.rows.map(parse).filter((value): value is NonNullable<ReturnType<typeof parse>> => Boolean(value)).filter((value) => value.ts + 3_600_000 <= this.now());
            const bars = resampleV12H1ToH2(parsed);
            if (bars.length < 80) throw new Error(`V12 hourly history insufficient for ${row.symbol}: ${bars.length}`);
            return { symbol: row.symbol, bars };
        });

        // A rolling venue response may omit an older completed candle for only
        // one symbol. Use only the common, contiguous H2 suffix so every
        // strategy index refers to the same market timestamp. Never fill or
        // synthesize a missing candle; if the common suffix is too short or
        // latest timestamps disagree, fail closed and let the bounded retry
        // handle a transient response race.
        const latestEndTs = parsedRows[0]?.bars.at(-1)?.endTs;
        if (!Number.isFinite(latestEndTs) || parsedRows.some((row) => row.bars.at(-1)?.endTs !== latestEndTs)) {
            const mismatch = parsedRows.find((row) => row.bars.at(-1)?.endTs !== latestEndTs);
            throw new Error(`V12 universe alignment mismatch: ${mismatch?.symbol || V12_X1_ALL.universe[0]}`);
        }
        let commonEndTs = parsedRows[0]?.bars.map((bar) => bar.endTs) || [];
        for (const row of parsedRows.slice(1)) {
            const available = new Set(row.bars.map((bar) => bar.endTs));
            commonEndTs = commonEndTs.filter((endTs) => available.has(endTs));
        }
        commonEndTs.sort((a, b) => a - b);
        let suffixStart = Math.max(0, commonEndTs.length - 1);
        while (suffixStart > 0 && commonEndTs[suffixStart] - commonEndTs[suffixStart - 1] === 7_200_000) suffixStart -= 1;
        const alignedEndTs = commonEndTs.slice(suffixStart);
        if (alignedEndTs.length < 80) {
            const mismatch = parsedRows.find((row) => row.bars.length !== alignedEndTs.length);
            throw new Error(`V12 universe alignment mismatch: ${mismatch?.symbol || V12_X1_ALL.universe[0]}`);
        }
        const result: Record<string, V12Bar[]> = {};
        for (const row of parsedRows) {
            const byEndTs = new Map(row.bars.map((bar) => [bar.endTs, bar]));
            const aligned = alignedEndTs.map((endTs) => byEndTs.get(endTs));
            if (aligned.some((bar) => !bar)) throw new Error(`V12 universe alignment mismatch: ${row.symbol}`);
            result[row.symbol] = aligned as V12Bar[];
        }
        return result;
    }
    async load(): Promise<Record<string, V12Bar[]>> {
        let lastAlignmentError: unknown;
        for (let attempt = 0; attempt < this.alignmentRetryAttempts; attempt += 1) {
            try {
                return await this.loadAligned();
            } catch (error) {
                if (!(error instanceof Error) || !error.message.startsWith("V12 universe alignment mismatch:")) throw error;
                lastAlignmentError = error;
                if (attempt + 1 < this.alignmentRetryAttempts) await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
        throw lastAlignmentError instanceof Error ? lastAlignmentError : new Error("V12 universe alignment mismatch");
    }
}
