from __future__ import annotations

from bisect import bisect_right

import research_lab_pengu_dual_engine_v39 as v39

_FUNDING_TIMES: list[int] = []
_FUNDING_RATES: list[float] = []


def fast_latest_funding(points: list[dict], ts: int) -> float:
    global _FUNDING_TIMES, _FUNDING_RATES
    if not _FUNDING_TIMES:
        _FUNDING_TIMES = [int(row["ts"]) for row in points]
        _FUNDING_RATES = [float(row["rate"]) for row in points]
    index = bisect_right(_FUNDING_TIMES, ts) - 1
    return _FUNDING_RATES[index] if index >= 0 else 0.0


def focused_exits() -> list[v39.ExitSpec]:
    return [
        v39.ExitSpec("TIME24", 24),
        v39.ExitSpec("TIME48", 48),
        v39.ExitSpec("ATR3_SL1p5_H48", 48, 3.0, 1.5),
        v39.ExitSpec("ATR4_SL2_H72", 72, 4.0, 2.0),
    ]


def focused_long_rules() -> list[v39.Rule]:
    result: list[v39.Rule] = []
    for exit_spec in focused_exits():
        for fast in [12, 24]:
            for slow in [72, 168]:
                for threshold in [1.0, 2.0]:
                    for volume in [0.8, 1.0]:
                        for btc_filter in ["DIRECTION", "RISK"]:
                            result.append(v39.Rule(1, "TREND", fast, slow, threshold, 0.0, volume, 0.0008, btc_filter, exit_spec))
        for confirm in [6, 12]:
            for lookback in [24, 48]:
                for threshold in [0.0, 0.5]:
                    for volume in [0.8, 1.0]:
                        for btc_filter in ["DIRECTION", "RISK"]:
                            result.append(v39.Rule(1, "BREAKOUT", confirm, lookback, threshold, 0.0, volume, 0.0008, btc_filter, exit_spec))
    return result


def focused_short_rules() -> list[v39.Rule]:
    result: list[v39.Rule] = []
    for exit_spec in focused_exits():
        for confirm in [6, 12]:
            for lookback in [24, 48]:
                for threshold in [0.0, 0.5]:
                    for volume in [0.8, 1.0]:
                        for btc_filter in ["DIRECTION", "RISK"]:
                            result.append(v39.Rule(-1, "BREAKDOWN", confirm, lookback, threshold, 0.0, volume, 0.0, btc_filter, exit_spec))
        for slow in [72, 168]:
            for rsi_threshold in [65.0, 70.0]:
                for distance in [6.0, 10.0]:
                    for funding_floor in [0.0, 0.0001]:
                        for btc_filter in ["NONE", "RISK"]:
                            result.append(v39.Rule(-1, "EXHAUST", 14, slow, rsi_threshold, distance, 0.0, funding_floor, btc_filter, exit_spec))
    return result


v39.latest_funding = fast_latest_funding
v39.long_rules = focused_long_rules
v39.short_rules = focused_short_rules

if __name__ == "__main__":
    v39.main()
