export type AsterAccountMetricsInput = {
  totalMarginBalance?: string | number;
  totalWalletBalance?: string | number;
  availableBalance?: string | number;
  totalUnrealizedProfit?: string | number;
  assets?: unknown[];
};

export type AsterAccountMetrics = {
  balanceUsd: number;
  availableUsd: number;
  unrealizedPnlUsd: number;
  connected: boolean;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPositive(values: unknown[]) {
  return values.map(finite).find((value) => value > 0) ?? 0;
}

/**
 * Normalize the account-level values used by the wallet card and live portfolio.
 * Margin balance is the displayed account valuation; wallet balance is only a
 * fallback for account responses that omit margin balance.
 */
export function deriveAsterAccountMetrics(
  account: AsterAccountMetricsInput | null | undefined,
  stableBalanceUsd = 0,
): AsterAccountMetrics {
  const source = account && typeof account === "object" ? account : {};
  const balanceUsd = Number(firstPositive([
    source.totalMarginBalance,
    source.totalWalletBalance,
    stableBalanceUsd,
  ]).toFixed(8));
  const availableUsd = Number(finite(source.availableBalance).toFixed(8));
  const unrealizedPnlUsd = Number(finite(source.totalUnrealizedProfit).toFixed(8));
  const connected = Boolean(
    source.assets
    || source.totalMarginBalance !== undefined
    || source.totalWalletBalance !== undefined
    || source.availableBalance !== undefined
    || source.totalUnrealizedProfit !== undefined,
  );

  return { balanceUsd, availableUsd, unrealizedPnlUsd, connected };
}
