import type { AsterKline, AsterV3Client } from "./aster-v3-client";
import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";
import type { IdleH1Candle } from "./idle-priority-short-signal";

const HOUR = 3_600_000;
const MIN_BARS = 90;

function finitePositive(value: unknown, code: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(code);
  return n;
}

export function parseIdlePriorityH1(row: AsterKline): IdleH1Candle {
  const ts = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const quoteVolume = Number(row[7]);
  if (!Number.isFinite(ts) || ts <= 0 || ts % HOUR !== 0) throw new Error("IDLE_MARKET_DATA_TS_INVALID");
  if (![open, high, low, close].every((x) => Number.isFinite(x) && x > 0) || high < low) throw new Error("IDLE_MARKET_DATA_OHLC_INVALID");
  if (!Number.isFinite(quoteVolume) || quoteVolume < 0) throw new Error("IDLE_MARKET_DATA_QUOTE_VOLUME_INVALID");
  return { ts, open, high, low, close, quoteVolume };
}

export function normalizeIdlePriorityH1(rows: readonly AsterKline[], symbol: string, now = Date.now()) {
  const decisionTs = Math.floor(now / HOUR) * HOUR;
  const latestAllowedOpen = decisionTs - HOUR;
  const parsed = rows
    .map(parseIdlePriorityH1)
    .filter((row) => row.ts <= latestAllowedOpen)
    .sort((a, b) => a.ts - b.ts);
  const out: IdleH1Candle[] = [];
  for (const row of parsed) {
    const previous = out.at(-1);
    if (previous?.ts === row.ts) throw new Error(`IDLE_MARKET_DATA_DUPLICATE:${symbol}:${row.ts}`);
    if (previous && row.ts - previous.ts !== HOUR) throw new Error(`IDLE_MARKET_DATA_GAP:${symbol}:${previous.ts}:${row.ts}`);
    out.push(row);
  }
  if (out.length < MIN_BARS) throw new Error(`IDLE_MARKET_DATA_INSUFFICIENT:${symbol}:${out.length}`);
  if (out.at(-1)?.ts !== latestAllowedOpen) throw new Error(`IDLE_MARKET_DATA_STALE:${symbol}:${out.at(-1)?.ts || 0}:${latestAllowedOpen}`);
  return { decisionTs, rows: out };
}

export type IdlePriorityMarketSnapshot = {
  decisionTs: number;
  btc: IdleH1Candle[];
  symbols: Record<IdlePrioritySymbol, IdleH1Candle[]>;
};

export class IdlePriorityAsterMarketDataProvider {
  constructor(
    private readonly client: AsterV3Client,
    private readonly options: { limit?: number; now?: () => number } = {},
  ) {}

  async load(): Promise<IdlePriorityMarketSnapshot> {
    const now = (this.options.now || Date.now)();
    const limit = Math.max(MIN_BARS + 5, Math.min(1500, this.options.limit ?? 160));
    const symbols = Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes) as IdlePrioritySymbol[];
    const requested = ["BTCUSDT", ...symbols];
    const result = await Promise.all(requested.map((symbol) => this.client.getKlines(symbol, "1h", limit)));
    const btc = normalizeIdlePriorityH1(result[0], "BTCUSDT", now);
    const mapped = {} as Record<IdlePrioritySymbol, IdleH1Candle[]>;
    for (let i = 0; i < symbols.length; i += 1) {
      const normalized = normalizeIdlePriorityH1(result[i + 1], symbols[i], now);
      if (normalized.decisionTs !== btc.decisionTs) throw new Error("IDLE_MARKET_DATA_DECISION_TS_MISMATCH");
      mapped[symbols[i]] = normalized.rows;
    }
    // Force an explicit positive close at the signal boundary before signal math.
    finitePositive(btc.rows.at(-1)?.close, "IDLE_MARKET_DATA_BTC_CLOSE_INVALID");
    return { decisionTs: btc.decisionTs, btc: btc.rows, symbols: mapped };
  }
}
