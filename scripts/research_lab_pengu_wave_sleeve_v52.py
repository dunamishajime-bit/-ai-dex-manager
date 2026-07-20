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
    trigger1: float
    trigger3: float
    context: float
    volume_threshold: float
    volatility_threshold: float
    distance_atr: float
    confirmation_move_pct: float
    confirmation_hours: int
    exit_profile: str

    @property
    def candidate_id(self) -> str:
        side_name = "L" if self.side > 0 else "S"
        return (
            f"{side_name}_{self.family}_LB{self.lookback}"
            f"_T1{self.trigger1:g}_T3{self.trigger3:g}_CTX{self.context:g}"
            f"_VOL{self.volume_threshold:g}_VX{self.volatility_threshold:g}"
            f"_DA{self.distance_atr:g}_CF{self.confirmation_move_pct:g}"
            f"_CH{self.confirmation_hours}_{self.exit_profile}"
        ).replace(".", "p")


def candidate_space(side: int) -> List[Candidate]:
    result: List[Candidate] = []
    if side > 0:
        for row in itertools.product(
            (6,), (0.4, 0.8), (1.5, 3.0), (0.0,),
            (0.3, 0.8), (0.4, 0.8), (9.0,),
            (0.2, 0.4), (1, 2), ("FAST", "WIDE"),
        ):
            result.append(Candidate(1, "REVERSAL", *row))
        for row in itertools.product(
            (6, 12), (0.2, 0.5), (0.3, 0.8), (0.0,),
            (0.4, 0.8), (0.6, 0.9), (0.3, 0.6),
            (0.2, 0.4), (2, 3), ("FAST", "WIDE"),
        ):
            result.append(Candidate(1, "COMPRESSION", *row))
    else:
        for row in itertools.product(
            (6, 12), (0.8, 1.5), (1.5, 2.5), (0.0,),
            (0.8, 1.2), (0.7, 1.0), (1.0,),
            (0.2, 0.4), (1, 2), ("FAST", "WIDE"),
        ):
            result.append(Candidate(-1, "FLASH", *row))
        for row in itertools.product(
            (6, 12), (0.3, 0.7), (0.5, 1.2), (1.5, 2.0),
            (0.5,), (0.6,), (0.5, 1.0),
            (0.2, 0.4), (1, 2), ("FAST", "WIDE"),
        ):
            result.append(Candidate(-1, "DISTRIBUTION", *row))
    return result


def prepare_features(pengu: List[dict], btc: List[dict]) -> dict:
    features = v50.prepare_features(pengu, btc)
    close = features["close"]
    features["sma12"] = v47.rolling_mean(close, 12)
    features["sma24"] = v47.rolling_mean(close, 24)
    features["sma72"] = v47.rolling_mean(close, 72)
    return features


def boundary(rows: List[dict], index: int, lookback: int, side: int) -> float:
    prior = rows[index - lookback:index]
    return max(float(row["high"]) for row in prior) if side > 0 else min(float(row["low"]) for row in prior)


def distance_atr(rows: List[dict], index: int, lookback: int, side: int, features: dict) -> float:
    b = boundary(rows, index, lookback, side)
    close = float(rows[index]["close"])
    atr = features["atr24"][index]
    if atr is None or atr <= 0:
        return 999.0
    return (b - close) / atr if side > 0 else (close - b) / atr


def side_value(side: int, value: float) -> float:
    return side * value


def long_reversal_signal(candidate: Candidate, rows: List[dict], index: int, features: dict) -> tuple[bool, bool, float]:
    m1 = features["mom1"][index]
    prior_m3 = features["mom3"][index - 1]
    volume = features["volumeAcceleration"][index]
    volatility = features["volatilityExpansion"][index]
    body = features["bodyStrength"][index]
    if any(value is None for value in (m1, prior_m3, volume, volatility, body)):
        return False, False, 0.0
    if float(m1) < candidate.trigger1 or float(prior_m3) > -candidate.trigger3:
        return False, False, 0.0
    if float(volume) < candidate.volume_threshold or float(volatility) < candidate.volatility_threshold:
        return False, False, 0.0
    if float(body) < 0.15:
        return False, False, 0.0
    b = boundary(rows, index, candidate.lookback, 1)
    extreme = bool(
        float(m1) >= max(1.2, candidate.trigger1 * 2.0)
        and float(volume) >= max(1.2, candidate.volume_threshold * 1.5)
        and float(volatility) >= max(1.0, candidate.volatility_threshold * 1.25)
        and float(body) >= 0.65
    )
    return True, extreme, b


def long_compression_signal(candidate: Candidate, rows: List[dict], index: int, features: dict) -> tuple[bool, bool, float]:
    m1 = features["mom1"][index]
    m3 = features["mom3"][index]
    volume = features["volumeAcceleration"][index]
    volatility = features["volatilityExpansion"][index]
    body = features["bodyStrength"][index]
    if any(value is None for value in (m1, m3, volume, volatility, body)):
        return False, False, 0.0
    if float(m1) < candidate.trigger1 or float(m3) < candidate.trigger3:
        return False, False, 0.0
    if float(volume) > candidate.volume_threshold or float(volatility) > candidate.volatility_threshold:
        return False, False, 0.0
    if float(body) < 0.10:
        return False, False, 0.0
    distance = distance_atr(rows, index, candidate.lookback, 1, features)
    if distance > candidate.distance_atr or distance < -0.50:
        return False, False, 0.0
    b = boundary(rows, index, candidate.lookback, 1)
    return True, False, b


def short_flash_signal(candidate: Candidate, rows: List[dict], index: int, features: dict) -> tuple[bool, bool, float]:
    m1 = features["mom1"][index]
    m3 = features["mom3"][index]
    relative = features["relative3"][index]
    volume = features["volumeAcceleration"][index]
    volatility = features["volatilityExpansion"][index]
    body = features["bodyStrength"][index]
    if any(value is None for value in (m1, m3, relative, volume, volatility, body)):
        return False, False, 0.0
    if -float(m1) < candidate.trigger1 or -float(m3) < candidate.trigger3:
        return False, False, 0.0
    if -float(relative) < 0.1:
        return False, False, 0.0
    if float(volume) < candidate.volume_threshold or float(volatility) < candidate.volatility_threshold:
        return False, False, 0.0
    if -float(body) < 0.45:
        return False, False, 0.0
    b = boundary(rows, index, candidate.lookback, -1)
    extreme = bool(
        -float(m1) >= max(2.0, candidate.trigger1 * 1.8)
        and float(volume) >= max(1.5, candidate.volume_threshold * 1.25)
        and float(volatility) >= max(1.0, candidate.volatility_threshold)
        and -float(body) >= 0.75
    )
    return True, extreme, b


def short_distribution_signal(candidate: Candidate, rows: List[dict], index: int, features: dict) -> tuple[bool, bool, float]:
    m1 = features["mom1"][index]
    m3 = features["mom3"][index]
    body = features["bodyStrength"][index]
    if any(value is None for value in (m1, m3, body)) or index < 3:
        return False, False, 0.0
    prior_volumes = [features["volumeAcceleration"][cursor] for cursor in range(index - 3, index)]
    valid_prior = [float(value) for value in prior_volumes if value is not None]
    if len(valid_prior) < 2 or statistics.fmean(valid_prior) < candidate.context:
        return False, False, 0.0
    if -float(m1) < candidate.trigger1 or -float(m3) < candidate.trigger3 or -float(body) < 0.20:
        return False, False, 0.0
    distance = distance_atr(rows, index, candidate.lookback, -1, features)
    if distance > candidate.distance_atr or distance < -0.75:
        return False, False, 0.0
    b = boundary(rows, index, candidate.lookback, -1)
    return True, False, b


def signal(candidate: Candidate, rows: List[dict], index: int, features: dict, btc_index: int) -> tuple[bool, bool, float]:
    if index < 200:
        return False, False, 0.0
    if not v49.btc_risk_allows(candidate.side, features, btc_index):
        return False, False, 0.0
    if candidate.family == "REVERSAL":
        return long_reversal_signal(candidate, rows, index, features)
    if candidate.family == "COMPRESSION":
        return long_compression_signal(candidate, rows, index, features)
    if candidate.family == "FLASH":
        return short_flash_signal(candidate, rows, index, features)
    return short_distribution_signal(candidate, rows, index, features)


def confirmation_index(candidate: Candidate, rows: List[dict], features: dict, signal_index: int, level: float) -> Optional[int]:
    signal_close = float(rows[signal_index]["close"])
    progress = signal_close * (1.0 + candidate.side * candidate.confirmation_move_pct / 100.0)
    end = min(signal_index + candidate.confirmation_hours, len(rows) - 2)
    for cursor in range(signal_index + 1, end + 1):
        close = float(rows[cursor]["close"])
        m1 = features["mom1"][cursor]
        if m1 is None:
            continue
        if candidate.family == "COMPRESSION":
            passed = close >= level and close >= progress
        elif candidate.family == "DISTRIBUTION":
            passed = close <= level or close <= progress
        else:
            passed = close >= progress if candidate.side > 0 else close <= progress
        if passed and side_value(candidate.side, float(m1)) > 0:
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
        armed, extreme, level = signal(candidate, pengu, index, features, btc_index)
        if not armed:
            continue
        funding_now = v47.latest_funding(funding, int(pengu[index]["closeTime"]))
        if candidate.side > 0 and (funding_now is None or funding_now > 0.0003):
            continue
        confirmed_at = confirmation_index(candidate, pengu, features, index, level)
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


def capture(trades: List[v50.Trade], events: List[dict], early_hours: int, side: int) -> dict:
    return v50.capture_metrics(trades, events, early_hours, side)


def candidate_summary(candidate: Candidate, trades: List[v50.Trade], armed: int, folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> dict:
    fold_metrics = [metrics(trades, start, end) for start, end in folds]
    fold_severe = [metrics(trades, start, end, True) for start, end in folds]
    train = metrics(trades, folds[0][0], folds[2][1])
    train_severe = metrics(trades, folds[0][0], folds[2][1], True)
    validation = metrics(trades, folds[3][0], folds[3][1])
    validation_severe = metrics(trades, folds[3][0], folds[3][1], True)
    holdout = metrics(trades, folds[4][0], folds[4][1])
    holdout_severe = metrics(trades, folds[4][0], folds[4][1], True)
    captures = []
    for index, (start, end) in enumerate(folds):
        fold_trades = [trade for trade in trades if start <= trade.entry_ts < end]
        captures.append({
            "3h3": capture(fold_trades, proxies["3h3"][index], 2, candidate.side),
            "6h5": capture(fold_trades, proxies["6h5"][index], 3, candidate.side),
            "12h8": capture(fold_trades, proxies["12h8"][index], 4, candidate.side),
        })
    names = ("3h3", "6h5", "12h8")
    train_captured = sum(captures[i][name]["capturedEvents"] for i in range(3) for name in names)
    train_early = sum(captures[i][name]["earlyCapturedEvents"] for i in range(3) for name in names)
    validation_events = sum(captures[3][name]["events"] for name in names)
    validation_captured = sum(captures[3][name]["capturedEvents"] for name in names)
    validation_early = sum(captures[3][name]["earlyCapturedEvents"] for name in names)
    positive_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_metrics[:3])
    severe_positive_folds = sum(item["compoundedReturnPct"] > 0 for item in fold_severe[:3])
    train_passed = bool(
        train["trades"] >= (6 if candidate.side > 0 else 8)
        and train["compoundedReturnPct"] > 0
        and (train["profitFactor"] or 0) >= 1.15
        and train["maxDrawdownPct"] >= -5
        and train_severe["compoundedReturnPct"] > 0
        and positive_folds >= 2
        and severe_positive_folds >= 2
        and train_captured >= 2
        and train_early >= 1
    )
    validation_passed = bool(
        train_passed
        and validation["trades"] >= 2
        and validation["compoundedReturnPct"] > 0
        and (validation["profitFactor"] or 0) >= 1.0
        and validation_severe["compoundedReturnPct"] > 0
        and validation["maxDrawdownPct"] >= -3
        and (validation_events == 0 or (validation_captured >= 1 and validation_early >= 1))
    )
    return {
        "candidate": asdict(candidate), "folds": fold_metrics, "foldsSevere": fold_severe,
        "captures": captures, "train": train, "trainSevere": train_severe,
        "validation": validation, "validationSevere": validation_severe,
        "holdout": holdout, "holdoutSevere": holdout_severe,
        "armedWithoutOrder": armed, "positiveTrainFolds": positive_folds,
        "severePositiveTrainFolds": severe_positive_folds,
        "trainCapturedEvents": train_captured, "trainEarlyCapturedEvents": train_early,
        "validationProxyEvents": validation_events, "validationCapturedEvents": validation_captured,
        "validationEarlyCapturedEvents": validation_early, "trainPassed": train_passed,
        "validationPassed": validation_passed, "trades": [asdict(trade) for trade in trades],
    }


def cluster_key(item: dict) -> tuple:
    c = item["candidate"]
    return (c["side"], c["family"], c["lookback"], c["confirmation_hours"], c["exit_profile"])


def rank_key(item: dict) -> tuple:
    return (
        item["validationEarlyCapturedEvents"], item["validationCapturedEvents"],
        item["validationSevere"]["compoundedReturnPct"], item["validation"]["compoundedReturnPct"],
        item["validation"]["profitFactor"] or 0, item["train"]["compoundedReturnPct"],
        item["train"]["maxDrawdownPct"],
    )


def rebuild(item: Optional[dict]) -> List[v50.Trade]:
    return [] if not item else [v50.Trade(**row) for row in item["trades"]]


def gate(item: Optional[dict], trades: List[v50.Trade], major24: List[dict], major72: List[dict], side: int) -> tuple[bool, dict]:
    if not item:
        return False, {"reason": "NO_SELECTED_CANDIDATE"}
    audit24 = capture(trades, major24, 6, side)
    audit72 = capture(trades, major72, 12, side)
    total = audit24["events"] + audit72["events"]
    early = audit24["earlyCapturedEvents"] + audit72["earlyCapturedEvents"]
    profitable = audit24["profitableCapturedEvents"] + audit72["profitableCapturedEvents"]
    early_rate = early / total * 100.0 if total else None
    profitable_rate = profitable / total * 100.0 if total else None
    h = item["holdout"]
    hs = item["holdoutSevere"]
    passed = bool(
        h["trades"] >= 2 and h["compoundedReturnPct"] > 0 and hs["compoundedReturnPct"] > 0
        and (h["profitFactor"] or 0) >= 1.05 and total > 0
        and early_rate is not None and early_rate >= 50.0
        and profitable_rate is not None and profitable_rate >= 50.0
    )
    return passed, {
        "holdout": h, "holdoutSevere": hs, "major24": audit24, "major72": audit72,
        "totalMajorEvents": total, "earlyMajorEvents": early, "profitableMajorEvents": profitable,
        "earlyMajorRatePct": early_rate, "profitableMajorRatePct": profitable_rate,
    }


def rounded(value):
    return v50.rounded(value)


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc).isoformat()


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for V52")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    features = prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    proxy_raw = {"3h3": v50.wave_events(pengu, 3, 3.0), "6h5": v50.wave_events(pengu, 6, 5.0), "12h8": v50.wave_events(pengu, 12, 8.0)}
    proxies = {name: v50.events_by_fold(events, folds) for name, events in proxy_raw.items()}
    major24 = v50.wave_events(pengu, 24, 20.0)
    major72 = v50.wave_events(pengu, 72, 35.0)

    summaries: Dict[str, dict] = {}
    counts = {1: 0, -1: 0}
    for side in (-1, 1):
        candidates = candidate_space(side)
        counts[side] = len(candidates)
        print(f"Evaluating {'Short' if side < 0 else 'Long'} {len(candidates)} V52 candidates")
        for candidate in candidates:
            trades, armed = run_candidate(candidate, pengu, btc, funding, features)
            summaries[candidate.candidate_id] = candidate_summary(candidate, trades, armed, folds, proxies)

    cluster_counts: Dict[tuple, int] = {}
    for item in summaries.values():
        if item["validationPassed"]:
            key = cluster_key(item)
            cluster_counts[key] = cluster_counts.get(key, 0) + 1
    eligible: Dict[int, List[str]] = {1: [], -1: []}
    for candidate_id, item in summaries.items():
        item["validationClusterSize"] = cluster_counts.get(cluster_key(item), 0)
        if item["validationPassed"] and item["validationClusterSize"] >= 2:
            eligible[int(item["candidate"]["side"])].append(candidate_id)
    for side in (-1, 1):
        eligible[side].sort(key=lambda key: rank_key(summaries[key]), reverse=True)

    selected_short = eligible[-1][0] if eligible[-1] else None
    selected_long = eligible[1][0] if eligible[1] else None
    short_item = summaries[selected_short] if selected_short else None
    long_item = summaries[selected_long] if selected_long else None
    short_trades = rebuild(short_item)
    long_trades = rebuild(long_item)
    short_pass, short_evidence = gate(short_item, short_trades, major24, major72, -1)
    long_pass, long_evidence = gate(long_item, long_trades, major24, major72, 1)
    enabled = v50.combine_sides(long_trades if long_pass else [], short_trades if short_pass else [])
    full = metrics(enabled, folds[0][0], folds[-1][1])
    full_severe = metrics(enabled, folds[0][0], folds[-1][1], True)
    holdout = metrics(enabled, folds[4][0], folds[4][1])
    holdout_severe = metrics(enabled, folds[4][0], folds[4][1], True)
    status = "BOTH_ENABLED" if long_pass and short_pass else "LONG_ONLY_ENABLED" if long_pass else "SHORT_ONLY_ENABLED" if short_pass else "NO_PRODUCTION_CANDIDATE"
    result = rounded({
        "version": 52, "strategyId": "PENGU_WAVE_SLEEVE_V52_REVERSAL_COMPRESSION_FLASH_DISTRIBUTION",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": status,
        "candidateCounts": {"long": counts[1], "short": counts[-1]},
        "folds": [{"start": iso(start), "end": iso(end)} for start, end in folds],
        "eligibleLongCount": len(eligible[1]), "eligibleShortCount": len(eligible[-1]),
        "selectedLong": selected_long, "selectedShort": selected_short,
        "selectedLongResult": long_item, "selectedShortResult": short_item,
        "longGatePassed": long_pass, "shortGatePassed": short_pass,
        "longGateEvidence": long_evidence, "shortGateEvidence": short_evidence,
        "enabledPortfolio": {"full": full, "fullSevere": full_severe, "holdout": holdout, "holdoutSevere": holdout_severe, "trades": [asdict(t) for t in enabled]},
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v52.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU Wave Sleeve V52", "", f"- Status: **{status}**",
        f"- Selected Long: **{selected_long or 'NONE'}**", f"- Selected Short: **{selected_short or 'NONE'}**",
        f"- Eligible Long / Short: {len(eligible[1])} / {len(eligible[-1])}",
        f"- Long gate: **{'PASS' if long_pass else 'FAIL'}**", f"- Short gate: **{'PASS' if short_pass else 'FAIL'}**",
        "", "## Long", f"- Holdout: {long_evidence.get('holdout', {}).get('compoundedReturnPct')}%",
        f"- Holdout Severe: {long_evidence.get('holdoutSevere', {}).get('compoundedReturnPct')}%",
        f"- Early major rate: {long_evidence.get('earlyMajorRatePct')}%", f"- Profitable major rate: {long_evidence.get('profitableMajorRatePct')}%",
        "", "## Short", f"- Holdout: {short_evidence.get('holdout', {}).get('compoundedReturnPct')}%",
        f"- Holdout Severe: {short_evidence.get('holdoutSevere', {}).get('compoundedReturnPct')}%",
        f"- Early major rate: {short_evidence.get('earlyMajorRatePct')}%", f"- Profitable major rate: {short_evidence.get('profitableMajorRatePct')}%",
        "", "## Enabled", f"- Full: {full['compoundedReturnPct']}%", f"- Full Severe: {full_severe['compoundedReturnPct']}%",
        f"- Holdout: {holdout['compoundedReturnPct']}%", f"- Holdout Severe: {holdout_severe['compoundedReturnPct']}%",
        "", "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-wave-sleeve-v52.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
