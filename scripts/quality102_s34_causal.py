from __future__ import annotations

import re
import statistics
from typing import NamedTuple


class S34Signal(NamedTuple):
    family: str
    variant: str
    side: int
    strength: float
    hold_hours: int
    strength_proven: bool
    volume_gate_proven: bool


class GeneratedS34Signal(NamedTuple):
    entry_index: int
    family: str
    variant: str
    side: int
    strength: float
    hold_hours: int
    strength_proven: bool
    volume_gate_proven: bool


def _close(rows: list[dict], index: int) -> float:
    return float(rows[index]["close"])


def _pb(rows: list[dict], t: int, variant: str) -> S34Signal | None:
    m = re.fullmatch(r"PB(\d+)_([0-9.]+)_P(\d+)_([0-9.]+)_H(\d+)", variant)
    if not m:
        raise ValueError(f"invalid PB variant: {variant}")
    lookback, trend, pullback, pull, hold = int(m[1]), float(m[2]), int(m[3]), float(m[4]), int(m[5])
    if t < max(lookback, pullback):
        return None
    long_ret = _close(rows, t) / _close(rows, t - lookback) - 1.0
    pull_ret = _close(rows, t) / _close(rows, t - pullback) - 1.0
    if long_ret >= trend and pull_ret <= -pull:
        side = 1
    elif long_ret <= -trend and pull_ret >= pull:
        side = -1
    else:
        return None
    return S34Signal("PB", variant, side, abs(long_ret) + abs(pull_ret), hold, True, True)


def _mr(rows: list[dict], t: int, variant: str) -> S34Signal | None:
    m = re.fullmatch(r"MR(\d+)_Z([0-9.]+)_H(\d+)", variant)
    if not m:
        raise ValueError(f"invalid MR variant: {variant}")
    lookback, threshold, hold = int(m[1]), float(m[2]), int(m[3])
    if t - lookback + 1 < 0:
        return None
    closes = [_close(rows, i) for i in range(t - lookback + 1, t + 1)]
    std = statistics.stdev(closes)
    if std == 0:
        return None
    z = (_close(rows, t) - statistics.mean(closes)) / std
    if z >= threshold:
        side = -1
    elif z <= -threshold:
        side = 1
    else:
        return None
    return S34Signal("MR", variant, side, abs(z), hold, True, True)


def _rev(rows: list[dict], t: int, variant: str) -> S34Signal | None:
    m = re.fullmatch(r"REV(\d+)_T([0-9.]+)_H(\d+)", variant)
    if not m:
        raise ValueError(f"invalid REV variant: {variant}")
    lookback, threshold, hold = int(m[1]), float(m[2]), int(m[3])
    if t < lookback:
        return None
    ret = _close(rows, t) / _close(rows, t - lookback) - 1.0
    if ret >= threshold:
        side = -1
    elif ret <= -threshold:
        side = 1
    else:
        return None
    return S34Signal("REV", variant, side, abs(ret), hold, True, True)


def _brk(rows: list[dict], t: int, variant: str) -> S34Signal | None:
    m = re.fullmatch(r"BRK(\d+)_H(\d+)_V([0-9.]+)", variant)
    if not m:
        raise ValueError(f"invalid BRK variant: {variant}")
    lookback, hold = int(m[1]), int(m[2])
    if t < lookback:
        return None
    prior = rows[t - lookback:t]
    close = _close(rows, t)
    prior_high = max(float(x["high"]) for x in prior)
    prior_low = min(float(x["low"]) for x in prior)
    if close > prior_high:
        side = 1
    elif close < prior_low:
        side = -1
    else:
        return None
    diagnostic_strength = abs(close / _close(rows, t - lookback) - 1.0)
    return S34Signal("BRK", variant, side, diagnostic_strength, hold, False, False)


def detect_signal(rows: list[dict], signal_index: int, variant: str) -> S34Signal | None:
    if variant.startswith("PB"):
        return _pb(rows, signal_index, variant)
    if variant.startswith("MR"):
        return _mr(rows, signal_index, variant)
    if variant.startswith("REV"):
        return _rev(rows, signal_index, variant)
    if variant.startswith("BRK"):
        return _brk(rows, signal_index, variant)
    raise ValueError(f"unsupported S34 variant: {variant}")


V4_REV_LONG_RET14_MIN = 0.24


def passes_v4_improvement_gate(family: str, side: int, ret14: float) -> bool:
    if side not in (-1, 1):
        raise ValueError(f"invalid side: {side}")
    if family == "REV" and side == 1:
        return float(ret14) >= V4_REV_LONG_RET14_MIN
    return True


def generate_signals(rows: list[dict], variant: str) -> list[GeneratedS34Signal]:
    out: list[GeneratedS34Signal] = []
    for entry_index in range(1, len(rows)):
        entry_ts = str(rows[entry_index]["timestamp"])
        hour = int(entry_ts[11:13])
        if hour % 4 != 1:
            continue
        signal = detect_signal(rows, entry_index - 1, variant)
        if signal is None:
            continue
        out.append(GeneratedS34Signal(
            entry_index=entry_index,
            family=signal.family,
            variant=signal.variant,
            side=signal.side,
            strength=signal.strength,
            hold_hours=signal.hold_hours,
            strength_proven=signal.strength_proven,
            volume_gate_proven=signal.volume_gate_proven,
        ))
    return out
