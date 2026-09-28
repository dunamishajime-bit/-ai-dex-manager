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
  // A no-trade candle may legitimately report zero volume.  Price and time
  // fields must remain strictly positive, while volume is only invalid when
  // negative or non-finite.
  if (!values.every(Number.isFinite) || values[0] <= 0 || values.slice(1, 5).some((value) => value <= 0) || values[5] < 0) {
    throw new Error("HYPE_ZEC_MARKET_DATA_ROW_INVALID");
  }
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
  constructor(private readonly client: AsterV3Client, private readonly options: {
    fifteenMinuteLimit?: number;
    oneHourLimit?: number;
    oneMinuteLimit?: number;
    now?: () => number;
    symbols?: ReadonlyArray<"HYPEUSDT" | "ZECUSDT">;
  } = {}) {}

  async load(): Promise<HypeZecLongMarketData> {
    const now = (this.options.now || Date.now)();
    const fifteenLimit = Math.max(80, Math.min(1500, this.options.fifteenMinuteLimit ?? 240));
    const oneHourLimit = Math.max(300, Math.min(1500, this.options.oneHourLimit ?? 360));
    const oneLimit = Math.max(30, Math.min(1500, this.options.oneMinuteLimit ?? 240));
    const configuredSymbols = this.options.symbols ?? ["HYPEUSDT", "ZECUSDT"];
    const needsHype = configuredSymbols.includes("HYPEUSDT");
    const needsZec = configuredSymbols.includes("ZECUSDT");
    const [btc15, btc1h] = await Promise.all([
      this.client.getKlines("BTCUSDT", "15m", fifteenLimit),
      this.client.getKlines("BTCUSDT", "1h", oneHourLimit),
    ]);
    const [hype15, hype1h, hype1] = needsHype
      ? await Promise.all([
        this.client.getKlines("HYPEUSDT", "15m", fifteenLimit),
        this.client.getKlines("HYPEUSDT", "1h", oneHourLimit),
        this.client.getKlines("HYPEUSDT", "1m", oneLimit),
      ])
      : [[], [], []] as [AsterKline[], AsterKline[], AsterKline[]];
    const [zec15, zec1] = needsZec
      ? await Promise.all([
        this.client.getKlines("ZECUSDT", "15m", fifteenLimit),
        this.client.getKlines("ZECUSDT", "1m", oneLimit),
      ])
      : [[], []] as [AsterKline[], AsterKline[]];
    return {
      btc15m: normalize(btc15, "BTCUSDT:15m", 15 * 60_000, now),
      btc1h: normalize(btc1h, "BTCUSDT:1h", 60 * 60_000, now),
      hype15m: needsHype ? normalize(hype15, "HYPEUSDT:15m", 15 * 60_000, now) : [],
      hype1h: needsHype ? normalize(hype1h, "HYPEUSDT:1h", 60 * 60_000, now) : [],
      hype1m: needsHype ? normalize(hype1, "HYPEUSDT:1m", 60_000, now) : [],
      zec15m: needsZec ? normalize(zec15, "ZECUSDT:15m", 15 * 60_000, now) : [],
      zec1m: needsZec ? normalize(zec1, "ZECUSDT:1m", 60_000, now) : [],
    };
  }
}
