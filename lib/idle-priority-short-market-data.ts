import type { AsterKline, AsterV3Client } from "./aster-v3-client";
import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";
import { IDLE_RESIDUAL_LONG_POLICY, type IdleResidualLongSymbol } from "../config/idleResidualLongPolicy";
import type { IdleH1Candle } from "./idle-priority-short-signal";
import type { ConfirmedFiveMinuteBar } from "./disdex-exit-overlay-contract";
import { RENDER_H1_MS, RENDER_M5_MS, type ClosedM5 } from "./render-highwr-and-legacy-stop";

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

export class IdlePriorityAsterMarketDataProvider {
  private readonly cache = new CompletedH1SnapshotCache();
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

  /**
   * Fully complete 72h OHLCV / RENDER taker-flow source, no OI dependency.
   * Only called on a new H1 decision. Missing first/last/intermediate bars
   * and unconfirmed volumes all reject the new RENDER route.
   */
  async loadRenderIndependentM5(decisionTs: number): Promise<{btcM5: ClosedM5[]; renderM5: ClosedM5[]}> {
    if(!Number.isSafeInteger(decisionTs)||decisionTs%RENDER_H1_MS!==0)throw Error("RENDER_MARKET_DECISION_TS_INVALID");
    const start=decisionTs-72*RENDER_H1_MS;
    const count=(decisionTs-start)/RENDER_M5_MS;
    const read=async(symbol:string,requireFlow:boolean):Promise<ClosedM5[]>=>{
      const rows=await this.client.getKlines(symbol,"5m",count+2,{startTime:start,endTime:decisionTs-1});
      const mapped=rows.map((row)=>({
        ts:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),
        baseVolume:requireFlow?Number(row[5]):undefined,
        takerBuyBaseVolume:requireFlow?Number(row[9]):undefined,
        closeTime:Number(row[6])
      })).filter(row=>row.ts>=start&&row.ts<decisionTs);
      if(mapped.length!==count)throw Error(`RENDER_MARKET_M5_COUNT_GAP:${symbol}:${mapped.length}/${count}`);
      for(let i=0;i<mapped.length;i++){
        const x=mapped[i]!;
        if(x.ts!==start+i*RENDER_M5_MS||!(x.closeTime<decisionTs)||
          ![x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0)||
          x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)||
          (requireFlow&&(!Number.isFinite(x.baseVolume)||!Number.isFinite(x.takerBuyBaseVolume)||
            x.baseVolume!<0||x.takerBuyBaseVolume!<0||x.takerBuyBaseVolume!>x.baseVolume!))) {
          throw Error(`RENDER_MARKET_M5_MALFORMED:${symbol}:${i}`);
        }
      }
      return mapped.map(({closeTime,...bar})=>bar);
    };
    const btcM5=await read("BTCUSDT",false);
    const renderM5=await read("RENDERUSDT",true);
    return {btcM5,renderM5};
  }

  /** Load only completed contiguous 5m candles for a causal entry/exit rule. */
  async loadFiveMinuteSince(symbol: string, startTs: number, endTs = (this.options.now || Date.now)()): Promise<ConfirmedFiveMinuteBar[]> {
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || startTs <= 0 || endTs <= startTs) {
      throw new Error(`IDLE_5M_SERIES_WINDOW_INVALID:${symbol}`);
    }
    const firstOpen = Math.floor(startTs / FIVE_MINUTE) * FIVE_MINUTE;
    const currentOpen = Math.floor(endTs / FIVE_MINUTE) * FIVE_MINUTE;
    const rows = await this.client.getKlines(symbol, "5m", Math.min(1000, Math.max(10, Math.ceil((currentOpen - firstOpen) / FIVE_MINUTE) + 3)), {
      startTime: firstOpen,
      endTime: currentOpen + 1,
    });
    const parsed = rows
      .map((row) => ({
        timestampMs: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        closeTime: Number(row[6]),
      }))
      .filter((row) => row.timestampMs >= firstOpen && row.timestampMs < currentOpen && row.closeTime < endTs)
      .sort((left, right) => left.timestampMs - right.timestampMs);
    const result: ConfirmedFiveMinuteBar[] = [];
    for (const row of parsed) {
      if (![row.timestampMs, row.open, row.high, row.low, row.close, row.closeTime].every(Number.isFinite)
        || row.timestampMs <= 0 || row.timestampMs % FIVE_MINUTE !== 0
        || ![row.open, row.high, row.low, row.close].every((value) => value > 0)
        || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low) {
        throw new Error(`IDLE_5M_SERIES_BAR_INVALID:${symbol}:${row.timestampMs}`);
      }
      const previous = result.at(-1);
      if (previous?.timestampMs === row.timestampMs) throw new Error(`IDLE_5M_SERIES_DUPLICATE:${symbol}:${row.timestampMs}`);
      if (previous && row.timestampMs - previous.timestampMs !== FIVE_MINUTE) throw new Error(`IDLE_5M_SERIES_GAP:${symbol}:${previous.timestampMs}:${row.timestampMs}`);
      result.push({ timestampMs: row.timestampMs, open: row.open, high: row.high, low: row.low, close: row.close });
    }
    if (result.length > 0 && result[0]!.timestampMs !== firstOpen) throw new Error(`IDLE_5M_SERIES_START_GAP:${symbol}:${firstOpen}`);
    return result;
  }
}
