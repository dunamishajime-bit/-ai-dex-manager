import v52V50Runtime from "./v52V50Runtime.json";

/**
 * Single production contract for the integrated V12/PENGU/Q102/V52 portfolio.
 * This module is pure and importing it cannot enable a runner or submit an order.
 */
export const INTEGRATED_PRODUCTION_RISK_POLICY = Object.freeze({
  penguMaximumGross: 0.85,
  q102CausalV4MaximumGross: 1.5,
  q102MaximumPositions: 1,
  cryptoGrossCap: 3,
  stockGrossCap: 1.5,
  totalGrossCap: 3.5,
  cryptoDailyLossPct: 7.5,
  stockDailyLossPct: 3.5,
  requiredAsterLeverage: 5,
  requiredAsterMarginType: "cross" as const,
  v50: Object.freeze(v52V50Runtime),
});

export function resolveIntegratedProductionRiskPolicy(env: Record<string, string | undefined> = process.env) {
  const expected: Record<string, number> = {
    PENGU_DUAL_LS_V2_MAX_GROSS: INTEGRATED_PRODUCTION_RISK_POLICY.penguMaximumGross,
    QUALITY102_CAUSAL_V1_MAX_GROSS: INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross,
    CRYPTO_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
    STOCK_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.stockGrossCap,
    TOTAL_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
    DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoDailyLossPct,
  };
  for (const [name, value] of Object.entries(expected)) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const actual = Number(raw);
    if (!Number.isFinite(actual) || Math.abs(actual - value) > 1e-12) {
      throw new Error(`INTEGRATED_PRODUCTION_RISK_CONTRACT_MISMATCH:${name}:${raw}:EXPECTED_${value}`);
    }
  }
  return INTEGRATED_PRODUCTION_RISK_POLICY;
}
