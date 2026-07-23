from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Optional

from v96_stock_theme_equal_gross_config import (
    CRYPTO_GROSS_CAP,
    PORTFOLIO_GROSS_CAP,
    STOCK_GROSS_CAP,
)

POLICY_ID = "V96_MARKET_HOURS_STOCK_OVERLAY_V1"


class StockSessionState(str, Enum):
    REGULAR_OPEN = "REGULAR_OPEN"
    PREMARKET = "PREMARKET"
    AFTER_HOURS = "AFTER_HOURS"
    CLOSED = "CLOSED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class OverlayInputs:
    crypto_signal_eligible: bool
    stock_signal_eligible: bool
    stock_session_state: StockSessionState
    crypto_gross_used: float
    stock_gross_used: float
    requested_crypto_gross: float = 0.0
    requested_stock_gross: float = 0.0
    stock_execution_gate_pass: bool = True
    stock_event_gate_pass: bool = True
    stock_contract_trading: bool = True
    session_source: Optional[str] = None


@dataclass(frozen=True)
class OverlayDecision:
    policy_id: str
    allow_crypto_entry: bool
    allow_stock_entry: bool
    crypto_reason: str
    stock_reason: str
    crypto_gross_after: float
    stock_gross_after: float
    portfolio_gross_after: float
    hard_time_slice_enabled: bool
    sleeve_lending_enabled: bool

    def to_dict(self) -> dict:
        return asdict(self)


def _valid_nonnegative(value: float, field: str) -> float:
    number = float(value)
    if number < 0:
        raise ValueError(f"{field} must be non-negative")
    return number


def decide_new_entries(inputs: OverlayInputs) -> OverlayDecision:
    """Apply the frozen equal-gross Market-Hours Stock Overlay policy.

    Crypto eligibility is never disabled by the U.S. stock session. Stock entries
    are additive and are allowed only during a confirmed regular session after
    execution, event-risk and contract-status gates pass. The two sleeves are
    capped independently at Gross 1.0 and may not lend unused Gross to each other.
    """

    crypto_used = _valid_nonnegative(inputs.crypto_gross_used, "crypto_gross_used")
    stock_used = _valid_nonnegative(inputs.stock_gross_used, "stock_gross_used")
    crypto_requested = _valid_nonnegative(inputs.requested_crypto_gross, "requested_crypto_gross")
    stock_requested = _valid_nonnegative(inputs.requested_stock_gross, "requested_stock_gross")

    if crypto_used > CRYPTO_GROSS_CAP + 1e-12:
        raise ValueError("crypto_gross_used exceeds the frozen Crypto sleeve cap")
    if stock_used > STOCK_GROSS_CAP + 1e-12:
        raise ValueError("stock_gross_used exceeds the frozen Stock sleeve cap")

    crypto_capacity = max(0.0, CRYPTO_GROSS_CAP - crypto_used)
    stock_capacity = max(0.0, STOCK_GROSS_CAP - stock_used)

    if not inputs.crypto_signal_eligible:
        allow_crypto = False
        crypto_reason = "NO_ELIGIBLE_CRYPTO_SIGNAL"
    elif crypto_requested <= 0:
        allow_crypto = False
        crypto_reason = "NO_CRYPTO_GROSS_REQUESTED"
    elif crypto_requested > crypto_capacity + 1e-12:
        allow_crypto = False
        crypto_reason = "CRYPTO_SLEEVE_CAP_EXCEEDED"
    else:
        allow_crypto = True
        crypto_reason = "CRYPTO_ALLOWED_24H"

    if not inputs.stock_signal_eligible:
        allow_stock = False
        stock_reason = "NO_ELIGIBLE_STOCK_SIGNAL"
    elif inputs.stock_session_state != StockSessionState.REGULAR_OPEN:
        allow_stock = False
        stock_reason = "US_REGULAR_SESSION_NOT_CONFIRMED"
    elif not inputs.session_source:
        allow_stock = False
        stock_reason = "SESSION_SOURCE_MISSING"
    elif not inputs.stock_contract_trading:
        allow_stock = False
        stock_reason = "STOCK_CONTRACT_NOT_TRADING"
    elif not inputs.stock_execution_gate_pass:
        allow_stock = False
        stock_reason = "STOCK_EXECUTION_GATE_FAILED"
    elif not inputs.stock_event_gate_pass:
        allow_stock = False
        stock_reason = "STOCK_EVENT_GATE_FAILED"
    elif stock_requested <= 0:
        allow_stock = False
        stock_reason = "NO_STOCK_GROSS_REQUESTED"
    elif stock_requested > stock_capacity + 1e-12:
        allow_stock = False
        stock_reason = "STOCK_SLEEVE_CAP_EXCEEDED"
    else:
        allow_stock = True
        stock_reason = "STOCK_OVERLAY_ALLOWED"

    crypto_after = crypto_used + (crypto_requested if allow_crypto else 0.0)
    stock_after = stock_used + (stock_requested if allow_stock else 0.0)
    portfolio_after = crypto_after + stock_after
    if portfolio_after > PORTFOLIO_GROSS_CAP + 1e-12:
        raise AssertionError("independent sleeve decisions exceeded the portfolio Gross cap")

    return OverlayDecision(
        policy_id=POLICY_ID,
        allow_crypto_entry=allow_crypto,
        allow_stock_entry=allow_stock,
        crypto_reason=crypto_reason,
        stock_reason=stock_reason,
        crypto_gross_after=crypto_after,
        stock_gross_after=stock_after,
        portfolio_gross_after=portfolio_after,
        hard_time_slice_enabled=False,
        sleeve_lending_enabled=False,
    )


def self_test() -> None:
    both = decide_new_entries(OverlayInputs(
        crypto_signal_eligible=True,
        stock_signal_eligible=True,
        stock_session_state=StockSessionState.REGULAR_OPEN,
        crypto_gross_used=0.6,
        stock_gross_used=0.4,
        requested_crypto_gross=0.4,
        requested_stock_gross=0.6,
        session_source="EXCHANGE_SESSION_STATUS",
    ))
    assert both.allow_crypto_entry is True
    assert both.allow_stock_entry is True
    assert abs(both.portfolio_gross_after - 2.0) < 1e-12

    crypto_during_closed_stock = decide_new_entries(OverlayInputs(
        crypto_signal_eligible=True,
        stock_signal_eligible=True,
        stock_session_state=StockSessionState.CLOSED,
        crypto_gross_used=0.0,
        stock_gross_used=0.0,
        requested_crypto_gross=1.0,
        requested_stock_gross=1.0,
        session_source="EXCHANGE_SESSION_STATUS",
    ))
    assert crypto_during_closed_stock.allow_crypto_entry is True
    assert crypto_during_closed_stock.allow_stock_entry is False
    assert crypto_during_closed_stock.crypto_reason == "CRYPTO_ALLOWED_24H"

    no_lending = decide_new_entries(OverlayInputs(
        crypto_signal_eligible=True,
        stock_signal_eligible=False,
        stock_session_state=StockSessionState.CLOSED,
        crypto_gross_used=1.0,
        stock_gross_used=0.0,
        requested_crypto_gross=0.1,
        requested_stock_gross=0.0,
    ))
    assert no_lending.allow_crypto_entry is False
    assert no_lending.crypto_reason == "CRYPTO_SLEEVE_CAP_EXCEEDED"

    event_block = decide_new_entries(OverlayInputs(
        crypto_signal_eligible=False,
        stock_signal_eligible=True,
        stock_session_state=StockSessionState.REGULAR_OPEN,
        crypto_gross_used=0.0,
        stock_gross_used=0.0,
        requested_stock_gross=1.0,
        stock_event_gate_pass=False,
        session_source="EXCHANGE_SESSION_STATUS",
    ))
    assert event_block.allow_stock_entry is False
    assert event_block.stock_reason == "STOCK_EVENT_GATE_FAILED"


if __name__ == "__main__":
    self_test()
    print("Market-hours stock overlay policy self-test: PASS")
