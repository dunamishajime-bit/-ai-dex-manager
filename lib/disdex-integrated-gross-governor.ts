import { INTEGRATED_PRODUCTION_RISK_POLICY } from "@/config/integratedProductionRiskPolicy";
import type { PortfolioDdGovernorState } from "@/lib/disdex-portfolio-dd-governor";
import type { SharedCryptoDailyRiskState } from "@/lib/disdex-shared-crypto-daily-risk";

export interface IntegratedGrossGovernorInput {
  now: number;
  equityUsd: number;
  availableBalanceUsd?: number;
  currentCryptoGross: number;
  currentTotalGross: number;
  sharedDailyRisk?: SharedCryptoDailyRiskState;
  portfolioDdGovernor?: PortfolioDdGovernorState;
}

export interface IntegratedGrossGovernorDecision {
  cryptoEntryCap: number;
  totalEntryCap: number;
  cryptoHardCap: number;
  totalHardCap: number;
  tier: "BASE" | "PROFIT_1" | "PROFIT_2" | "PROFIT_3" | "PROFIT_4";
  reason: string;
  availableBalanceReservePct: number;
  marginDerivedTotalCap: number;
  dailyProfitPct: number;
  currentDrawdownPct: number;
  twrIndex: number;
}
const DD_MAX_AGE_MS = 120_000;

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validDdState(state: PortfolioDdGovernorState | undefined, now: number) {
  return Boolean(
    state
    && Number.isFinite(state.updatedAt)
    && Math.abs(now - state.updatedAt) <= DD_MAX_AGE_MS
    && state.twrIndex > 0
    && state.twrPeak > 0
    && state.currentDrawdownPct >= 0,
  );
}

function dailyProfitPct(state: SharedCryptoDailyRiskState | undefined) {
  const reference = finite(state?.referenceEquity);
  const pnl = finite(state?.netDailyPnl);
  return reference > 0 ? pnl / reference * 100 : 0;
}
export function resolveIntegratedGrossGovernor(
  input: IntegratedGrossGovernorInput,
): IntegratedGrossGovernorDecision {
  const policy = INTEGRATED_PRODUCTION_RISK_POLICY;
  const equity = Math.max(0.001, finite(input.equityUsd));
  const availableKnown = Number.isFinite(Number(input.availableBalanceUsd));
  const available = availableKnown ? Math.max(0, finite(input.availableBalanceUsd)) : equity;
  const currentCrypto = Math.max(0, finite(input.currentCryptoGross));
  const currentTotal = Math.max(0, finite(input.currentTotalGross));
  const ddFresh = validDdState(input.portfolioDdGovernor, input.now);
  const dailyPct = dailyProfitPct(input.sharedDailyRisk);
  const twr = ddFresh ? finite(input.portfolioDdGovernor?.twrIndex, 1) : 1;
  const dd = ddFresh ? finite(input.portfolioDdGovernor?.currentDrawdownPct) : 100;
  // The formal LIVE contract uses fixed normal caps.  Profit/DD/margin data
  // remains observable for diagnostics, but it must never allocate additional
  // Gross dynamically or turn research tiers into order authority.
  const tier: IntegratedGrossGovernorDecision["tier"] = "BASE";
  const desiredCrypto = policy.cryptoGrossCap;
  const desiredTotal = policy.totalGrossCap;
  const reservePct = policy.grossGovernorBaseAvailableBalanceReservePct;

  const reserveUsd = equity * reservePct / 100;
  const additionalMarginUsd = Math.max(0, available - reserveUsd);
  const additionalGrossCapacity = additionalMarginUsd
    * policy.requiredAsterLeverage / equity;
  const marginDerivedTotalCap = availableKnown
    ? Math.max(currentTotal, currentTotal + additionalGrossCapacity)
    : Math.max(currentTotal, policy.totalGrossCap);

  const totalEntryCap = Math.max(
    currentTotal,
    Math.min(policy.totalGrossHardCap, desiredTotal, marginDerivedTotalCap),
  );
  const cryptoEntryCap = Math.max(
    currentCrypto,
    Math.min(policy.cryptoGrossHardCap, desiredCrypto, totalEntryCap),
  );
  const reason = "BASE_CAPS_DYNAMIC_GROSS_DISABLED";

  return {
    cryptoEntryCap,
    totalEntryCap,
    cryptoHardCap: policy.cryptoGrossHardCap,
    totalHardCap: policy.totalGrossHardCap,
    tier,
    reason,
    availableBalanceReservePct: reservePct,
    marginDerivedTotalCap,
    dailyProfitPct: dailyPct,
    currentDrawdownPct: dd,
    twrIndex: twr,
  };
}
