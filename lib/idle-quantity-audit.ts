/** Diagnostic only. This function cannot resize or authorize an order.
 * It explains why exact 1.00x gross cannot be realized with Aster lot filters.
 */
export interface IdleQuantityAuditInput {
  symbol: string;
  equityUsd: number;
  price: number;
  requestedQuantity: number;
  quantity: number;
  notional: number;
  stepSize: number;
  minQuantity: number;
  maxQuantity: number;
  minNotional: number;
  priceTickSize?: number;
  pricePrecision?: number;
}
export function buildIdleQuantityAudit(x: IdleQuantityAuditInput) {
  const gross = x.equityUsd > 0 ? x.notional / x.equityUsd : 0;
  const shortfallUsd = Math.max(0, x.equityUsd - x.notional);
  const reasons: string[] = [];
  if (x.requestedQuantity > x.maxQuantity + 1e-9) reasons.push("VENUE_MAX_QTY");
  if (x.quantity < x.minQuantity || x.quantity <= 0) reasons.push("VENUE_MIN_QTY");
  if (x.minNotional > 0 && x.notional + 1e-9 < x.minNotional) reasons.push("VENUE_MIN_NOTIONAL");
  if (x.quantity + 1e-9 < Math.min(x.requestedQuantity, x.maxQuantity)) reasons.push("MARKET_LOT_STEP_ROUNDING");
  if (x.priceTickSize && x.priceTickSize > 0 &&
    Math.abs(x.price / x.priceTickSize - Math.round(x.price / x.priceTickSize)) > 1e-6) {
    reasons.push("PRICE_TICK_ALIGNMENT");
  }
  if (gross < 1 - 1e-6 && !reasons.length) reasons.push("FULL_1X_EXACTNESS");
  return {
    schema: "idle-quantity-audit/v1" as const,
    symbol: x.symbol,
    requestedGross: 1 as const,
    grossAfterRounding: gross,
    shortfallUsd,
    shortfallPct: x.equityUsd > 0 ? shortfallUsd / x.equityUsd * 100 : null,
    equityUsd: x.equityUsd,
    requestedQuantity: x.requestedQuantity,
    normalizedQuantity: x.quantity,
    quotePrice: x.price,
    normalizedNotionalUsd: x.notional,
    exchangeFilters: {
      minimumQuantity: x.minQuantity,
      maximumQuantity: x.maxQuantity,
      quantityStep: x.stepSize,
      minimumNotionalUsd: x.minNotional,
      priceTickSize: x.priceTickSize ?? null,
      pricePrecision: x.pricePrecision ?? null,
    },
    reasons,
    orderMutation: 0 as const,
  };
}
