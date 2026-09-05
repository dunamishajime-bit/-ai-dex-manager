from __future__ import annotations

import re
from typing import NamedTuple


class Signal(NamedTuple):
    side: int
    strength: float
    lookback: int
    hold_hours: int
    volume_tag: float


class ExitResult(NamedTuple):
    exit_index: int
    gross: float
    reason: str


def parse_variant(variant: str) -> tuple[int, int, float]:
    m = re.fullmatch(r"BRK(\d+)_H(\d+)_V([0-9.]+)", variant)
    if not m:
        raise ValueError(f"invalid BRK variant: {variant}")
    return int(m.group(1)), int(m.group(2)), float(m.group(3))


def detect_signal(rows: list[dict], signal_index: int, variant: str) -> Signal | None:
    lookback, hold_hours, volume_tag = parse_variant(variant)
    if signal_index < lookback or signal_index + 1 >= len(rows):
        return None
    prior = rows[signal_index - lookback:signal_index]
    current = rows[signal_index]
    close = float(current["close"])
    prior_high = max(float(x["high"]) for x in prior)
    prior_low = min(float(x["low"]) for x in prior)
    if close > prior_high:
        side = 1
    elif close < prior_low:
        side = -1
    else:
        return None
    base_close = float(rows[signal_index - lookback]["close"])
    strength = abs(close / base_close - 1.0)
    return Signal(side, strength, lookback, hold_hours, volume_tag)


def simulate_exit(rows: list[dict], entry_index: int, side: int, hold_hours: int) -> ExitResult:
    entry = float(rows[entry_index]["open"])
    stop = 0.08 if hold_hours >= 48 else 0.05
    last = min(entry_index + hold_hours, len(rows) - 1)
    for i in range(entry_index, last):
        high = float(rows[i]["high"])
        low = float(rows[i]["low"])
        if side == 1 and low <= entry * (1.0 - stop):
            return ExitResult(i + 1, -stop, "stop")
        if side == -1 and high >= entry * (1.0 + stop):
            return ExitResult(i + 1, -stop, "stop")
    exit_close = float(rows[last - 1]["close"])
    gross = side * (exit_close / entry - 1.0)
    return ExitResult(last, gross, "time")




class GeneratedSignal(NamedTuple):
    entry_index: int
    side: int
    strength: float
    variant: str


def generate_signals(rows: list[dict], variant: str) -> list[GeneratedSignal]:
    lookback, _, _ = parse_variant(variant)
    out: list[GeneratedSignal] = []
    for entry_index in range(lookback + 1, len(rows)):
        entry_ts = str(rows[entry_index]["timestamp"])
        hour = int(entry_ts[11:13])
        if hour % 4 != 1:
            continue
        signal = detect_signal(rows, entry_index - 1, variant)
        if signal is not None:
            out.append(GeneratedSignal(entry_index, signal.side, signal.strength, variant))
    return out
