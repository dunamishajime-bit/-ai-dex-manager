from __future__ import annotations

from collections import Counter
from typing import Dict, List

import research_lab_aster_only_v33_residual_gross_overlay as v33

_INDEX_MAP_CACHE: Dict[int, Dict[str, Dict[int, int]]] = {}


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


def fast_build_rule_trades(candidate, slots, features, bars, funding, capacity):
    base = v33.RULE_BASE_MAP[candidate.base_candidate_id]
    index_maps = cached_index_maps(bars)
    trades: List[dict] = []
    rejected = Counter()
    active_until = -1
    for timestamp in slots:
        if timestamp < active_until:
            rejected["CANDIDATE_ALREADY_ACTIVE"] += 1
            continue
        maximum_end = timestamp + candidate.maximum_holding_hours * v33.v31.HOUR_MS
        available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(timestamp, maximum_end),
        )
        if available + 1e-12 < v33.MIN_OVERLAY_GROSS:
            rejected["RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        selected = v33.v31.signal(base, features[timestamp])
        if selected is None:
            continue
        symbol, side, edge, detail = selected
        trade = v33.v31.simulate_trade(
            base, symbol, side, edge, detail, timestamp, bars, funding, index_maps
        )
        if trade is None:
            rejected["MISSING_FUTURE_BARS"] += 1
            continue
        actual_available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(int(trade["entryTs"]), int(trade["exitTs"])),
        )
        if actual_available + 1e-12 < v33.MIN_OVERLAY_GROSS:
            rejected["ACTUAL_RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        trades.append(v33.scale_trade(trade, actual_available, "V33_RESIDUAL_RULE_OVERLAY"))
        active_until = int(trade["exitTs"])
    return trades, dict(rejected)


def fast_build_online_trades(candidate, predictions, slots, bars, funding, capacity):
    index_maps = cached_index_maps(bars)
    trades: List[dict] = []
    rejected = Counter()
    active_until = -1
    for timestamp in slots:
        if timestamp < active_until:
            rejected["CANDIDATE_ALREADY_ACTIVE"] += 1
            continue
        maximum_end = timestamp + candidate.maximum_holding_hours * v33.v31.HOUR_MS
        available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(timestamp, maximum_end),
        )
        if available + 1e-12 < v33.MIN_OVERLAY_GROSS:
            rejected["RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        panel = predictions.get(timestamp, [])
        if not v33.regime_pass(candidate, panel):
            rejected["REGIME"] += 1
            continue
        eligible = []
        for row in panel:
            predicted = float(row["predictedBps"])
            rmse = max(1e-9, float(row["rmseBps"]))
            confidence = abs(predicted) / rmse
            edge = abs(predicted) - 0.5 * rmse
            if abs(predicted) < candidate.predicted_threshold_bps:
                continue
            if confidence < candidate.confidence_ratio:
                continue
            if edge - v33.v31.COSTS["NORMAL"] < 10.0:
                continue
            eligible.append((edge, abs(predicted), str(row["symbol"]), predicted, rmse, confidence))
        if not eligible:
            continue
        edge, _strength, symbol, predicted, rmse, confidence = sorted(
            eligible, key=lambda item: (-item[0], -item[1], item[2])
        )[0]
        side = 1 if predicted > 0 else -1
        trade = v33.v31.simulate_trade(
            candidate,
            symbol,
            side,
            edge,
            {
                "modelId": candidate.model_id,
                "predictedBps": predicted,
                "trainingRmseBps": rmse,
                "confidenceRatio": confidence,
                "regime": candidate.regime,
            },
            timestamp,
            bars,
            funding,
            index_maps,
        )
        if trade is None:
            rejected["MISSING_FUTURE_BARS"] += 1
            continue
        actual_available = candidate.maximum_overlay_gross if capacity is None else min(
            candidate.maximum_overlay_gross,
            capacity.minimum_available(int(trade["entryTs"]), int(trade["exitTs"])),
        )
        if actual_available + 1e-12 < v33.MIN_OVERLAY_GROSS:
            rejected["ACTUAL_RESIDUAL_GROSS_BELOW_MINIMUM"] += 1
            continue
        trades.append(v33.scale_trade(trade, actual_available, "V33_RESIDUAL_ONLINE_OVERLAY"))
        active_until = int(trade["exitTs"])
    return trades, dict(rejected)


v33.build_rule_trades = fast_build_rule_trades
v33.build_online_trades = fast_build_online_trades


if __name__ == "__main__":
    raise SystemExit(v33.main())
