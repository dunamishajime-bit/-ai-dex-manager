import type { RankRow } from "../realtime-ranking";
import {
  calculateQuotePreview,
  RANKING_QUOTE_POLL_MS,
  RANKING_PREVIEW_PERIOD_MS,
} from "../realtime-ranking-preview";

type PublicQuote = { symbol?: string; price?: string | number };
type MinuteSample = { bucket: number; at: number; prices: ReadonlyMap<string, number> };
type MarketSnapshot = {
  at: number;
  prices: ReadonlyMap<string, number>;
  currentMinute: MinuteSample;
  priorMinute?: MinuteSample;
};

const ASTER_BATCH_PRICE_URL = "https://fapi.asterdex.com/fapi/v3/ticker/price";
const MAX_BATCH_BYTES = 1_000_000;
let active: Promise<MarketSnapshot> | undefined;
let cached: {expires: number; value: MarketSnapshot} | undefined;
let currentMinute: MinuteSample | undefined;
let priorMinute: MinuteSample | undefined;

function parseQuotes(value: unknown): ReadonlyMap<string, number> {
  if (!Array.isArray(value) || value.length > 1500) throw Error("PUBLIC_PRICE_BATCH_INVALID");
  const prices = new Map<string, number>();
  for (const entry of value as PublicQuote[]) {
    if (!entry || typeof entry !== "object" ||
        typeof entry.symbol !== "string" || !/^[A-Z0-9]{2,20}USDT$/.test(entry.symbol)) continue;
    const price = Number(entry.price);
    if (Number.isFinite(price) && price > 0) prices.set(entry.symbol, price);
  }
  if (prices.size < 15) throw Error("PUBLIC_PRICE_BATCH_INCOMPLETE");
  return prices;
}

export async function loadPublicAsterQuoteBatch(): Promise<MarketSnapshot> {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (active) return active;
  active = (async () => {
    const response = await fetch(ASTER_BATCH_PRICE_URL, {
      method:"GET", cache:"no-store", signal:AbortSignal.timeout(6500),
      headers:{"Accept":"application/json"},
    });
    if (!response.ok) throw Error("PUBLIC_PRICE_HTTP_"+response.status);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_BATCH_BYTES) throw Error("PUBLIC_PRICE_TOO_LARGE");
    const body = await response.text();
    if (body.length > MAX_BATCH_BYTES) throw Error("PUBLIC_PRICE_TOO_LARGE");
    const prices = parseQuotes(JSON.parse(body));
    const at = Date.now();
    const bucket = Math.floor(at / RANKING_PREVIEW_PERIOD_MS);
    if (!currentMinute || currentMinute.bucket !== bucket) {
      priorMinute = currentMinute?.bucket === bucket-1 ? currentMinute : undefined;
      currentMinute = { bucket, at, prices };
    }
    const snap: MarketSnapshot = {at, prices, currentMinute, priorMinute};
    cached = {expires:at+RANKING_QUOTE_POLL_MS-2000,value:snap};
    return snap;
  })().finally(() => { active = undefined; });
  return active;
}

export function publicAsterPreviewForRow(row: RankRow, snap: MarketSnapshot, now: number) {
  if (row.logic === "V52" || !/^[A-Z0-9]{2,20}USDT$/.test(row.symbol)) return undefined;
  const baseline = snap.priorMinute?.prices.get(row.symbol);
  const observed = snap.currentMinute.prices.get(row.symbol);
  const result = calculateQuotePreview({
    price: observed,
    priceAt: snap.currentMinute.at,
    baseline,
    baselineAt: snap.priorMinute?.at,
    formalScore: row.score,
    side:row.side,
    now,
  });
  if (!result) {
    const current = snap.prices.get(row.symbol);
    return calculateQuotePreview({
      price:current,priceAt:snap.at,baseline:undefined,baselineAt:undefined,
      formalScore:row.score,side:row.side,now,
    });
  }
  // The preview score is pinned to the first Aster quote of this UTC minute.
  // A newer quote is displayed every ~30s without recalculating that score.
  return {...result,price:snap.prices.get(row.symbol) ?? result.price,priceAt:snap.at};
}
