export type DynamicSizingRejectionReason = "DATA_MISSING" | "NO_CAPACITY" | "GROSS_CAP" | "MIN_QTY" | "MIN_NOTIONAL";

export interface DynamicSizingInput {
    readonly decision_ts_ms: number;
    readonly wallet_jpy: number;
    readonly equity_jpy: number;
    readonly strategy_gross: number;
    readonly strategy_gross_cap: number;
    readonly available_margin: number;
    readonly pending_gross: number;
    readonly fee_bps: number;
    readonly funding_bps: number;
    readonly slippage_bps: number;
    readonly price: number;
    readonly gross_cap: number;
    readonly quantity_step: number;
    readonly min_qty: number;
    readonly min_notional: number;
    readonly margin_reserve: number;
    /** Deliberately ignored compatibility fields: sizing is decision-time only. */
    readonly future_exit_pnl?: number;
    readonly later_wallet_jpy?: number;
}

export interface DynamicSizingResult {
    readonly accepted: boolean;
    readonly reason: DynamicSizingRejectionReason | null;
    readonly decision_ts_ms: number;
    readonly quantity: number;
    readonly gross: number;
    readonly raw_quantity: number;
    readonly raw_gross: number;
    readonly cost_rate_bps: number;
    readonly cost_reserve: number;
    readonly wallet_jpy: number;
    readonly equity_jpy: number;
    readonly strategy_gross: number;
    readonly available_margin: number;
    readonly pending_gross: number;
    readonly gross_cap: number;
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function rejected(input: DynamicSizingInput, reason: DynamicSizingRejectionReason, rawQuantity = 0, rawGross = 0): DynamicSizingResult {
    return {
        accepted: false,
        reason,
        decision_ts_ms: input.decision_ts_ms,
        quantity: 0,
        gross: 0,
        raw_quantity: rawQuantity,
        raw_gross: rawGross,
        cost_rate_bps: finite(input.fee_bps) && finite(input.funding_bps) && finite(input.slippage_bps) ? input.fee_bps + input.funding_bps + input.slippage_bps : 0,
        cost_reserve: 0,
        wallet_jpy: input.wallet_jpy,
        equity_jpy: input.equity_jpy,
        strategy_gross: input.strategy_gross,
        available_margin: input.available_margin,
        pending_gross: input.pending_gross,
        gross_cap: input.gross_cap,
    };
}

function floorToStep(value: number, step: number): number {
    const scale = Math.max(0, Math.ceil(-Math.log10(step)) + 4);
    const multiplier = 10 ** scale;
    const scaledValue = Math.floor((value + step * 1e-9) / step) * step;
    return Math.floor(scaledValue * multiplier + 1e-9) / multiplier;
}

/**
 * Calculates a deterministic entry lot from only decision-time inputs. Costs
 * reserve margin before quantity is rounded down; no future PnL is consulted.
 */
export function sizeDynamicEntry(input: DynamicSizingInput): DynamicSizingResult {
    const required = [
        input.decision_ts_ms,
        input.wallet_jpy,
        input.equity_jpy,
        input.strategy_gross,
        input.strategy_gross_cap,
        input.available_margin,
        input.pending_gross,
        input.fee_bps,
        input.funding_bps,
        input.slippage_bps,
        input.price,
        input.gross_cap,
        input.quantity_step,
        input.min_qty,
        input.min_notional,
        input.margin_reserve,
    ];
    if (required.some((value) => !finite(value)) || input.price <= 0 || input.quantity_step <= 0 || input.wallet_jpy < 0 || input.equity_jpy < 0 || input.strategy_gross < 0 || input.strategy_gross_cap < 0 || input.available_margin < 0 || input.pending_gross < 0 || input.fee_bps < 0 || input.funding_bps < 0 || input.slippage_bps < 0 || input.gross_cap <= 0 || input.min_qty < 0 || input.min_notional < 0 || input.margin_reserve < 0) {
        return rejected(input, "DATA_MISSING");
    }
    const costRateBps = input.fee_bps + input.funding_bps + input.slippage_bps;
    const costRate = costRateBps / 10_000;
    const marginCapacity = input.available_margin - input.pending_gross - input.margin_reserve;
    const walletCapacity = Math.min(input.wallet_jpy, input.equity_jpy);
    const strategyCapacity = input.strategy_gross_cap - input.strategy_gross;
    const baseGross = Math.min(walletCapacity, marginCapacity, strategyCapacity, input.gross_cap);
    if (!Number.isFinite(baseGross) || baseGross <= 0) return rejected(input, input.gross_cap < input.min_notional ? "GROSS_CAP" : "NO_CAPACITY");
    const rawGross = baseGross / (1 + costRate);
    const rawQuantity = rawGross / input.price;
    const quantity = floorToStep(rawQuantity, input.quantity_step);
    const gross = quantity * input.price;
    const costReserve = gross * costRate;
    if (!Number.isFinite(quantity) || !Number.isFinite(gross) || gross > input.gross_cap + 1e-9 || gross > strategyCapacity + 1e-9 || gross + costReserve > marginCapacity + 1e-9 || gross + costReserve > walletCapacity + 1e-9) {
        return rejected(input, "GROSS_CAP", rawQuantity, rawGross);
    }
    if (quantity < input.min_qty) return rejected(input, "MIN_QTY", rawQuantity, rawGross);
    if (gross < input.min_notional) return rejected(input, "MIN_NOTIONAL", rawQuantity, rawGross);
    return {
        accepted: true,
        reason: null,
        decision_ts_ms: input.decision_ts_ms,
        quantity,
        gross,
        raw_quantity: rawQuantity,
        raw_gross: rawGross,
        cost_rate_bps: costRateBps,
        cost_reserve: costReserve,
        wallet_jpy: input.wallet_jpy,
        equity_jpy: input.equity_jpy,
        strategy_gross: input.strategy_gross,
        available_margin: input.available_margin,
        pending_gross: input.pending_gross,
        gross_cap: input.gross_cap,
    };
}

