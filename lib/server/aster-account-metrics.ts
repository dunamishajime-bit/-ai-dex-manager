export type AsterAccountMetricsInput = {
  totalMarginBalance?: string | number;
  totalWalletBalance?: string | number;
  availableBalance?: string | number;
  totalUnrealizedProfit?: string | number;
  assets?: unknown[];
};

export type AsterMaintenanceMetricsInput = {
  totalMarginBalance?: string | number;
  totalMaintMargin?: string | number;
};

export type AsterMaintenanceMetrics = {
  maintenanceMarginUsd: number | null;
  marginRatioPct: number | null;
};

export type AsterPositionMaintenanceInput = {
  maintMargin?: string | number;
  leverage?: string | number;
  marginType?: string;
  isolated?: boolean | string;
};

export type AsterPositionMaintenance = {
  maintenanceMarginUsd: number | null;
  leverage: number | null;
  marginType: string | null;
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

function optionalFinite(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveAsterMaintenanceMetrics(input: AsterMaintenanceMetricsInput | null | undefined): AsterMaintenanceMetrics {
  const source = input && typeof input === "object" ? input : {};
  const marginBalance = optionalFinite(source.totalMarginBalance);
  const maintenanceMarginUsd = optionalFinite(source.totalMaintMargin);
  const marginRatioPct = maintenanceMarginUsd !== null && marginBalance !== null && marginBalance > 0
    ? Number(((maintenanceMarginUsd / marginBalance) * 100).toFixed(4))
    : null;
  return { maintenanceMarginUsd, marginRatioPct };
}

export function deriveAsterPositionMaintenance(input: AsterPositionMaintenanceInput | null | undefined): AsterPositionMaintenance {
  const source = input && typeof input === "object" ? input : {};
  const maintenanceMarginUsd = optionalFinite(source.maintMargin);
  const leverageValue = optionalFinite(source.leverage);
  const leverage = leverageValue !== null && leverageValue > 0 ? leverageValue : null;
  const explicitMarginType = String(source.marginType || "").trim().toLowerCase();
  const isolated = source.isolated === true || source.isolated === "true";
  const cross = source.isolated === false || source.isolated === "false";
  const marginType = explicitMarginType || (isolated ? "isolated" : cross ? "cross" : null);
  return { maintenanceMarginUsd, leverage, marginType };
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
