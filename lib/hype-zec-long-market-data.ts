import { AsterV3Client, type AsterKline } from "./aster-v3-client";
import type { HypeZecCandle } from "./hype-zec-long-sleeves";

export interface HypeZecLongMarketData {
  btc15m: HypeZecCandle[];
  btc1h: HypeZecCandle[];
  hype15m: HypeZecCandle[];
  hype1h: HypeZecCandle[];
  hype1m: HypeZecCandle[];
  zec15m: HypeZecCandle[];
  zec1m: HypeZecCandle[];
}

function parse(row: AsterKline): HypeZecCandle {
  const [openTime, open, high, low, close, volume] = row;
  const values = [openTime, open, high, low, close, volume].map(Number);
  if (!values.every(Number.isFinite) || values[0] <= 0 || values.slice(1).some((value) => value <= 0)) throw new Error("HYPE_ZEC_MARKET_DATA_ROW_INVALID");
  return { ts: values[0], open: values[1], high: values[2], low: values[3], close: values[4], volume: values[5] };
}

function normalize(rows: AsterKline[], symbol: string, intervalMs: number, now: number) {
  const parsed = rows.map(parse).sort((left, right) => left.ts - right.ts);
  const deduped: HypeZecCandle[] = [];
  for (const row of parsed) {
    if (row.ts + intervalMs > now) continue;
    const previous = deduped.at(-1);
    if (previous?.ts === row.ts) throw new Error(`HYPE_ZEC_MARKET_DATA_DUPLICATE:${symbol}:${row.ts}`);
    if (previous && row.ts - previous.ts > intervalMs * 2) throw new Error(`HYPE_ZEC_MARKET_DATA_GAP:${symbol}:${previous.ts}:${row.ts}`);
    deduped.push(row);
  }
  if (deduped.length < 3) throw new Error(`HYPE_ZEC_MARKET_DATA_INSUFFICIENT:${symbol}`);
  return deduped;
}

export class HypeZecAsterMarketDataProvider {
  constructor(private readonly client: AsterV3Client, private readonly options: { fifteenMinuteLimit?: number; oneHourLimit?: number; oneMinuteLimit?: number; now?: () => number; signalMode?: "LEGACY" | "TREND"; symbols?: ReadonlyArray<"HYPEUSDT" | "ZECUSDT"> } = {}) {}

  async load(): Promise<HypeZecLongMarketData> {
    const now = (this.options.now || Date.now)();
    const fifteenLimit = Math.max(80, Math.min(1500, this.options.fifteenMinuteLimit ?? 240));
    const oneHourLimit = Math.max(300, Math.min(1500, this.options.oneHourLimit ?? 360));
    const oneLimit = Math.max(30, Math.min(1500, this.options.oneMinuteLimit ?? 240));
    const signalMode = this.options.signalMode || "LEGACY";
    const symbols = this.options.symbols || ["HYPEUSDT", "ZECUSDT"];
    const needHype = symbols.includes("HYPEUSDT");
    const needZec = symbols.includes("ZECUSDT");
    const trend = signalMode === "TREND";
    const empty = async (): Promise<AsterKline[]> => [];
    const [btc15, btc1h, hype15, hype1h, hype1, zec15, zec1] = await Promise.all([
      trend ? empty() : this.client.getKlines("BTCUSDT", "15m", fifteenLimit),
      trend ? this.client.getKlines("BTCUSDT", "1h", oneHourLimit) : empty(),
      needHype && !trend ? this.client.getKlines("HYPEUSDT", "15m", fifteenLimit) : empty(),
      needHype && trend ? this.client.getKlines("HYPEUSDT", "1h", oneHourLimit) : empty(),
      needHype && !trend ? this.client.getKlines("HYPEUSDT", "1m", oneLimit) : empty(),
      needZec && !trend ? this.client.getKlines("ZECUSDT", "15m", fifteenLimit) : empty(),
      needZec && !trend ? this.client.getKlines("ZECUSDT", "1m", oneLimit) : empty(),
    ]);
    const optional = (rows: AsterKline[], symbol: string, intervalMs: number) => rows.length ? normalize(rows, symbol, intervalMs, now) : [];
    return {
      btc15m: optional(btc15, "BTCUSDT:15m", 15 * 60_000),
      btc1h: optional(btc1h, "BTCUSDT:1h", 60 * 60_000),
      hype15m: optional(hype15, "HYPEUSDT:15m", 15 * 60_000),
      hype1h: optional(hype1h, "HYPEUSDT:1h", 60 * 60_000),
      hype1m: optional(hype1, "HYPEUSDT:1m", 60_000),
      zec15m: optional(zec15, "ZECUSDT:15m", 15 * 60_000),
      zec1m: optional(zec1, "ZECUSDT:1m", 60_000),
    };
  }
}
