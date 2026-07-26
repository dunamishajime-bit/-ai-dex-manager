from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal, Optional

STRATEGY_ID = "V96_STOCK_INTRADAY_THEME_FLOW_V1"
MODE = "SHADOW_RESEARCH_ONLY"

Side = Literal[-1, 0, 1]
Action = Literal[
    "FLAT",
    "ENTER_LONG",
    "ENTER_SHORT",
    "ADD_LONG",
    "ADD_SHORT",
    "HOLD",
    "EXIT",
]


@dataclass(frozen=True)
class Config:
    # Signal layer: deliberately price/volume based so it can be historically replayed.
    minimum_theme_breadth: float = 0.60
    minimum_theme_move_atr: float = 0.35
    long_rank_floor: float = 0.75
    short_rank_ceiling: float = 0.25
    minimum_opening_break_atr: float = 0.10
    minimum_relative_volume: float = 1.20

    # Execution layer: calibrated from the stock-perpetual Forward collector.
    maximum_spread_bps: float = 15.0
    maximum_one_way_slippage_bps: float = 15.0
    maximum_expected_round_trip_bps: float = 40.0
    maximum_book_mid_mismatch_bps: float = 5.0
    minimum_depth_to_order_ratio: float = 10.0
    maximum_abs_funding_rate: float = 0.0005
    minimum_oi_change_pct: float = 0.10

    # Session and portfolio controls.
    entry_start_new_york_minute: int = 10 * 60
    entry_end_new_york_minute: int = 14 * 60 + 30
    force_exit_new_york_minute: int = 15 * 60 + 45
    stock_gross_cap: float = 1.0
    initial_gross_cap: float = 0.50
    add_gross_cap: float = 0.50
    account_risk_budget_pct: float = 0.75
    minimum_stop_pct: float = 0.60
    stop_atr_multiple: float = 1.25
    maximum_entries_per_day: int = 2
    stop_cooldown_minutes: int = 60


@dataclass(frozen=True)
class SignalState:
    theme: str
    symbol: str
    side: Side
    theme_breadth: float
    theme_move_atr: float
    symbol_rank: float
    opening_break_atr: float
    above_session_vwap: bool
    relative_volume: float
    confirmation_bars: int
    atr_pct: float


@dataclass(frozen=True)
class ExecutionState:
    contract_trading: bool
    us_regular_session_confirmed: bool
    new_york_minute: int
    spread_bps: float
    buy_slippage_bps: float
    sell_slippage_bps: float
    expected_round_trip_bps: float
    book_mid_mismatch_bps: float
    depth_inside_10bps_usd: float
    proposed_order_notional_usd: float
    fillable_buy: bool
    fillable_sell: bool
    funding_rate: Optional[float]
    oi_change_pct_15m: Optional[float]
    trading_halt: bool
    company_event_blocked: bool
    macro_event_blocked: bool
    data_complete: bool


@dataclass(frozen=True)
class PositionState:
    side: Side = 0
    gross: float = 0.0
    entries_today: int = 0
    minutes_since_stop: Optional[int] = None
    hard_stop_hit: bool = False
    vwap_failure: bool = False


@dataclass(frozen=True)
class Decision:
    strategy_id: str
    action: Action
    side: Side
    target_gross: float
    stop_distance_pct: float
    allowed: bool
    reason: str
    order_submission_allowed: bool = False


CONFIG = Config()


def stop_distance_pct(signal: SignalState, config: Config = CONFIG) -> float:
    return max(config.minimum_stop_pct, signal.atr_pct * config.stop_atr_multiple)


def risk_capped_gross(signal: SignalState, config: Config = CONFIG) -> float:
    stop_pct = stop_distance_pct(signal, config)
    return min(config.stock_gross_cap, config.account_risk_budget_pct / stop_pct)


def signal_passes(signal: SignalState, config: Config = CONFIG) -> tuple[bool, str]:
    if signal.side not in (-1, 1):
        return False, "NO_DIRECTIONAL_SIGNAL"
    if signal.theme_breadth < config.minimum_theme_breadth:
        return False, "THEME_BREADTH_FAILED"
    if abs(signal.theme_move_atr) < config.minimum_theme_move_atr:
        return False, "THEME_MOVE_TOO_SMALL"
    if signal.relative_volume < config.minimum_relative_volume:
        return False, "RELATIVE_VOLUME_FAILED"
    if abs(signal.opening_break_atr) < config.minimum_opening_break_atr:
        return False, "OPENING_RANGE_BREAK_FAILED"
    if signal.side > 0:
        if signal.symbol_rank < config.long_rank_floor:
            return False, "LONG_RELATIVE_STRENGTH_RANK_FAILED"
        if signal.theme_move_atr <= 0 or signal.opening_break_atr <= 0 or not signal.above_session_vwap:
            return False, "LONG_PRICE_STRUCTURE_FAILED"
    else:
        if signal.symbol_rank > config.short_rank_ceiling:
            return False, "SHORT_RELATIVE_STRENGTH_RANK_FAILED"
        if signal.theme_move_atr >= 0 or signal.opening_break_atr >= 0 or signal.above_session_vwap:
            return False, "SHORT_PRICE_STRUCTURE_FAILED"
    return True, "SIGNAL_PASS"


def execution_passes(execution: ExecutionState, side: Side, config: Config = CONFIG) -> tuple[bool, str]:
    if not execution.data_complete:
        return False, "EXECUTION_DATA_INCOMPLETE"
    if not execution.contract_trading:
        return False, "CONTRACT_NOT_TRADING"
    if execution.trading_halt:
        return False, "TRADING_HALT"
    if not execution.us_regular_session_confirmed:
        return False, "US_REGULAR_SESSION_NOT_CONFIRMED"
    if not (config.entry_start_new_york_minute <= execution.new_york_minute <= config.entry_end_new_york_minute):
        return False, "OUTSIDE_ENTRY_WINDOW"
    if execution.company_event_blocked:
        return False, "COMPANY_EVENT_RISK"
    if execution.macro_event_blocked:
        return False, "MACRO_EVENT_RISK"
    if execution.book_mid_mismatch_bps > config.maximum_book_mid_mismatch_bps:
        return False, "BOOK_MID_INCONSISTENT"
    if execution.spread_bps > config.maximum_spread_bps:
        return False, "SPREAD_TOO_WIDE"
    side_slippage = execution.buy_slippage_bps if side > 0 else execution.sell_slippage_bps
    if side_slippage > config.maximum_one_way_slippage_bps:
        return False, "SLIPPAGE_TOO_HIGH"
    if execution.expected_round_trip_bps > config.maximum_expected_round_trip_bps:
        return False, "ROUND_TRIP_COST_TOO_HIGH"
    if side > 0 and not execution.fillable_buy:
        return False, "BUY_NOT_FILLABLE"
    if side < 0 and not execution.fillable_sell:
        return False, "SELL_NOT_FILLABLE"
    required_depth = execution.proposed_order_notional_usd * config.minimum_depth_to_order_ratio
    if execution.depth_inside_10bps_usd < required_depth:
        return False, "DEPTH_INSUFFICIENT"
    if execution.funding_rate is None:
        return False, "FUNDING_MISSING"
    if abs(execution.funding_rate) > config.maximum_abs_funding_rate:
        return False, "FUNDING_EXTREME"
    if execution.oi_change_pct_15m is None:
        return False, "OPEN_INTEREST_MISSING"
    if execution.oi_change_pct_15m < config.minimum_oi_change_pct:
        return False, "OPEN_INTEREST_CONFIRMATION_FAILED"
    return True, "EXECUTION_PASS"


def decide(
    signal: SignalState,
    execution: ExecutionState,
    position: PositionState = PositionState(),
    config: Config = CONFIG,
) -> Decision:
    stop_pct = stop_distance_pct(signal, config)

    if position.side != 0:
        if execution.trading_halt:
            return Decision(STRATEGY_ID, "EXIT", 0, 0.0, stop_pct, True, "TRADING_HALT_EXIT")
        if execution.new_york_minute >= config.force_exit_new_york_minute:
            return Decision(STRATEGY_ID, "EXIT", 0, 0.0, stop_pct, True, "FORCED_INTRADAY_EXIT")
        if position.hard_stop_hit:
            return Decision(STRATEGY_ID, "EXIT", 0, 0.0, stop_pct, True, "HARD_STOP_EXIT")
        if position.vwap_failure:
            return Decision(STRATEGY_ID, "EXIT", 0, 0.0, stop_pct, True, "VWAP_FAILURE_EXIT")
        if signal.side == -position.side:
            return Decision(STRATEGY_ID, "EXIT", 0, 0.0, stop_pct, True, "OPPOSITE_SIGNAL_EXIT")
        if signal.side == position.side and position.gross < config.stock_gross_cap:
            signal_ok, signal_reason = signal_passes(signal, config)
            execution_ok, execution_reason = execution_passes(execution, signal.side, config)
            if signal_ok and execution_ok and signal.confirmation_bars >= 2:
                maximum = risk_capped_gross(signal, config)
                target = min(maximum, position.gross + config.add_gross_cap, config.stock_gross_cap)
                if target > position.gross + 1e-12:
                    action: Action = "ADD_LONG" if signal.side > 0 else "ADD_SHORT"
                    return Decision(STRATEGY_ID, action, signal.side, target, stop_pct, True, "CONFIRMED_ADD")
            reason = signal_reason if not signal_ok else execution_reason if not execution_ok else "ADD_CONFIRMATION_WAIT"
            return Decision(STRATEGY_ID, "HOLD", position.side, position.gross, stop_pct, True, reason)
        return Decision(STRATEGY_ID, "HOLD", position.side, position.gross, stop_pct, True, "POSITION_HELD")

    if position.entries_today >= config.maximum_entries_per_day:
        return Decision(STRATEGY_ID, "FLAT", 0, 0.0, stop_pct, False, "DAILY_ENTRY_LIMIT")
    if position.minutes_since_stop is not None and position.minutes_since_stop < config.stop_cooldown_minutes:
        return Decision(STRATEGY_ID, "FLAT", 0, 0.0, stop_pct, False, "POST_STOP_COOLDOWN")

    signal_ok, signal_reason = signal_passes(signal, config)
    if not signal_ok:
        return Decision(STRATEGY_ID, "FLAT", 0, 0.0, stop_pct, False, signal_reason)
    execution_ok, execution_reason = execution_passes(execution, signal.side, config)
    if not execution_ok:
        return Decision(STRATEGY_ID, "FLAT", 0, 0.0, stop_pct, False, execution_reason)

    maximum = risk_capped_gross(signal, config)
    target = min(config.initial_gross_cap, maximum)
    if target <= 0:
        return Decision(STRATEGY_ID, "FLAT", 0, 0.0, stop_pct, False, "RISK_SIZE_ZERO")
    action = "ENTER_LONG" if signal.side > 0 else "ENTER_SHORT"
    return Decision(STRATEGY_ID, action, signal.side, target, stop_pct, True, "ENTRY_ALLOWED")


def manifest(config: Config = CONFIG) -> dict:
    return {
        "strategyId": STRATEGY_ID,
        "mode": MODE,
        "architecture": "BACKTESTABLE_PRICE_VOLUME_SIGNAL_PLUS_FORWARD_EXECUTION_GATE",
        "config": asdict(config),
        "directionPolicy": {
            "usesPriceAndVolume": True,
            "newsSelectsDirection": False,
            "microstructureSelectsDirection": False,
            "openInterestSelectsDirection": False,
        },
        "executionPolicy": {
            "confirmedUsRegularSessionOnly": True,
            "noOvernightPosition": True,
            "onePositionAtATime": True,
            "eventDataRole": "RISK_GATE_ONLY",
            "bookConsistencyRequired": True,
            "bothSideFillabilityMeasured": True,
        },
        "portfolio": {
            "stockGrossCap": config.stock_gross_cap,
            "initialGrossCap": config.initial_gross_cap,
            "addGrossCap": config.add_gross_cap,
            "sleeveLending": False,
        },
        "safety": {
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "currentV96CryptoChanged": False,
        },
        "evidenceLimit": {
            "forwardWindowComplete": False,
            "profitabilityApproved": False,
            "independentHoldout": False,
        },
    }


def self_test() -> None:
    signal = SignalState(
        theme="SEMICONDUCTOR",
        symbol="NVDAUSDT",
        side=1,
        theme_breadth=0.70,
        theme_move_atr=0.60,
        symbol_rank=0.90,
        opening_break_atr=0.25,
        above_session_vwap=True,
        relative_volume=1.40,
        confirmation_bars=1,
        atr_pct=1.0,
    )
    execution = ExecutionState(
        contract_trading=True,
        us_regular_session_confirmed=True,
        new_york_minute=11 * 60,
        spread_bps=5.0,
        buy_slippage_bps=6.0,
        sell_slippage_bps=6.0,
        expected_round_trip_bps=24.0,
        book_mid_mismatch_bps=1.0,
        depth_inside_10bps_usd=20_000.0,
        proposed_order_notional_usd=500.0,
        fillable_buy=True,
        fillable_sell=True,
        funding_rate=0.0001,
        oi_change_pct_15m=0.25,
        trading_halt=False,
        company_event_blocked=False,
        macro_event_blocked=False,
        data_complete=True,
    )
    entry = decide(signal, execution)
    assert entry.action == "ENTER_LONG" and entry.target_gross > 0
    wide = decide(signal, ExecutionState(**{**asdict(execution), "spread_bps": 30.0}))
    assert wide.allowed is False and wide.reason == "SPREAD_TOO_WIDE"
    mismatch = decide(signal, ExecutionState(**{**asdict(execution), "book_mid_mismatch_bps": 100.0}))
    assert mismatch.reason == "BOOK_MID_INCONSISTENT"
    held = decide(signal, execution, PositionState(side=1, gross=0.5))
    assert held.action == "HOLD"
    add_signal = SignalState(**{**asdict(signal), "confirmation_bars": 2})
    added = decide(add_signal, execution, PositionState(side=1, gross=0.5))
    assert added.action in ("ADD_LONG", "HOLD")
    forced = decide(signal, ExecutionState(**{**asdict(execution), "new_york_minute": 15 * 60 + 45}), PositionState(side=1, gross=0.5))
    assert forced.action == "EXIT"
    assert manifest()["safety"]["orderSubmissionAllowed"] is False


if __name__ == "__main__":
    self_test()
    print("V96 stock intraday theme-flow V1 self-test: PASS")
