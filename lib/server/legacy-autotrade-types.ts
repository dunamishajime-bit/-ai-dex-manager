/**
 * Read-only schemas for historical legacy auto-trade records.
 *
 * The legacy execution runner is intentionally not imported here. Keeping
 * the data shape separate lets the history page read old records without
 * reintroducing an order-generating code path.
 */
export type LegacyAutotradeTrigger = "scheduled" | "manual" | "pengu_15m" | "inj_spring";

export interface LegacyAutoTradeWalletResult {
  walletId: string;
  address: string;
  status: "skipped" | "noop" | "traded" | "error";
  step?: "sell" | "buy" | "wait" | "hold";
  stepLabel?: string;
  reason: string;
  desiredSymbol: string;
  desiredSide: "trend" | "range" | "cash";
  currentSymbol: string;
  amountWei?: string;
  trade?: Record<string, unknown>;
  marketJudgement?: unknown;
}

export interface LegacyAutoTradeRunSummary {
  strategyId: string;
  trigger: LegacyAutotradeTrigger;
  triggerLabel: string;
  executedAt: string;
  decisionTime: string;
  desiredSymbol: string;
  desiredSide: "trend" | "range" | "cash";
  reason: string;
  marketJudgement?: unknown;
  walletResults: LegacyAutoTradeWalletResult[];
}
