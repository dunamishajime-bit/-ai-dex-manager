import type { AsterKline } from "./aster-v3-client";
import { ADOPTED_FIVE_MINUTE_MS, type ClosedFiveMinuteClose } from "./hype-render-tao-adopted-policy";

function parse(row: AsterKline, symbol: string): ClosedFiveMinuteClose {
  const openTs = Number(row[0]);
  const close = Number(row[4]);
  const closeTs = Number(row[6]);
  if (!Number.isSafeInteger(openTs) || openTs <= 0 || openTs % ADOPTED_FIVE_MINUTE_MS !== 0) {
    throw new Error(`${symbol}_ADOPTED_M5_DATA_TIMESTAMP_INVALID:${openTs}`);
  }
  if (!Number.isFinite(close) || close <= 0) throw new Error(`${symbol}_ADOPTED_M5_DATA_CLOSE_INVALID:${openTs}`);
  if (!Number.isSafeInteger(closeTs) || closeTs < openTs || closeTs >= openTs + ADOPTED_FIVE_MINUTE_MS) {
    throw new Error(`${symbol}_ADOPTED_M5_DATA_CLOSE_TIME_INVALID:${openTs}`);
  }
  return { openTs, close };
}

/**
 * Normalize only completed, contiguous five-minute closes for an adopted
 * policy. The caller supplies the decision boundary; no current/forming bar
 * is ever used and a missing bar fails closed.
 */
export function normalizeAdoptedFiveMinuteCloses(
  rows: readonly AsterKline[],
  symbol: string,
  decisionTs: number,
  lookbackBars: number,
): ClosedFiveMinuteClose[] {
  if (!Number.isSafeInteger(decisionTs) || decisionTs <= 0 || decisionTs % ADOPTED_FIVE_MINUTE_MS !== 0) {
    throw new Error(`${symbol}_ADOPTED_M5_DATA_DECISION_TS_INVALID:${decisionTs}`);
  }
  if (!Number.isInteger(lookbackBars) || lookbackBars <= 0) throw new Error(`${symbol}_ADOPTED_M5_DATA_LOOKBACK_INVALID`);
  const firstOpenTs = decisionTs - (lookbackBars + 1) * ADOPTED_FIVE_MINUTE_MS;
  const lastOpenTs = decisionTs - ADOPTED_FIVE_MINUTE_MS;
  const indexed = new Map<number, ClosedFiveMinuteClose>();
  for (const raw of rows) {
    const openTs = Number(raw[0]);
    if (!Number.isFinite(openTs) || openTs < firstOpenTs || openTs > lastOpenTs) continue;
    const close = parse(raw, symbol);
    if (indexed.has(close.openTs)) throw new Error(`${symbol}_ADOPTED_M5_DATA_DUPLICATE:${close.openTs}`);
    if (Number(raw[6]) >= decisionTs) throw new Error(`${symbol}_ADOPTED_M5_DATA_FORMING:${close.openTs}`);
    indexed.set(close.openTs, close);
  }
  if (indexed.size !== lookbackBars + 1) throw new Error(`${symbol}_ADOPTED_M5_DATA_INSUFFICIENT:${indexed.size}:${lookbackBars + 1}`);
  const normalized: ClosedFiveMinuteClose[] = [];
  for (let index = 0; index <= lookbackBars; index += 1) {
    const expectedTs = firstOpenTs + index * ADOPTED_FIVE_MINUTE_MS;
    const row = indexed.get(expectedTs);
    if (!row) throw new Error(`${symbol}_ADOPTED_M5_DATA_GAP:${expectedTs}`);
    normalized.push(row);
  }
  return normalized;
}
