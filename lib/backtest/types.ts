export type BacktestMode = "BASELINE" | "RETQ22";
export type PositionSide = "trend" | "range";

export interface Candle1h {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface Candle12h extends Candle1h {}

export interface IndicatorBar extends Candle12h {
    sma40: number;
    sma45: number;
    sma85: number;
    sma90: number;
    mom20: number;
    mom20Prev: number;
    momAccel: number;
    volAvg20: number;
    overheatPct: number;
    adx14: number;
    ready: boolean;
}

export interface RegimeSnapshot {
    ts: number;
    btc: IndicatorBar;
    breadth40: number;
    breadth45: number;
    core2_45: number;
    bestMom20: number;
    bestMomAccel: number;
    avgMom20EthSol: number;
    weak2022Regime: boolean;
    regimeLabel: "trend_strong" | "trend_weak" | "range_only" | "ambiguous";
    trendAllowed: boolean;
    rangeAllowed: boolean;
}

export interface PositionState {
    side: PositionSide | null;
    symbol: string | null;
    qty: number;
    entryPrice: number;
    entryTs: number;
    entryIndex: number;
    entryStrategy: string | null;
    entryReason: string;
    lotId: string;
    entryAlloc: number;
    rangeExitMom20Above: number | null;
    rangeMaxHoldBars: number | null;
    peakPrice: number;
}

export interface TradeEventRow {
    time: string;
    symbol: string;
    action: "enter" | "exit";
    strategy_type: PositionSide;
    sub_variant: string;
    alloc: number;
    price: number;
    qty: number;
    reason: string;
    trade_id: string;
}

export interface TradePairRow {
    trade_id: string;
    strategy_type: PositionSide;
    sub_variant: string;
    symbol: string;
    entry_time: string;
    exit_time: string;
    entry_price: number;
    exit_price: number;
    qty: number;
    gross_pnl: number;
    fee: number;
    net_pnl: number;
    holding_bars: number;
    entry_reason: string;
    exit_reason: string;
}

export interface EquityPoint {
    ts: number;
    iso_time: string;
    equity: number;
    cash: number;
    position_symbol: string;
    position_side: PositionSide | "cash";
    position_qty: number;
    position_entry_price: number;
}

export interface PeriodReturnRow {
    period: string;
    start_equity: number;
    end_equity: number;
    return_pct: number;
}

export interface BacktestSummary {
    mode: BacktestMode;
    start_equity: number;
    end_equity: number;
    cagr_pct: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    profit_factor: number;
    trade_count: number;
    exposure_pct: number;
    annual_returns: PeriodReturnRow[];
    monthly_returns: PeriodReturnRow[];
    symbol_contribution: Record<string, number>;
}

export interface BacktestResult {
    mode: BacktestMode;
    label: string;
    trade_events: TradeEventRow[];
    trade_pairs: TradePairRow[];
    equity_curve: EquityPoint[];
    annual_returns: PeriodReturnRow[];
    monthly_returns: PeriodReturnRow[];
    summary: BacktestSummary;
}

export interface StrategySnapshot {
    ts: number;
    regime: RegimeSnapshot;
    trendCandidate: {
        symbol: string;
        eligible: boolean;
        score: number;
        reasons: string[];
    } | null;
    rangeCandidate: {
        symbol: string;
        eligible: boolean;
        score: number;
        reasons: string[];
    } | null;
}

export interface BacktestSettings {
    includeRange: boolean;
    enableRetq22: boolean;
    enableOff22Strong: boolean;
    enableDd22Balanced: boolean;
    startTs: number;
    endTs: number;
}
