import type { RankRow } from "./realtime-ranking";

/**
 * Display-only momentum hint. Never used by trading, market gates or alerts.
 * Uses one Aster public futures quote per symbol; a 60s quote-to-quote
 * change is NOT a completed-candle signal, execution probability or BT score.
 */
export type RankingPricePreview = {
  price: number;
  priceAt: number;
  referenceAt?: number;
  minuteChangePct?: number;
  score?: number;
  status: "PRICE_ONLY" | "ONE_MINUTE_REFERENCE";
};

export const RANKING_PAGE_REFRESH_MS = 30_000;
export const RANKING_QUOTE_POLL_MS = 30_000;
export const RANKING_PREVIEW_PERIOD_MS = 60_000;
export const RANKING_PRICE_MAX_AGE_MS = 90_000;

function valid(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function provisionalScore(
  formalScore: number | null,
  side: string,
  pct: number | undefined,
): number | undefined {
  // A price-only guide must never manufacture a score when the formal
  // confirmed-candle observation is unavailable, blocked or out of date.
  if (!valid(formalScore) || formalScore < 0 || formalScore > 100) return undefined;
  if (!valid(pct) || (side !== "LONG" && side !== "SHORT")) return undefined;
  const directionalPct = pct * (side === "SHORT" ? -1 : 1);
  const referenceDelta = Math.max(-8, Math.min(8, directionalPct * 12));
  // Price-only estimates can NEVER assert a full 100/100 signal pass.
  return Math.min(99, Math.max(0, Math.round(formalScore + referenceDelta)));
}

export function calculateQuotePreview(input: {
  price: number | undefined;
  priceAt: number;
  baseline: number | undefined;
  baselineAt: number | undefined;
  formalScore: number | null;
  side: string;
  now: number;
}): RankingPricePreview | undefined {
  const { price, priceAt, baseline, baselineAt, formalScore, side, now } = input;
  if (!valid(price) || price <= 0 || !valid(priceAt) ||
      priceAt > now + 60_000 || now - priceAt > RANKING_PRICE_MAX_AGE_MS) return undefined;
  const referenceOK = valid(baseline) && baseline > 0 && valid(baselineAt) &&
    priceAt >= baselineAt + 40_000 && priceAt <= baselineAt + 150_000;
  const minuteChangePct = referenceOK ? (price / baseline! - 1) * 100 : undefined;
  const score = provisionalScore(formalScore, side, minuteChangePct);
  return {
    price, priceAt,
    ...(referenceOK ? { referenceAt: baselineAt, minuteChangePct } : {}),
    ...(score !== undefined ? { score } : {}),
    status: referenceOK ? "ONE_MINUTE_REFERENCE" : "PRICE_ONLY",
  };
}

/** Sort display-only rows, preserving authoritative row.score and gate states. */
export function rankProvisionalRows(rows: RankRow[], enabled: boolean): RankRow[] {
  if (!enabled) return rows;
  const tier = (row: RankRow) =>
    row.preview?.score === undefined ? 0 : row.gates.some(g => g.kind === "execution" && g.state === "NO") ? 1 : 2;
  return [...rows].sort((a,b) =>
    tier(b)-tier(a) ||
    (b.preview?.score ?? -1)-(a.preview?.score ?? -1) ||
    a.id.localeCompare(b.id)
  ).map((row,i) => ({...row,previewRank: row.preview?.score === undefined ? undefined : i+1}));
}

export function displayRank(row: RankRow, preview: boolean) {
  return preview ? row.previewRank : row.rank;
}

export function displayScore(row: RankRow, preview: boolean): number | null {
  return preview ? row.preview?.score ?? null : row.score;
}

export function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", {maximumFractionDigits:2});
  if (value >= 1) return value.toLocaleString("en-US", {maximumFractionDigits:4});
  return value.toLocaleString("en-US", {maximumSignificantDigits:6});
}
