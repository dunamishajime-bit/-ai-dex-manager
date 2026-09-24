from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class Bar:
    symbol: str
    ts_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Funding:
    symbol: str
    ts_ms: int
    rate: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def coerce_bar(value: Bar | dict[str, Any]) -> Bar:
    if isinstance(value, Bar):
        return value
    return Bar(
        symbol=str(value["symbol"]),
        ts_ms=int(value["ts_ms"]),
        open=float(value["open"]),
        high=float(value["high"]),
        low=float(value["low"]),
        close=float(value["close"]),
        volume=float(value.get("volume", 0.0)),
    )


def coerce_funding(value: Funding | dict[str, Any]) -> Funding:
    if isinstance(value, Funding):
        return value
    return Funding(str(value["symbol"]), int(value["ts_ms"]), float(value["rate"]))

