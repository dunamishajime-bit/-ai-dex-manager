import v52V50Runtime from "./v52V50Runtime.json";

export const Q102_CAUSAL_V4_FAMILY_GROSS = Object.freeze({
  HIGH_VOL: 1.665,
  MR: 1.0,
  BRK: 2.465,
  REV: 2.5,
  PB: 2.5,
} as const);

export type Q102CausalV4GrossFamily = keyof typeof Q102_CAUSAL_V4_FAMILY_GROSS;

/**
 * Single production contract for the integrated V12/PENGU/Q102/V52 portfolio.
 * Importing this module has no side effects and cannot enable a runner or
 * submit an order.
 */
export const INTEGRATED_PRODUCTION_RISK_POLICY = Object.freeze({
  v12BaseAggregateGross: 1.5,
  v12DynamicAggregateGrossCap: 2.0,
  v12PerPositionGrossCap: 1.0,
  penguMaximumGross: 0.85,
  q102FamilyGross: Q102_CAUSAL_V4_FAMILY_GROSS,
  q102CausalV4MaximumGross: 2.5,
  q102MaximumPositions: 1,
  cryptoGrossCap: 3,
  stockGrossCap: Number(v52V50Runtime.stockAggregateGross),
  stockSlotGrossCap: Number(v52V50Runtime.slotGross),
  totalGrossCap: 3.5,
  cryptoDailyLossPct: 7.5,
  stockDailyLossPct: 3.5,
  killSwitchRecoveryGraceMs: 10 * 60_000,
  requiredAsterLeverage: 5,
  requiredAsterMarginType: "cross" as const,
  v50: Object.freeze(v52V50Runtime),
});

export function quality102GrossForFamily(family: string | undefined): number {
  const key = String(family || "").trim().toUpperCase() as Q102CausalV4GrossFamily;
  const value = Q102_CAUSAL_V4_FAMILY_GROSS[key];
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`QUALITY102_CAUSAL_V4_FAMILY_GROSS_UNRESOLVED:${family || "UNKNOWN"}`);
  }
  return value;
}

export function resolveIntegratedProductionRiskPolicy(env: Record<string, string | undefined> = process.env) {
  const expected: Record<string, number> = {
    V12_BASE_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.v12BaseAggregateGross,
    V12_DYNAMIC_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.v12DynamicAggregateGrossCap,
    PENGU_DUAL_LS_V2_MAX_GROSS: INTEGRATED_PRODUCTION_RISK_POLICY.penguMaximumGross,
    QUALITY102_CAUSAL_V1_MAX_GROSS: INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross,
    CRYPTO_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
    STOCK_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.stockGrossCap,
    TOTAL_GROSS_CAP: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
    DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoDailyLossPct,
    DISDEX_KILL_SWITCH_RECOVERY_GRACE_MS: INTEGRATED_PRODUCTION_RISK_POLICY.killSwitchRecoveryGraceMs,
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
