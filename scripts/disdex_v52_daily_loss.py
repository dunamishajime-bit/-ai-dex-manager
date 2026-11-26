from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional


def utc_day(now_ms: int) -> str:
    return datetime.fromtimestamp(now_ms / 1000.0, tz=timezone.utc).date().isoformat()


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number and abs(number) != float("inf") else fallback


def update_v52_strategy_daily_latch(
    previous: Optional[Dict[str, Any]],
    trades: Iterable[Dict[str, Any]],
    unrealized_pnl: float,
    strategy_capital_usd: float,
    now_ms: int,
    maximum_daily_loss_pct: float = 3.5,
    data_available: bool = True,
) -> Dict[str, Any]:
    day = utc_day(now_ms)
    capital = max(0.0, _finite(strategy_capital_usd))
    prior = previous if previous and previous.get("utcDay") == day else None
    if previous and previous.get("utcDay") != day:
        prior = None

    if not data_available or capital <= 0:
        return {
            "latchName": "v52StrategyDailyLossLatch",
            "utcDay": day,
            "strategyStartCapitalUsd": capital,
            "realizedPnl": 0.0,
            "unrealizedPnl": 0.0,
            "commission": 0.0,
            "funding": 0.0,
            "deposits": 0.0,
            "withdrawals": 0.0,
            "unattributedDifference": 0.0,
            "lossUsd": 0.0,
            "lossPct": 0.0,
            "lossLimitUsd": capital * maximum_daily_loss_pct / 100.0,
            "tripped": True,
            "failClosed": True,
            "tripReason": "V52 strategy PnL ledger or strategy capital is unavailable.",
            "resetReason": "UTC_DAY_ROLLOVER" if previous and previous.get("utcDay") != day else "DATA_UNAVAILABLE",
            "lastCheckedAt": now_ms,
        }

    # A data-unavailable latch is a safety hold, not a daily-loss decision.  Once
    # the caller has a complete, current data set again, recompute it instead of
    # carrying an old permission/API failure forever.  A real loss trip remains
    # sticky for the UTC day and must not be auto-cleared.
    recovered_from_fail_closed = bool(prior and prior.get("failClosed"))
    if prior and prior.get("tripped") and not recovered_from_fail_closed:
        return {
            **prior,
            "lastCheckedAt": now_ms,
            "failClosed": bool(prior.get("failClosed", False)),
        }

    realized = 0.0
    commission = 0.0
    funding = 0.0
    deposits = 0.0
    withdrawals = 0.0
    for trade in trades:
        # Actual V52 order ledger records exitAt, not closedAt. Never silently
        # re-date an old exit to the current day when the timestamp is absent.
        closed_at = trade.get("closedAt") or trade.get("exitAt") or trade.get("timestamp")
        if not closed_at or utc_day(int(_finite(closed_at))) != day:
            continue
        fee = _finite(trade.get("commission"))
        pnl = _finite(trade.get("realizedPnl"))
        # The legacy V52 close_slot persists realizedPnl net of commission,
        # while the risk latch separately subtracts commission. Normalize
        # only this explicit legacy row shape back to gross to avoid double
        # fee counting; other ledger producers keep gross-PnL semantics.
        legacy_net = bool(trade.get("entryAt") and trade.get("exitAt"))
        realized += pnl + fee if legacy_net else pnl
        commission += fee
        funding += _finite(trade.get("funding"))
        deposits += _finite(trade.get("deposits"))
        withdrawals += _finite(trade.get("withdrawals"))

    unrealized = _finite(unrealized_pnl)
    net_pnl = realized + unrealized - commission + funding + deposits - withdrawals
    loss_usd = max(0.0, -net_pnl)
    loss_limit_usd = capital * max(0.0, maximum_daily_loss_pct) / 100.0
    tripped = loss_limit_usd > 0 and loss_usd >= loss_limit_usd
    return {
        "latchName": "v52StrategyDailyLossLatch",
        "utcDay": day,
        "strategyStartCapitalUsd": capital,
        "realizedPnl": realized,
        "unrealizedPnl": unrealized,
        "commission": commission,
        "funding": funding,
        "deposits": deposits,
        "withdrawals": withdrawals,
        "unattributedDifference": 0.0,
        "lossUsd": loss_usd,
        "lossPct": loss_usd / capital * 100.0 if capital > 0 else 0.0,
        "lossLimitUsd": loss_limit_usd,
        "tripped": tripped,
        "failClosed": False,
        "tripReason": (
            f"V52 strategy daily loss limit reached: {loss_usd:.2f} USD / "
            f"{loss_usd / capital * 100.0:.4f}%. V52 new orders are stopped."
        ) if tripped else None,
        "resetReason": (
            "FAIL_CLOSED_DATA_RECOVERED"
            if recovered_from_fail_closed
            else "UTC_DAY_ROLLOVER"
            if previous and previous.get("utcDay") != day
            else "INITIALIZED"
        ),
        "lastCheckedAt": now_ms,
    }


def update_v52_strategy_daily_flatten(
    previous: Optional[Dict[str, Any]], daily_latch: Optional[Dict[str, Any]], now_ms: int
) -> Dict[str, Any]:
    """Pure persistent V52-only flatten intent. Never infer a loss trip from API failure."""
    day = utc_day(now_ms)
    before = dict(previous) if isinstance(previous, dict) else {}
    if before.get("pending") is True:
        return before  # Survives midnight, restart, and incomplete exits.
    if before.get("tripDay") == day:
        return before  # Already completed today; do not replay old intents.
    tripped = bool(daily_latch and daily_latch.get("tripped") is True)
    verified_loss = bool(daily_latch and daily_latch.get("failClosed") is False)
    current_day = bool(daily_latch and daily_latch.get("utcDay") == day)
    if not (tripped and verified_loss and current_day):
        return before
    return {
        "pending": True,
        "tripDay": day,
        "createdAt": now_ms,
        "completedAt": None,
        "reason": "V52_STRATEGY_DAILY_LOSS_3P5",
    }


def complete_v52_strategy_daily_flatten(intent: Dict[str, Any], now_ms: int) -> Dict[str, Any]:
    """Only invoke after scoped venue exit/cancel and FLAT verification succeeded."""
    if not isinstance(intent, dict) or intent.get("pending") is not True:
        raise ValueError("V52_DAILY_FLATTEN_COMPLETION_WITHOUT_PENDING_INTENT")
    return {**intent, "pending": False, "completedAt": now_ms}
