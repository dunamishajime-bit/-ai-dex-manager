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

    if prior and prior.get("tripped"):
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
        if utc_day(int(_finite(trade.get("closedAt") or trade.get("timestamp") or now_ms))) != day:
            continue
        realized += _finite(trade.get("realizedPnl"))
        commission += _finite(trade.get("commission"))
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
        "resetReason": "UTC_DAY_ROLLOVER" if previous and previous.get("utcDay") != day else "INITIALIZED",
        "lastCheckedAt": now_ms,
    }
