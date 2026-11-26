// Pure, offline-testable direction policy. No order or runtime dependencies.
const HOUR = 3_600_000;
export type D126Bar = Readonly<{ timestampMs: number; close: number }>;
export type D126Result = Readonly<{
  status: "LONG_OVERRIDE" | "KEEP_SHORT" | "DATA_INVALID";
  returns?: readonly [number, number, number];
}>;
export function evaluateQ102HighVolD126(
  bars: readonly D126Bar[], entryTs: number,
): D126Result {
  if (!Number.isSafeInteger(entryTs) || entryTs <= 0 || entryTs % HOUR !== 0)
    return { status: "DATA_INVALID" };
  const required = new Set<number>();
  const boundaries = [24, 12, 6].map(hours => {
    const end = Math.floor(entryTs / (hours * HOUR)) * hours * HOUR;
    const start = end - hours * HOUR - HOUR;
    for (let ts = start; ts < end; ts += HOUR) required.add(ts);
    return [start, end - HOUR] as const;
  });
  const seen = new Map<number, number>();
  for (const bar of bars) {
    if (!Number.isSafeInteger(bar.timestampMs)) return { status: "DATA_INVALID" };
    if (bar.timestampMs + HOUR > entryTs) continue; // Never use unfinished candles.
    if (!required.has(bar.timestampMs)) continue;
    if (seen.has(bar.timestampMs) || !Number.isFinite(bar.close) || bar.close <= 0)
      return { status: "DATA_INVALID" };
    seen.set(bar.timestampMs, bar.close);
  }
  if ([...required].some(ts => !seen.has(ts))) return { status: "DATA_INVALID" };
  const returns = boundaries.map(([start, end]) => seen.get(end)! / seen.get(start)! - 1) as [number, number, number];
  if (!returns.every(Number.isFinite)) return { status: "DATA_INVALID" };
  return { status: returns.every(r => r > 0) ? "LONG_OVERRIDE" : "KEEP_SHORT", returns };
}
