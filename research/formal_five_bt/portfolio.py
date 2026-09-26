"""Audited LIVE shared allocation and contribution accounting helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any, Iterable, Mapping, Sequence

from .market_data import FxRate, deposit_usdt
from .strategies import RuntimeBridge


@dataclass(frozen=True, slots=True)
class DepositEvent:
    timestamp_ms: int
    amount_jpy: float
    amount_usdt: float
    fx_rate_jpy_per_usd: float
    fx_timestamp_ms: int
    fx_sha256: str
    cumulative_jpy: float
    cumulative_usdt: float


def monthly_deposit_events(
    fx_series: Iterable[FxRate],
    *,
    start_date: date = date(2025, 8, 10),
    initial_jpy: float = 10_000,
    monthly_jpy: float = 10_000,
    months: int = 12,
) -> tuple[DepositEvent, ...]:
    """Convert one initial and ``months`` anniversary deposits as-of FRED data."""
    if months < 0:
        raise ValueError("months cannot be negative")
    events: list[tuple[datetime, float]] = [(datetime.combine(start_date, time(), timezone.utc), initial_jpy)]
    year, month = start_date.year, start_date.month
    for _ in range(months):
        month += 1
        if month > 12:
            year, month = year + 1, 1
        # Match the monthly anniversary day, clamping only if a future caller
        # chooses a day that the target month does not contain.
        import calendar
        day = min(start_date.day, calendar.monthrange(year, month)[1])
        events.append((datetime(year, month, day, tzinfo=timezone.utc), monthly_jpy))

    cumulative_jpy = 0.0
    cumulative_usdt = 0.0
    result: list[DepositEvent] = []
    rates = tuple(fx_series)
    for at, amount in events:
        converted = deposit_usdt(amount, at, rates)
        cumulative_jpy += amount
        cumulative_usdt += converted.amount_usdt
        result.append(DepositEvent(
            timestamp_ms=int(at.timestamp() * 1000), amount_jpy=amount,
            amount_usdt=converted.amount_usdt, fx_rate_jpy_per_usd=converted.rate_jpy_per_usd,
            fx_timestamp_ms=converted.rate_time_ms, fx_sha256=converted.rate_sha256,
            cumulative_jpy=cumulative_jpy, cumulative_usdt=cumulative_usdt,
        ))
    return tuple(result)


def build_live_intent(
    *,
    strategy: str,
    symbol: str,
    side: str,
    gross: float,
    equity_usd: float,
    signal_time_ms: int,
    idempotency_key: str,
) -> dict[str, Any]:
    strategy = strategy.strip().upper()
    symbol = symbol.strip().upper()
    side = side.strip().upper()
    if side not in {"LONG", "SHORT"} or not idempotency_key.strip():
        raise ValueError("invalid intent side or idempotency key")
    if gross <= 0 or equity_usd <= 0 or signal_time_ms <= 0:
        raise ValueError("invalid intent sizing or timestamp")
    return {
        "idempotencyKey": idempotency_key,
        "strategy": strategy,
        "symbol": symbol,
        "side": side,
        "gross": float(gross),
        "requestedGross": float(gross),
        "notionalUsd": float(gross) * float(equity_usd),
        "signalTs": int(signal_time_ms),
    }


def plan_with_live_allocator(
    bridge: RuntimeBridge,
    *,
    equity_usd: float,
    now_ms: int,
    intents: Sequence[Mapping[str, Any]],
    active_positions: Sequence[Mapping[str, Any]] = (),
    quality102_causal_ready: bool = False,
    shared_daily_risk: Mapping[str, Any] | None = None,
    dd_governor: Mapping[str, Any] | None = None,
    available_balance_usd: float | None = None,
) -> Mapping[str, Any]:
    """Call the audited TypeScript planner; do not reimplement its cap/rank rules."""
    if now_ms <= 0 or equity_usd <= 0:
        raise ValueError("portfolio equity and as-of time must be positive")
    if available_balance_usd is None:
        available_balance_usd = equity_usd
    if available_balance_usd < 0:
        raise ValueError("available balance cannot be negative")
    input_value: dict[str, Any] = {
        "equity": float(equity_usd),
        "now": int(now_ms),
        "active": list(active_positions),
        "intents": [dict(intent) for intent in intents],
        "quality102CausalV1Ready": bool(quality102_causal_ready),
        "availableBalanceUsd": float(available_balance_usd),
        "entryGrossCaps": {"cryptoGrossCap": 3.0, "totalGrossCap": 4.25},
    }
    if shared_daily_risk is not None:
        input_value["sharedDailyRisk"] = dict(shared_daily_risk)
    if dd_governor is not None:
        input_value["portfolioDdGovernor"] = dict(dd_governor)
    return bridge.plan_strict_portfolio(input_value)
