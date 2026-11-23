/** Keep Idle's margin-guard freshness strict whenever exposure exists.
 * The serialized guard's HEALTHY cadence is 300s, while Idle historically
 * rejected a healthy report after 90s. A short, bounded tolerance is safe
 * only when the same tick has independently fetched a flat account and no
 * pending gross reservations. Never accept WARNING, blocked or missing data.
 */
export const IDLE_FLAT_GUARD_MAX_AGE_MS = 330_000;

export function idleMarginGuardMaxAgeMs(input: {
  configuredMaxAgeMs: number;
  accountEquity: number;
  positions: readonly { quantity: number }[];
  pendingCryptoGross: number;
  pendingStockGross: number;
}): number {
  const original = input.configuredMaxAgeMs;
  if (!Number.isFinite(original) || original <= 0) return 0;
  const cleanFlatAccount = Number.isFinite(input.accountEquity)
    && input.accountEquity > 0
    && input.positions.every(p => Number.isFinite(p.quantity) && Math.abs(p.quantity) <= 1e-9)
    && Number.isFinite(input.pendingCryptoGross)
    && Number.isFinite(input.pendingStockGross)
    && Math.abs(input.pendingCryptoGross) <= 1e-9
    && Math.abs(input.pendingStockGross) <= 1e-9;
  return cleanFlatAccount ? Math.max(original, IDLE_FLAT_GUARD_MAX_AGE_MS) : original;
}
