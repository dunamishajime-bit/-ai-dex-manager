from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v49 as v49
import research_lab_pengu_wave_sleeve_v50 as v50

HOUR = v47.HOUR
PROBE_GROSS = 0.05
FULL_GROSS = 0.15
COOLDOWN_HOURS = 6


@dataclass(frozen=True)
class Candidate:
    side: int
    family: str
    lookback: int
    momentum1h: float
    momentum3h: float
    relative3h: float
    volume_acceleration: float
    volatility_expansion: float
    proximity_atr: float
    extreme_factor: float
    confirmation_move_pct: float
    confirmation_hours: int
    exit_profile: str

    @property
    def candidate_id(self) -> str:
        side_name = "L" if self.side > 0 else "S"
        return (
            f"{side_name}_{self.family}_LB{self.lookback}"
            f"_M1{self.momentum1h:g}_M3{self.momentum3h:g}"
            f"_REL{self.relative3h:g}_VA{self.volume_acceleration:g}"
            f"_VX{self.volatility_expansion:g}_PA{self.proximity_atr:g}"
            f"_XF{self.extreme_factor:g}_CF{self.confirmation_move_pct:g}"
            f"_CH{self.confirmation_hours}_{self.exit_profile}"
        ).replace(".", "p")


def candidate_space(side: int) -> List[Candidate]:
    if side > 0:
        grid = itertools.product(
            ("APPROACH", "ACCEL"),
            (6, 12),
            (0.15, 0.30),
            (0.60, 1.10),
            (0.10, 0.35),
            (0.90, 1.10),
            (0.90, 1.05),
            (0.35, 0.75),
            (1.6, 2.0),
            (0.20, 0.35),
            (2, 3),
            ("FAST", "WIDE"),
        )
    else:
        grid = itertools.product(
            ("APPROACH", "LIQUIDATION"),
            (6, 12),
            (0.25, 0.50),
            (0.80, 1.40),
            (0.10, 0.35),
            (0.90, 1.10),
            (0.90, 1.05),
            (0.35, 0.75),
            (1.5, 1.9),
            (0.20, 0.35),
            (1, 2),
            ("FAST", "WIDE"),
        )
    return [Candidate(side, *row) for row in grid]


def prepare_features(pengu: List[dict], btc: List[dict]) -> dict:
    features = v50.prepare_features(pengu, btc)
    close = features["close"]
    features["sma12"] = v47.rolling_mean(close, 12)
    features["sma24"] = v47.rolling_mean(close, 24)
    features["sma72"] = v47.rolling_mean(close, 72)
    return features


def side_value(side: int, value: float) -> float:
    return side * value


def trend_allows(candidate: Candidate, rows: List[dict], index: int, features: dict) -> bool:
    close = float(rows[index]["close"])
    sma12 = features["sma12"][index]
    sma24 = features["sma24"][index]
    sma72 = features["sma72"][index]
    if sma12 is None or sma24 is None or sma72 is None or index < 6:
        return False
    prior_sma24 = features["sma24"][index - 6]
    if prior_sma24 is None:
        return False
    if candidate.side > 0:
        return bool(close > sma12 and sma12 >= sma24 * 0.995 and sma24 >= prior_sma24 and close > sma72 * 0.965)
    return bool(close < sma12 and (sma12 <= sma24 * 1.005 or close < sma72 * 0.985))


def boundary_and_distance(candidate: Candidate, rows: List[dict], index: int, features: dict) -> tuple[float, float]:
    prior = rows[index - candidate.lookback:index]
    boundary = max(float(row["high"]) for row in prior) if candidate.side > 0 else min(float(row["low"]) for row in prior)
    close = float(rows[index]["close"])
    atr = features["atr24"][index]
    if atr is None or atr <= 0:
        return boundary, 999.0
    distance = (boundary - close) / float(atr) if candidate.side > 0 else (close - boundary) / float(atr)
    return boundary, distance


def arm_signal(candidate: Candidate, rows: List[dict], index: int, features: dict, btc_index: int) -> tuple[bool, bool, float]:
    if index < max(200, candidate.lookback + 2):
        return False, False, 0.0
    m1 = features["mom1"][index]
    m3 = features["mom3"][index]
    relative = features["relative3"][index]
    volume_acceleration = features["volumeAcceleration"][index]
    volatility_expansion = features["volatilityExpansion"][index]
    body_strength = features["bodyStrength"][index]
    direction_count = features["directionCount"][index]
    previous_m1 = features["mom1"][index - 1]
    required = (m1, m3, relative, volume_acceleration, volatility_expansion, body_strength, direction_count, previous_m1)
    if any(value is None for value in required):
        return False, False, 0.0
    if side_value(candidate.side, float(m1)) < candidate.momentum1h:
        return False, False, 0.0
    if side_value(candidate.side, float(m3)) < candidate.momentum3h:
        return False, False, 0.0
    if side_value(candidate.side, float(relative)) < candidate.relative3h:
        return False, False, 0.0
    if float(volume_acceleration) < candidate.volume_acceleration:
        return False, False, 0.0
    if float(volatility_expansion) < candidate.volatility_expansion:
        return False, False, 0.0
    if side_value(candidate.side, float(body_strength)) < 0.15:
        return False, False, 0.0
    if side_value(candidate.side, float(direction_count)) < 1:
        return False, False, 0.0
    if not trend_allows(candidate, rows, index, features):
        return False, False, 0.0
    if not v49.btc_risk_allows(candidate.side, features, btc_index):
        return False, False, 0.0

    boundary, distance_atr = boundary_and_distance(candidate, rows, index, features)
    if distance_atr > candidate.proximity_atr or distance_atr < -0.80:
        return False, False, boundary

    acceleration = side_value(candidate.side, float(m1) - float(previous_m1))
    if candidate.family in ("ACCEL", "LIQUIDATION"):
        required_acceleration = 0.08 if candidate.side > 0 else 0.15
        if acceleration < required_acceleration:
            return False, False, boundary
    else:
        if distance_atr > candidate.proximity_atr * 0.75 and acceleration < 0:
            return False, False, boundary

    extreme = bool(
        distance_atr <= candidate.proximity_atr * 0.35
        and side_value(candidate.side, float(m1)) >= candidate.momentum1h * candidate.extreme_factor
        and side_value(candidate.side, float(m3)) >= candidate.momentum3h * candidate.extreme_factor
        and float(volume_acceleration) >= candidate.volume_acceleration * 1.25
        and float(volatility_expansion) >= candidate.volatility_expansion * 1.10
        and side_value(candidate.side, float(body_strength)) >= 0.55
        and side_value(candidate.side, float(direction_count)) >= 2
    )
    return True, extreme, boundary


def confirmation_index(candidate: Candidate, rows: List[dict], features: dict, signal_index: int, boundary: float) -> Optional[int]:
    signal_close = float(rows[signal_index]["close"])
    progress_threshold = signal_close * (1.0 + candidate.side * candidate.confirmation_move_pct / 100.0)
    end_index = min(signal_index + candidate.confirmation_hours, len(rows) - 2)
    directional_closes = 0
    for cursor in range(signal_index + 1, end_index + 1):
        close = float(rows[cursor]["close"])
        previous = float(rows[cursor - 1]["close"])
        if side_value(candidate.side, close - previous) > 0:
            directional_closes += 1
        boundary_cross = close >= boundary if candidate.side > 0 else close <= boundary
        progress_cross = close >= progress_threshold if candidate.side > 0 else close <= progress_threshold
        current_m1 = features["mom1"][cursor]
        current_relative = features["relative3"][cursor]
        minimum_directional = 1 if candidate.side < 0 else 1
        if (
            (boundary_cross or progress_cross)
            and directional_closes >= minimum_directional
            and current_m1 is not None
            and current_relative is not None
            and side_value(candidate.side, float(current_m1)) >= candidate.momentum1h * 0.45
            and side_value(candidate.side, float(current_relative)) >= candidate.relative3h * 0.25
        ):
            return cursor
    return None


def run_candidate(candidate: Candidate, pengu: List[dict], btc: List[dict], funding: List[dict], features: dict) -> tuple[List[v50.Trade], int]:
    btc_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    trades: List[v50.Trade] = []
    armed_without_order = 0
    next_free_ts = 0
    for index in range(200, len(pengu) - 60):
        ts = int(pengu[index]["ts"])
        if ts < next_free_ts:
            continue
        btc_index = btc_map.get(ts)
        if btc_index is None:
            continue
        armed, extreme, boundary = arm_signal(candidate, pengu, index, features, btc_index)
        if not armed:
            continue
        latest_funding = v47.latest_funding(funding, int(pengu[index]["closeTime"]))
        if candidate.side > 0 and (latest_funding is None or latest_funding > 0.0003):
            continue
        confirmed_at = confirmation_index(candidate, pengu, features, index, boundary)
        trade: Optional[v50.Trade]
        if confirmed_at is not None:
            trade = v50.make_confirmed_trade(candidate, pengu, funding, features, index, confirmed_at, extreme)
        elif extreme:
            trade = v50.make_unconfirmed_probe(candidate, pengu, funding, features, index)
        else:
            armed_without_order += 1
            next_free_ts = ts + candidate.confirmation_hours * HOUR
            continue
        if trade is None:
            continue
        trades.append(trade)
        next_free_ts = trade.exit_ts + COOLDOWN_HOURS * HOUR
    return trades, armed_without_order


def metrics(trades: Iterable[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def fold_bounds(rows: List[dict], count: int = 5) -> List[tuple[int, int]]:
    return v50.fold_bounds(rows, count)


def wave_events(rows: List[dict], horizon_hours: int, threshold_pct: float) -> List[dict]:
    return v50.wave_events(rows, horizon_hours, threshold_pct)


def capture_metrics(trades: List[v50.Trade], events: List[dict], early_hours: int, side: Optional[int] = None) -> dict:
    return v50.capture_metrics(trades, events, early_hours, side)


def events_by_fold(events: List[dict], folds: List[tuple[int, int]]) -> List[List[dict]]:
    return v50.events_by_fold(events, folds)


def candidate_summary(candidate: Candidate, trades: List[v50.Trade], armed_without_order: int, folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> dict:
    fold_metrics = [metrics(trades, start, end) for start, end in folds]
    fold_severe = [metrics(trades, start, end, True) for start, end in folds]
    train_start, train_end = folds[0][0], folds[2][1]
    validation_start, validation_end = folds[3]
    holdout_start, holdout_end = folds[4]
    train = metrics(trades, train_start, train_end)
    train_severe = metrics(trades, train_start, train_end, True)
    validation = metrics(trades, validation_start, validation_end)
    validation_severe = metrics(trades, validation_start, validation_end, True)
    holdout = metrics(trades, holdout_start, holdout_end)
    holdout_severe = metrics(trades, holdout_start, holdout_end, True)
    captures = []
    for index, (start, end) in enumerate(folds):
        fold_trades = [trade for trade in trades if start <= trade.entry_ts < end]
        captures.append({
            "3h3": capture_metrics(fold_trades, proxies["3h3"][index], 2, candidate.side),
            "6h5": capture_metrics(fold_trades, proxies["6h5"][index], 3, candidate.side),
            "12h8": capture_metrics(fold_trades, proxies["12h8"][index], 4, candidate.side),
        })
    names = ("3h3", "6h5", "12h8")
    train_captured = sum(captures[index][name]["capturedEvents"] for index in range(3) for name in names)
    train_early = sum(captures[index][name]["earlyCapturedEvents"] for index in range(3) for name in names)
    validation_events = sum(captures[3][name]["events"] for name in names)
    validation_captured = sum(captures[3][name]["capturedEvents"] for name in names)
    validation_early = sum(captures[3][name]["earlyCapturedEvents"] for name in names)
    positive_train_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_metrics[:3])
    severe_positive_train_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_severe[:3])
    min_train_trades = 8 if candidate.side < 0 else 6
    train_passed = bool(
        train["trades"] >= min_train_trades
        and train["compoundedReturnPct"] > 0
        and (train["profitFactor"] or 0) >= 1.15
        and train["maxDrawdownPct"] >= -5
        and train_severe["compoundedReturnPct"] > 0
        and positive_train_folds >= 2
        and severe_positive_train_folds >= 2
        and train_captured >= 2
        and train_early >= 1
    )
    validation_passed = bool(
        train_passed
        and validation["trades"] >= 2
        and validation["compoundedReturnPct"] > 0
        and (validation["profitFactor"] or 0) >= 1.0
        and validation["maxDrawdownPct"] >= -3
        and validation_severe["compoundedReturnPct"] > 0
        and (validation_events == 0 or (validation_captured >= 1 and validation_early >= 1))
    )
    return {
        "candidate": asdict(candidate),
        "folds": fold_metrics,
        "foldsSevere": fold_severe,
        "captures": captures,
        "train": train,
        "trainSevere": train_severe,
        "validation": validation,
        "validationSevere": validation_severe,
        "holdout": holdout,
        "holdoutSevere": holdout_severe,
        "armedWithoutOrder": armed_without_order,
        "positiveTrainFolds": positive_train_folds,
        "severePositiveTrainFolds": severe_positive_train_folds,
        "trainCapturedEvents": train_captured,
        "trainEarlyCapturedEvents": train_early,
        "validationProxyEvents": validation_events,
        "validationCapturedEvents": validation_captured,
        "validationEarlyCapturedEvents": validation_early,
        "trainPassed": train_passed,
        "validationPassed": validation_passed,
        "trades": [asdict(trade) for trade in trades],
    }


def cluster_key(item: dict) -> tuple:
    c = item["candidate"]
    return (c["side"], c["family"], c["lookback"], c["proximity_atr"], c["confirmation_hours"], c["exit_profile"])


def rank_key(item: dict) -> tuple:
    validation = item["validation"]
    severe = item["validationSevere"]
    train = item["train"]
    return (
        item["validationEarlyCapturedEvents"],
        item["validationCapturedEvents"],
        severe["compoundedReturnPct"],
        validation["compoundedReturnPct"],
        validation["profitFactor"] or 0,
        item["positiveTrainFolds"],
        train["compoundedReturnPct"],
        train["maxDrawdownPct"],
    )


def rebuild_trades(item: Optional[dict]) -> List[v50.Trade]:
    if not item:
        return []
    return [v50.Trade(**row) for row in item["trades"]]


def side_adoption_gate(item: Optional[dict], trades: List[v50.Trade], major24: List[dict], major72: List[dict], side: int) -> tuple[bool, dict]:
    if item is None:
        return False, {"reason": "NO_SELECTED_CANDIDATE"}
    holdout = item["holdout"]
    holdout_severe = item["holdoutSevere"]
    audit24 = capture_metrics(trades, major24, 6, side)
    audit72 = capture_metrics(trades, major72, 12, side)
    total_events = audit24["events"] + audit72["events"]
    early_events = audit24["earlyCapturedEvents"] + audit72["earlyCapturedEvents"]
    profitable_events = audit24["profitableCapturedEvents"] + audit72["profitableCapturedEvents"]
    early_rate = early_events / total_events * 100.0 if total_events else None
    profitable_rate = profitable_events / total_events * 100.0 if total_events else None
    passed = bool(
        holdout["trades"] >= 2
        and holdout["compoundedReturnPct"] > 0
        and holdout_severe["compoundedReturnPct"] > 0
        and (holdout["profitFactor"] or 0) >= 1.05
        and total_events > 0
        and early_rate is not None and early_rate >= 50.0
        and profitable_rate is not None and profitable_rate >= 50.0
    )
    return passed, {
        "holdout": holdout,
        "holdoutSevere": holdout_severe,
        "major24": audit24,
        "major72": audit72,
        "totalMajorEvents": total_events,
        "earlyMajorEvents": early_events,
        "profitableMajorEvents": profitable_events,
        "earlyMajorRatePct": early_rate,
        "profitableMajorRatePct": profitable_rate,
    }


def combine_sides(long_trades: List[v50.Trade], short_trades: List[v50.Trade]) -> List[v50.Trade]:
    return v50.combine_sides(long_trades, short_trades)


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat()


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for V51")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    if len(pengu) < 3000 or len(btc) < 3000:
        raise RuntimeError("Insufficient history")
    features = prepare_features(pengu, btc)
    folds = fold_bounds(pengu, 5)
    proxy_raw = {
        "3h3": wave_events(pengu, 3, 3.0),
        "6h5": wave_events(pengu, 6, 5.0),
        "12h8": wave_events(pengu, 12, 8.0),
    }
    proxies = {name: events_by_fold(events, folds) for name, events in proxy_raw.items()}
    major24 = wave_events(pengu, 24, 20.0)
    major72 = wave_events(pengu, 72, 35.0)

    summaries: Dict[str, dict] = {}
    candidate_counts = {1: 0, -1: 0}
    for side in (-1, 1):
        candidates = candidate_space(side)
        candidate_counts[side] = len(candidates)
        print(f"Evaluating {'Short' if side < 0 else 'Long'} {len(candidates)} candidates")
        for position, candidate in enumerate(candidates, start=1):
            if position % 500 == 0:
                print(f"{'Short' if side < 0 else 'Long'} {position}/{len(candidates)}")
            trades, armed_without_order = run_candidate(candidate, pengu, btc, funding, features)
            summaries[candidate.candidate_id] = candidate_summary(candidate, trades, armed_without_order, folds, proxies)

    cluster_counts: Dict[tuple, int] = {}
    for item in summaries.values():
        if item["validationPassed"]:
            key = cluster_key(item)
            cluster_counts[key] = cluster_counts.get(key, 0) + 1
    eligible_by_side: Dict[int, List[str]] = {1: [], -1: []}
    for candidate_id, item in summaries.items():
        item["validationClusterSize"] = cluster_counts.get(cluster_key(item), 0)
        if item["validationPassed"] and item["validationClusterSize"] >= 2:
            eligible_by_side[int(item["candidate"]["side"])].append(candidate_id)
    for side in (-1, 1):
        eligible_by_side[side].sort(key=lambda key: rank_key(summaries[key]), reverse=True)

    selected_short = eligible_by_side[-1][0] if eligible_by_side[-1] else None
    selected_long = eligible_by_side[1][0] if eligible_by_side[1] else None
    short_item = summaries[selected_short] if selected_short else None
    long_item = summaries[selected_long] if selected_long else None
    short_trades = rebuild_trades(short_item)
    long_trades = rebuild_trades(long_item)
    short_enabled, short_gate = side_adoption_gate(short_item, short_trades, major24, major72, -1)
    long_enabled, long_gate = side_adoption_gate(long_item, long_trades, major24, major72, 1)
    combined = combine_sides(long_trades if long_enabled else [], short_trades if short_enabled else [])

    train_start, train_end = folds[0][0], folds[2][1]
    validation_start, validation_end = folds[3]
    holdout_start, holdout_end = folds[4]
    combined_result = {
        "train": metrics(combined, train_start, train_end),
        "trainSevere": metrics(combined, train_start, train_end, True),
        "validation": metrics(combined, validation_start, validation_end),
        "validationSevere": metrics(combined, validation_start, validation_end, True),
        "holdout": metrics(combined, holdout_start, holdout_end),
        "holdoutSevere": metrics(combined, holdout_start, holdout_end, True),
        "full": metrics(combined, folds[0][0], folds[-1][1]),
        "fullSevere": metrics(combined, folds[0][0], folds[-1][1], True),
        "major24": capture_metrics(combined, major24, 6),
        "major72": capture_metrics(combined, major72, 12),
        "trades": [asdict(trade) for trade in combined],
    }
    status = (
        "SHORT_AND_LONG_ENABLED" if short_enabled and long_enabled
        else "SHORT_ONLY_ENABLED" if short_enabled
        else "LONG_ONLY_ENABLED" if long_enabled
        else "NO_PRODUCTION_CANDIDATE"
    )
    result = rounded({
        "version": 51,
        "strategyId": "PENGU_WAVE_SLEEVE_V51_PREBREAK_SEPARATE",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "basePr": 42,
        "baseCommit": "ec936dfab9d2ec3151a7b7f5b310c4e6d2128784",
        "design": {
            "decisionIntervalHours": 1,
            "longFamilies": ["APPROACH", "ACCEL"],
            "shortFamilies": ["APPROACH", "LIQUIDATION"],
            "longConfirmationHours": [2, 3],
            "shortConfirmationHours": [1, 2],
            "extremeProbeGross": PROBE_GROSS,
            "confirmedGross": FULL_GROSS,
            "ordinarySignalMode": "ARMED_NO_ORDER",
            "longShortSeparate": True,
            "shortPriority": True,
            "holdoutUntouched": True,
        },
        "candidateCounts": {"long": candidate_counts[1], "short": candidate_counts[-1]},
        "folds": [{"start": iso(start), "end": iso(end)} for start, end in folds],
        "eligibleLongCount": len(eligible_by_side[1]),
        "eligibleShortCount": len(eligible_by_side[-1]),
        "selectedLong": selected_long,
        "selectedShort": selected_short,
        "selectedLongResult": long_item,
        "selectedShortResult": short_item,
        "longAdoptionGatePassed": long_enabled,
        "shortAdoptionGatePassed": short_enabled,
        "longGateEvidence": long_gate,
        "shortGateEvidence": short_gate,
        "combinedEnabled": combined_result,
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v51.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU Wave Sleeve V51 Pre-break Separate",
        "",
        f"- Status: **{status}**",
        f"- Selected Long: **{selected_long or 'NONE'}**",
        f"- Selected Short: **{selected_short or 'NONE'}**",
        f"- Eligible Long / Short: {len(eligible_by_side[1])} / {len(eligible_by_side[-1])}",
        f"- Long gate: **{'PASS' if long_enabled else 'FAIL'}**",
        f"- Short gate: **{'PASS' if short_enabled else 'FAIL'}**",
        "",
        "## Long",
        f"- Holdout: {long_gate.get('holdout', {}).get('compoundedReturnPct')}%",
        f"- Holdout Severe: {long_gate.get('holdoutSevere', {}).get('compoundedReturnPct')}%",
        f"- Major early rate: {long_gate.get('earlyMajorRatePct')}%",
        f"- Major profitable rate: {long_gate.get('profitableMajorRatePct')}%",
        "",
        "## Short",
        f"- Holdout: {short_gate.get('holdout', {}).get('compoundedReturnPct')}%",
        f"- Holdout Severe: {short_gate.get('holdoutSevere', {}).get('compoundedReturnPct')}%",
        f"- Major early rate: {short_gate.get('earlyMajorRatePct')}%",
        f"- Major profitable rate: {short_gate.get('profitableMajorRatePct')}%",
        "",
        "## Enabled portfolio",
        f"- Full: {combined_result['full']['compoundedReturnPct']}%",
        f"- Full Severe: {combined_result['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {combined_result['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {combined_result['holdoutSevere']['compoundedReturnPct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-wave-sleeve-v51.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
