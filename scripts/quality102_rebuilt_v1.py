from __future__ import annotations

from statistics import fmean, pstdev
from typing import Any, Mapping, Sequence

SELECTOR_ID = "QUALITY102_REBUILT_V1"
MAX_QUALITY_GROSS = 0.50
FORBIDDEN_SELECTOR_FIELDS = (
    "normal_net",
    "stress_net",
    "exit",
    "exit_reason",
    "duration_hours",
    "ret14",
)

FAMILY_HOLD_HOURS = {
    "BRK": 72,
    "PB": 72,
    "HIGH_VOL": 48,
    "REV": 48,
    "MR": 48,
}


def _ret(closes: Sequence[float], periods: int) -> float:
    if len(closes) <= periods or closes[-periods - 1] <= 0.0:
        return 0.0
    return closes[-1] / closes[-periods - 1] - 1.0


def _rsi(closes: Sequence[float], periods: int = 14) -> float:
    if len(closes) < periods + 1:
        return 50.0
    gains: list[float] = []
    losses: list[float] = []
    for before, after in zip(closes[-periods - 1 : -1], closes[-periods:]):
        delta = after - before
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    avg_gain = fmean(gains)
    avg_loss = fmean(losses)
    if avg_loss <= 1e-15:
        return 100.0 if avg_gain > 0.0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def _features(rows: Sequence[Mapping[str, float]], index: int) -> dict[str, float] | None:
    history = rows[: index + 1]
    closes = [float(row["close"]) for row in history]
    volumes = [float(row.get("volume", 0.0) or 0.0) for row in history]
    if len(closes) < 73:
        return None

    close = closes[-1]
    sma24 = fmean(closes[-24:])
    sma72 = fmean(closes[-72:])
    prior24_close_high = max(closes[-25:-1])
    prior12_close_high = max(closes[-13:-1])
    prior12_close_low = min(closes[-13:-1])

    hourly_returns = [
        closes[j] / closes[j - 1] - 1.0
        for j in range(max(1, len(closes) - 24), len(closes))
        if closes[j - 1] > 0.0
    ]
    vol24 = pstdev(hourly_returns) if len(hourly_returns) > 1 else 0.0
    volume_base = fmean(volumes[-24:]) if volumes[-24:] else 0.0
    volume_ratio = volumes[-1] / volume_base if volume_base > 0.0 else 1.0

    return {
        "close": close,
        "sma24": sma24,
        "sma72": sma72,
        "r12": _ret(closes, 12),
        "r24": _ret(closes, 24),
        "r72": _ret(closes, 72),
        "rsi14": _rsi(closes),
        "vol24": vol24,
        "volume_ratio": volume_ratio,
        "prior24_close_high": prior24_close_high,
        "prior12_close_high": prior12_close_high,
        "prior12_close_low": prior12_close_low,
    }


def _classify(features: Mapping[str, float]) -> tuple[str, float, str] | None:
    candidates: list[tuple[str, float, str]] = []

    if (
        features["close"] > features["prior24_close_high"] * 1.001
        and features["r24"] > 0.025
        and features["close"] > features["sma72"]
    ):
        score = (
            72.0
            + min(18.0, features["r24"] * 100.0)
            + min(8.0, max(0.0, features["volume_ratio"] - 1.0) * 10.0)
        )
        candidates.append(("BRK", score, "BRK_QUALITY_GATE"))

    if (
        features["r72"] > 0.045
        and features["close"] > features["sma72"]
        and features["close"] <= features["prior12_close_high"] * 0.995
        and features["r12"] > -0.04
    ):
        score = (
            68.0
            + min(18.0, features["r72"] * 70.0)
            + max(0.0, (55.0 - features["rsi14"]) * 0.2)
        )
        candidates.append(("PB", score, "PB_CAUSAL_PULLBACK"))

    if (
        features["vol24"] >= 0.007
        and features["r12"] > 0.01
        and features["close"] > features["sma24"]
    ):
        score = (
            66.0
            + min(20.0, features["vol24"] * 1000.0)
            + min(10.0, features["r12"] * 100.0)
        )
        candidates.append(("HIGH_VOL", score, "HV_TRIGGER12_TRAIL5"))

    if features["r12"] > 0.025 and features["r24"] < 0.01 and features["rsi14"] < 65.0:
        score = (
            65.0
            + min(20.0, features["r12"] * 200.0)
            + max(0.0, (55.0 - features["rsi14"]) * 0.3)
        )
        candidates.append(("REV", score, "REV_CAUSAL_12H"))

    if (
        features["rsi14"] < 38.0
        and features["close"] > features["prior12_close_low"] * 1.005
        and features["r12"] > -0.025
    ):
        score = (
            64.0
            + min(18.0, (38.0 - features["rsi14"]) * 0.8)
            + min(10.0, max(0.0, features["r12"]) * 200.0)
        )
        candidates.append(("MR", score, "MR_REGIME_GATE"))

    if not candidates:
        return None
    return max(candidates, key=lambda item: (item[1], item[0]))


def _layer(score: float) -> str:
    if score >= 90.0:
        return "S4"
    if score >= 82.0:
        return "S3"
    if score >= 74.0:
        return "S2"
    return "S1"


def select_candidates(
    symbol_bars: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    start_ms: int,
    end_ms: int,
) -> list[dict[str, Any]]:
    """Select one-slot Quality candidates using only information known at entry."""
    if end_ms <= start_ms:
        return []

    prepared: dict[str, list[dict[str, float]]] = {}
    for raw_symbol in sorted(symbol_bars):
        rows: list[dict[str, float]] = []
        for raw in symbol_bars[raw_symbol]:
            ts = int(raw["ts"])
            if ts >= end_ms:
                continue
            if not all(key in raw for key in ("open", "high", "low", "close")):
                continue
            rows.append(
                {
                    "ts": float(ts),
                    "open": float(raw["open"]),
                    "high": float(raw["high"]),
                    "low": float(raw["low"]),
                    "close": float(raw["close"]),
                    "volume": float(raw.get("volume", 0.0) or 0.0),
                }
            )
        rows.sort(key=lambda row: row["ts"])
        if rows:
            prepared[str(raw_symbol).upper()] = rows

    by_ts: dict[int, list[tuple[str, int]]] = {}
    for symbol, rows in prepared.items():
        for index, row in enumerate(rows):
            ts = int(row["ts"])
            if ts < start_ms:
                continue
            by_ts.setdefault(ts, []).append((symbol, index))

    selected: list[dict[str, Any]] = []
    next_allowed_ms = int(start_ms)
    for ts in sorted(by_ts):
        if ts < next_allowed_ms:
            continue

        choices: list[tuple[float, str, str, str]] = []
        for symbol, index in sorted(by_ts[ts]):
            features = _features(prepared[symbol], index)
            if features is None:
                continue
            classified = _classify(features)
            if classified is None:
                continue
            family, score, stage = classified
            choices.append((score, symbol, family, stage))

        if not choices:
            continue

        score, symbol, family, stage = max(
            choices,
            key=lambda item: (item[0], item[1], item[2], item[3]),
        )
        hold_hours = int(FAMILY_HOLD_HOURS[family])
        selected.append(
            {
                "selector_id": SELECTOR_ID,
                "entry_ms": int(ts),
                "symbol": symbol,
                "side": "long",
                "family": family,
                "stage": stage,
                "layer": _layer(score),
                "score": round(float(score), 8),
                "strength": round(min(1.0, max(0.0, (score - 60.0) / 40.0)), 8),
                "hold_hours": hold_hours,
                "requested_gross": MAX_QUALITY_GROSS,
            }
        )
        next_allowed_ms = int(ts) + hold_hours * 3_600_000

    return selected
