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
const EPS = 1e-12;
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
  const profitGate = Boolean(
    availableKnown
    && input.sharedDailyRisk
    && input.sharedDailyRisk.sourceComplete === true
    && dailyPct > 0
    && twr > 1 + EPS,
  );

  let tier: IntegratedGrossGovernorDecision["tier"] = "BASE";
  let desiredCrypto: number = policy.cryptoGrossCap;
  let desiredTotal: number = policy.totalGrossCap;
  let reservePct: number = policy.grossGovernorBaseAvailableBalanceReservePct;
  if (profitGate && dd <= 3 && twr >= 1.05) {
    tier = "PROFIT_1";
    desiredCrypto = 3.25;
    desiredTotal = 5.0;
    reservePct = 12.5;
  }
  if (profitGate && dd <= 2 && twr >= 1.10) {
    tier = "PROFIT_2";
    desiredCrypto = 3.5;
    desiredTotal = 6.0;
    reservePct = 10.0;
  }
  if (profitGate && dd <= 1 && twr >= 1.20) {
    tier = "PROFIT_3";
    desiredCrypto = 4.0;
    desiredTotal = 7.0;
    reservePct = 5.0;
  }
  if (profitGate && dd <= 0.5 && twr >= 1.30) {
    tier = "PROFIT_4";
    desiredCrypto = policy.cryptoGrossHardCap;
    desiredTotal = policy.totalGrossHardCap;
    reservePct = 0.0;
  }

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
  const reason = tier === "BASE"
    ? (ddFresh ? "BASE_CAPS_NO_PROFIT_BURST" : "BASE_CAPS_GOVERNOR_UNAVAILABLE_OR_STALE")
    : tier + "_DAILY_PROFIT_DD_TWR_MARGIN_OK";

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
