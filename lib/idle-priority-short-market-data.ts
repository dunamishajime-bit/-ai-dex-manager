import type { AsterKline, AsterV3Client } from "./aster-v3-client";
import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";
import { IDLE_RESIDUAL_LONG_POLICY, type IdleResidualLongSymbol } from "../config/idleResidualLongPolicy";
import type { IdleH1Candle } from "./idle-priority-short-signal";
import type { ConfirmedFiveMinuteBar } from "./disdex-exit-overlay-contract";
import { ADOPTED_FIVE_MINUTE_MS, type ClosedFiveMinuteClose } from "./hype-render-tao-adopted-policy";
import { normalizeAdoptedFiveMinuteCloses } from "./hype-render-tao-adopted-market-data";

const HOUR = 3_600_000;
const FIVE_MINUTE = 5 * 60_000;
const MIN_BARS = 90;

type H1Loader = () => Promise<AsterKline[]>;
class CompletedH1SnapshotCache {
  private readonly entries = new Map<string, { boundary: number; rows: AsterKline[] }>();
  private readonly inFlight = new Map<string, Promise<AsterKline[]>>();

  async load(symbol: string, limit: number, now: number, loader: H1Loader) {
    const boundary = Math.floor(now / HOUR) * HOUR;
    const key = `${symbol}|1h|${limit}`;
    const cached = this.entries.get(key);
    if (cached?.boundary === boundary) return cached.rows;
    const requestKey = `${key}|${boundary}`;
    const pending = this.inFlight.get(requestKey);
    if (pending) return pending;
    const request = loader().then((rows) => {
      const current = this.entries.get(key);
      // A slower request from an older candle must never replace a newer
      // completed snapshot after a rollover.
      if (!current || boundary >= current.boundary) this.entries.set(key, { boundary, rows });
      return rows;
    }).finally(() => this.inFlight.delete(requestKey));
    this.inFlight.set(requestKey, request);
    return request;
  }

  invalidate(symbol: string, limit: number) {
    this.entries.delete(`${symbol}|1h|${limit}`);
  }

  clear() {
    this.entries.clear();
  }
}

function sleep(ms: number) {
  return ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

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
  residualSymbols: Record<IdleResidualLongSymbol, IdleH1Candle[]>;
};

export type AdoptedIdleFiveMinuteHistory =
  | { decisionTs: number; tao: ClosedFiveMinuteClose[] }
  | { decisionTs: number; btc: ClosedFiveMinuteClose[]; render: ClosedFiveMinuteClose[] };

export class IdlePriorityAsterMarketDataProvider {
  private readonly cache = new CompletedH1SnapshotCache();
  private readonly adoptedM5Cache = new Map<string, { boundary: number; value: AdoptedIdleFiveMinuteHistory }>();
  private readonly adoptedM5InFlight = new Map<string, Promise<AdoptedIdleFiveMinuteHistory>>();
  private readonly requestSpacingMs: number;
  constructor(
    private readonly client: AsterV3Client,
    private readonly options: { limit?: number; now?: () => number; requestSpacingMs?: number } = {},
  ) {
    this.requestSpacingMs = Math.max(0, Math.min(5_000, Math.floor(options.requestSpacingMs ?? 0)));
  }

  async load(): Promise<IdlePriorityMarketSnapshot> {
    const now = (this.options.now || Date.now)();
    const limit = Math.max(MIN_BARS + 5, Math.min(1500, this.options.limit ?? 160));
    const symbols = Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes) as IdlePrioritySymbol[];
    const residualSymbols = Object.keys(IDLE_RESIDUAL_LONG_POLICY.routes) as IdleResidualLongSymbol[];
    const requested = ["BTCUSDT", ...symbols, ...residualSymbols];
    const result: AsterKline[][] = [];
    for (const symbol of requested) {
      result.push(await this.cache.load(symbol, limit, now, () => this.client.getKlines(symbol, "1h", limit)));
      await sleep(this.requestSpacingMs);
    }
    let btc;
    try {
      btc = normalizeIdlePriorityH1(result[0], "BTCUSDT", now);
    } catch (error) {
      this.cache.clear();
      throw error;
    }
    const mapped = {} as Record<IdlePrioritySymbol, IdleH1Candle[]>;
    for (let i = 0; i < symbols.length; i += 1) {
      let normalized;
      try {
        normalized = normalizeIdlePriorityH1(result[i + 1], symbols[i], now);
      } catch (error) {
        this.cache.clear();
        throw error;
      }
      if (normalized.decisionTs !== btc.decisionTs) throw new Error("IDLE_MARKET_DATA_DECISION_TS_MISMATCH");
      mapped[symbols[i]] = normalized.rows;
    }
    const residualMapped = {} as Record<IdleResidualLongSymbol, IdleH1Candle[]>;
    for (let i = 0; i < residualSymbols.length; i += 1) {
      let normalized;
      try {
        normalized = normalizeIdlePriorityH1(result[1 + symbols.length + i], residualSymbols[i], now);
      } catch (error) {
        this.cache.clear();
        throw error;
      }
      if (normalized.decisionTs !== btc.decisionTs) throw new Error("IDLE_RESIDUAL_MARKET_DATA_DECISION_TS_MISMATCH");
      residualMapped[residualSymbols[i]] = normalized.rows;
    }
    // Force an explicit positive close at the signal boundary before signal math.
    finitePositive(btc.rows.at(-1)?.close, "IDLE_MARKET_DATA_BTC_CLOSE_INVALID");
    return { decisionTs: btc.decisionTs, btc: btc.rows, symbols: mapped, residualSymbols: residualMapped };
  }

  /** Read the latest completed Aster 5m candle only; never use the forming bar. */
  async loadFiveMinute(symbol: IdlePrioritySymbol): Promise<ConfirmedFiveMinuteBar> {
    const now = (this.options.now || Date.now)();
    const currentOpen = Math.floor(now / FIVE_MINUTE) * FIVE_MINUTE;
    const latestClosedOpen = currentOpen - FIVE_MINUTE;
    const rows = await this.client.getKlines(symbol, "5m", 3, {
      startTime: latestClosedOpen - 2 * FIVE_MINUTE,
      endTime: currentOpen + 1,
    });
    const row = rows.find((candidate) => Number(candidate[0]) === latestClosedOpen && Number(candidate[6]) < now);
    if (!row) throw new Error(`IDLE_5M_CANDLE_UNAVAILABLE:${symbol}:${latestClosedOpen}`);
    const result: ConfirmedFiveMinuteBar = {
      timestampMs: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
    };
    if (!Object.values(result).every((value) => Number.isFinite(value) && value > 0)
      || result.high < Math.max(result.open, result.close)
      || result.low > Math.min(result.open, result.close)
      || result.high < result.low) {
      throw new Error(`IDLE_5M_CANDLE_INVALID:${symbol}:${latestClosedOpen}`);
    }
    return result;
  }

  async loadAdoptedFiveMinuteHistory(symbol: "TAOUSDT" | "RENDERUSDT"): Promise<AdoptedIdleFiveMinuteHistory> {
    const now = (this.options.now || Date.now)();
    const decisionTs = Math.floor(now / ADOPTED_FIVE_MINUTE_MS) * ADOPTED_FIVE_MINUTE_MS;
    const cached = this.adoptedM5Cache.get(symbol);
    if (cached?.boundary === decisionTs) return cached.value;
    const requestKey = `${symbol}|${decisionTs}`;
    const pending = this.adoptedM5InFlight.get(requestKey);
    if (pending) return pending;
    const request = (async () => {
      if (symbol === "TAOUSDT") {
        const rows = await this.client.getKlines(symbol, "5m", 32);
        const value: AdoptedIdleFiveMinuteHistory = {
          decisionTs,
          tao: normalizeAdoptedFiveMinuteCloses(rows, "TAO", decisionTs, 12),
        };
        this.adoptedM5Cache.set(symbol, { boundary: decisionTs, value });
        return value;
      }
      const btcRows = await this.client.getKlines("BTCUSDT", "5m", 100);
      await sleep(this.requestSpacingMs);
      const renderRows = await this.client.getKlines(symbol, "5m", 100);
      const value: AdoptedIdleFiveMinuteHistory = {
        decisionTs,
        btc: normalizeAdoptedFiveMinuteCloses(btcRows, "RENDER_BTC", decisionTs, 72),
        render: normalizeAdoptedFiveMinuteCloses(renderRows, "RENDER", decisionTs, 72),
      };
      this.adoptedM5Cache.set(symbol, { boundary: decisionTs, value });
      return value;
    })().finally(() => this.adoptedM5InFlight.delete(requestKey));
    this.adoptedM5InFlight.set(requestKey, request);
    return request;
  }
}
