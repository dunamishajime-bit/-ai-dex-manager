from __future__ import annotations

import bisect
from typing import Dict, List, Sequence, Tuple

import research_lab_aster_only_v32_online_ridge_idle_crypto as v32

_INTERVAL_START_CACHE: Dict[int, Tuple[int, ...]] = {}
_INDEX_MAP_CACHE: Dict[int, Dict[str, Dict[int, int]]] = {}


def fast_overlaps(intervals: Sequence[Tuple[int, int, str]], start: int, end: int) -> bool:
    key = id(intervals)
    starts = _INTERVAL_START_CACHE.get(key)
    if starts is None or len(starts) != len(intervals):
        starts = tuple(int(row[0]) for row in intervals)
        _INTERVAL_START_CACHE[key] = starts
    index = bisect.bisect_left(starts, end) - 1
    return index >= 0 and start < int(intervals[index][1])


def cached_index_maps(bars):
    key = id(bars)
    maps = _INDEX_MAP_CACHE.get(key)
    if maps is None:
        maps = {
            symbol: {bar.ts: index for index, bar in enumerate(rows)}
            for symbol, rows in bars.items()
        }
        _INDEX_MAP_CACHE[key] = maps
    return maps


def fast_build_candidate_trades(candidate, predictions, selected_slots, bars, funding, blockers):
    index_maps = cached_index_maps(bars)
    trades: List[dict] = []
    rejected: Dict[str, int] = {}
    active_until = -1

    def reject(reason: str) -> None:
        rejected[reason] = rejected.get(reason, 0) + 1

    for timestamp in selected_slots:
        if timestamp < active_until:
            reject("CANDIDATE_ALREADY_ACTIVE")
            continue
        maximum_exit = timestamp + candidate.maximum_holding_hours * v32.v31.HOUR_MS
        if blockers and fast_overlaps(blockers, timestamp, maximum_exit):
            reject("PRIORITY_OCCUPANCY")
            continue
        panel = predictions.get(timestamp, [])
        if not v32.regime_pass(candidate, panel):
            reject("REGIME")
            continue
        eligible = []
        for row in panel:
            predicted = float(row["predictedBps"])
            rmse = max(1e-9, float(row["rmseBps"]))
            ratio = abs(predicted) / rmse
            edge = abs(predicted) - 0.5 * rmse
            if abs(predicted) < candidate.predicted_threshold_bps:
                continue
            if ratio < candidate.confidence_ratio:
                continue
            if edge - v32.v31.COSTS["NORMAL"] < 10.0:
                continue
            eligible.append((edge, abs(predicted), str(row["symbol"]), predicted, rmse, ratio))
        if not eligible:
            continue
        edge, _strength, symbol, predicted, rmse, ratio = sorted(
            eligible, key=lambda item: (-item[0], -item[1], item[2])
        )[0]
        side = 1 if predicted > 0 else -1
        trade = v32.v31.simulate_trade(
            candidate,
            symbol,
            side,
            edge,
            {
                "modelId": candidate.model_id,
                "predictedBps": predicted,
                "trainingRmseBps": rmse,
                "confidenceRatio": ratio,
                "regime": candidate.regime,
            },
            timestamp,
            bars,
            funding,
            index_maps,
        )
        if trade is None:
            reject("MISSING_FUTURE_BARS")
            continue
        trade["strategy"] = "V32_ONLINE_RIDGE_IDLE_CRYPTO"
        if blockers and fast_overlaps(blockers, int(trade["entryTs"]), int(trade["exitTs"])):
            reject("ACTUAL_PRIORITY_OVERLAP")
            continue
        trades.append(trade)
        active_until = int(trade["exitTs"])
    return trades, rejected


v32.v31.overlaps = fast_overlaps
v32.build_candidate_trades = fast_build_candidate_trades


if __name__ == "__main__":
    raise SystemExit(v32.main())
