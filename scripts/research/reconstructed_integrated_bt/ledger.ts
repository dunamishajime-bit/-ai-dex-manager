// Shared contract only. Raw-data rebuilds emit events independently and do
// not consume the reconstructed ledger represented by this module.
export const PENGU_Q60_DD17_H72 = Object.freeze({
  variant: "Q60_DD170_H72" as const,
  logic: "COMBINED_FILTERED" as const,
  maxGross: 1,
  entryGross: 1,
  routeQuarantineHours: 60,
  realizedDdThreshold: -0.17,
  ddPauseHours: 72,
});

export type NormalizedPenguTrade = {
  strategy: "PENGU";
  window: string;
  variant: typeof PENGU_Q60_DD17_H72.variant;
  mode: "NORMAL" | "SEVERE";
  route: string;
  side: "L" | "S";
  signalTs: string;
  entryTs: string;
  exitTs: string;
  entryPrice: number;
  exitPrice: number;
  gross: 1;
  accepted: true;
  accountReturn: number;
  rawUnitReturn: number;
  fundingUnitReturn: number;
  costUnitReturn: number;
  exitReason: string;
};

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`PENGU_INVALID_${name}`);
  }
  return value;
}

function iso(value: unknown, name: string): string {
  const timestamp = finite(value, name);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) throw new Error(`PENGU_INVALID_${name}`);
  return parsed.toISOString();
}

export function normalizePenguTrade(input: Record<string, unknown>, window: string): NormalizedPenguTrade {
  if (input.variant !== PENGU_Q60_DD17_H72.variant) throw new Error("PENGU_VARIANT_MISMATCH");
  if (input.mode !== "NORMAL" && input.mode !== "SEVERE") throw new Error("PENGU_MODE_INVALID");
  const gross = finite(input.requestedGross, "GROSS");
  if (Math.abs(gross - PENGU_Q60_DD17_H72.entryGross) > 1e-12) throw new Error("PENGU_GROSS_NOT_FLAT1");
  if (typeof input.route !== "string" || !input.route) throw new Error("PENGU_ROUTE_MISSING");
  if (input.side !== "L" && input.side !== "S") throw new Error("PENGU_SIDE_INVALID");
  if (typeof input.exitReason !== "string" || !input.exitReason) throw new Error("PENGU_EXIT_REASON_MISSING");
  return {
    strategy: "PENGU",
    window,
    variant: PENGU_Q60_DD17_H72.variant,
    mode: input.mode,
    route: input.route,
    side: input.side,
    signalTs: iso(input.signalTs, "SIGNAL_TS"),
    entryTs: iso(input.entryTs, "ENTRY_TS"),
    exitTs: iso(input.exitTs, "EXIT_TS"),
    entryPrice: finite(input.entryPrice, "ENTRY_PRICE"),
    exitPrice: finite(input.exitPrice, "EXIT_PRICE"),
    gross: 1,
    accepted: true,
    accountReturn: finite(input.accountReturn, "ACCOUNT_RETURN"),
    rawUnitReturn: finite(input.rawUnitReturn, "RAW_RETURN"),
    fundingUnitReturn: finite(input.fundingUnitReturn, "FUNDING_RETURN"),
    costUnitReturn: finite(input.costUnitReturn, "COST_RETURN"),
    exitReason: input.exitReason,
  };
}

export function monthlyDepositSchedule(startUtc: string, months: number, amount: number): Array<{ ts: string; amount: number }> {
  if (!Number.isInteger(months) || months < 0) throw new Error("DEPOSIT_MONTHS_INVALID");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("DEPOSIT_AMOUNT_INVALID");
  const start = new Date(startUtc);
  if (Number.isNaN(start.getTime())) throw new Error("DEPOSIT_START_INVALID");
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(start);
    date.setUTCMonth(date.getUTCMonth() + index + 1);
    return { ts: date.toISOString(), amount };
  });
}
