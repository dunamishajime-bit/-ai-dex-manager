from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v49 as v49
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR
COOLDOWN_HOURS = 6

BASE_LONG = v50.Candidate(1, "BREAK", 6, 0.35, 2.0, 0.5, 1.1, 1.0, 2.2, 0.4, "WIDE")
SHORT_FLASH = v52.Candidate(-1, "FLASH", 6, 1.5, 2.5, 0.0, 0.8, 0.7, 1.0, 0.2, 1, "WIDE")
SHORT_DISTRIBUTION = v52.Candidate(-1, "DISTRIBUTION", 6, 0.7, 0.5, 1.5, 0.5, 0.6, 1.0, 0.2, 2, "FAST")


@dataclass(frozen=True)
class GatedReversal:
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
    gate_mom1: float
    gate_relative3: float
    gate_volume: float
    gate_volatility: float
    gate_body: float

    @property
    def candidate_id(self) -> str:
        return (
            f"L_GATED_REV_M1{self.gate_mom1:g}_REL{self.gate_relative3:g}"
            f"_VOL{self.gate_volume:g}_VX{self.gate_volatility:g}"
            f"_BD{self.gate_body:g}_{self.exit_profile}"
        ).replace(".", "p")


def candidate_space() -> List[GatedReversal]:
    return [
        GatedReversal(
            1, "REVERSAL", 6, 0.4, 1.5, 0.0, 0.3, 0.4, 9.0, 0.2, 1,
            exit_profile, mom1, relative, volume, volatility, body,
        )
        for mom1, relative, volume, volatility, body, exit_profile in itertools.product(
            (1.0, 1.2, 1.5, 1.8),
            (-1.0, -0.75, -0.5, -0.25, 0.0),
            (1.5, 2.0, 2.5, 3.0),
            (0.7, 0.9, 1.1),
            (0.35, 0.4, 0.55, 0.65),
            ("FAST", "WIDE"),
        )
    ]


def combine_same_side(*groups: List[v50.Trade]) -> List[v50.Trade]:
    tagged = []
    for priority, group in enumerate(groups):
        tagged.extend((trade.entry_ts, priority, trade) for trade in group)
    tagged.sort(key=lambda row: (row[0], row[1]))
    result: List[v50.Trade] = []
    next_free = 0
    for _, _, trade in tagged:
        if trade.entry_ts < next_free:
            continue
        result.append(trade)
        next_free = trade.exit_ts
    return result


def signal(candidate: GatedReversal, rows: List[dict], index: int, features: dict, btc_index: int) -> tuple[bool, bool, float]:
    if index < 200 or not v49.btc_risk_allows(1, features, btc_index):
        return False, False, 0.0
    m1 = features["mom1"][index]
    prior_m3 = features["mom3"][index - 1]
    relative = features["relative3"][index]
    volume = features["volumeAcceleration"][index]
    volatility = features["volatilityExpansion"][index]
    body = features["bodyStrength"][index]
    if any(value is None for value in (m1, prior_m3, relative, volume, volatility, body)):
        return False, False, 0.0
    if float(m1) < max(candidate.trigger1, candidate.gate_mom1):
        return False, False, 0.0
    if float(prior_m3) > -candidate.trigger3:
        return False, False, 0.0
    if float(relative) < candidate.gate_relative3:
        return False, False, 0.0
    if float(volume) < max(candidate.volume_threshold, candidate.gate_volume):
        return False, False, 0.0
    if float(volatility) < max(candidate.volatility_threshold, candidate.gate_volatility):
        return False, False, 0.0
    if float(body) < candidate.gate_body:
        return False, False, 0.0
    level = max(float(row["high"]) for row in rows[index - candidate.lookback:index])
    extreme = bool(
        float(m1) >= max(1.2, candidate.gate_mom1)
        and float(volume) >= max(1.2, candidate.gate_volume)
        and float(volatility) >= max(1.0, candidate.gate_volatility)
        and float(body) >= 0.65
    )
    return True, extreme, level


def confirmation_index(candidate: GatedReversal, rows: List[dict], features: dict, signal_index: int) -> Optional[int]:
    signal_close = float(rows[signal_index]["close"])
    progress = signal_close * (1.0 + candidate.confirmation_move_pct / 100.0)
    cursor = signal_index + 1
    if cursor >= len(rows) - 1:
        return None
    close = float(rows[cursor]["close"])
    m1 = features["mom1"][cursor]
    if close >= progress and m1 is not None and float(m1) > 0:
        return cursor
    return None


def run_candidate(candidate: GatedReversal, pengu: List[dict], btc: List[dict], funding: List[dict], features: dict) -> tuple[List[v50.Trade], int]:
    btc_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    trades: List[v50.Trade] = []
    armed = 0
    next_free = 0
    for index in range(200, len(pengu) - 60):
        ts = int(pengu[index]["ts"])
        if ts < next_free:
            continue
        btc_index = btc_map.get(ts)
        if btc_index is None:
            continue
        is_armed, extreme, _level = signal(candidate, pengu, index, features, btc_index)
        if not is_armed:
            continue
        funding_now = v47.latest_funding(funding, int(pengu[index]["closeTime"]))
        if funding_now is None or funding_now > 0.0003:
            continue
        confirmed_at = confirmation_index(candidate, pengu, features, index)
        if confirmed_at is not None:
            trade = v50.make_confirmed_trade(candidate, pengu, funding, features, index, confirmed_at, extreme)
        elif extreme:
            trade = v50.make_unconfirmed_probe(candidate, pengu, funding, features, index)
        else:
            armed += 1
            next_free = ts + HOUR
            continue
        if trade is None:
            continue
        trades.append(trade)
        next_free = trade.exit_ts + COOLDOWN_HOURS * HOUR
    return trades, armed


def metrics(trades: Iterable[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def per_fold(trades: List[v50.Trade], folds: List[tuple[int, int]], severe: bool = False) -> List[dict]:
    return [metrics(trades, start, end, severe) for start, end in folds]


def aggregate(trades: List[v50.Trade], folds: List[tuple[int, int]]) -> dict:
    return {
        "train": metrics(trades, folds[0][0], folds[2][1]),
        "trainSevere": metrics(trades, folds[0][0], folds[2][1], True),
        "validation": metrics(trades, folds[3][0], folds[3][1]),
        "validationSevere": metrics(trades, folds[3][0], folds[3][1], True),
        "holdout": metrics(trades, folds[4][0], folds[4][1]),
        "holdoutSevere": metrics(trades, folds[4][0], folds[4][1], True),
        "full": metrics(trades, folds[0][0], folds[-1][1]),
        "fullSevere": metrics(trades, folds[0][0], folds[-1][1], True),
    }


def proxy_capture(trades: List[v50.Trade], folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> dict:
    names = ("3h3", "6h5", "12h8")
    hours = {"3h3": 2, "6h5": 3, "12h8": 4}
    rows = []
    for index, (start, end) in enumerate(folds):
        fold_trades = [trade for trade in trades if start <= trade.entry_ts < end]
        rows.append({name: v50.capture_metrics(fold_trades, proxies[name][index], hours[name], 1) for name in names})
    def total(indices, key):
        return sum(rows[index][name][key] for index in indices for name in names)
    return {
        "folds": rows,
        "selectionEarly": total(range(4), "earlyCapturedEvents"),
        "selectionCaptured": total(range(4), "capturedEvents"),
        "validationEarly": total((3,), "earlyCapturedEvents"),
    }


def evaluate(candidate: GatedReversal, scout: List[v50.Trade], ensemble: List[v50.Trade], base: List[v50.Trade], folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> tuple[bool, dict]:
    scout_normal = per_fold(scout, folds)
    scout_severe = per_fold(scout, folds, True)
    ensemble_normal = per_fold(ensemble, folds)
    ensemble_severe = per_fold(ensemble, folds, True)
    base_severe = per_fold(base, folds, True)
    selection = metrics(scout, folds[0][0], folds[3][1])
    selection_severe = metrics(scout, folds[0][0], folds[3][1], True)
    ensemble_aggregate = aggregate(ensemble, folds)
    scout_positive = sum(scout_normal[index]["compoundedReturnPct"] > 0 for index in range(4))
    scout_severe_positive = sum(scout_severe[index]["compoundedReturnPct"] > 0 for index in range(4))
    ensemble_positive = sum(ensemble_normal[index]["compoundedReturnPct"] > 0 for index in range(4))
    ensemble_severe_positive = sum(ensemble_severe[index]["compoundedReturnPct"] > 0 for index in range(4))
    worst_scout_severe = min(item["compoundedReturnPct"] for item in scout_severe[:4])
    no_damage = all(
        ensemble_severe[index]["compoundedReturnPct"] >= base_severe[index]["compoundedReturnPct"] - 0.25
        for index in range(4)
    )
    base_capture = proxy_capture(base, folds, proxies)
    ensemble_capture = proxy_capture(ensemble, folds, proxies)
    improves_early = ensemble_capture["selectionEarly"] > base_capture["selectionEarly"]
    passed = bool(
        selection["trades"] >= 5
        and selection["compoundedReturnPct"] > 0
        and selection_severe["compoundedReturnPct"] > 0
        and (selection["profitFactor"] or 0) >= 1.10
        and scout_positive >= 3
        and scout_severe_positive >= 3
        and worst_scout_severe >= -0.25
        and ensemble_positive >= 3
        and ensemble_severe_positive >= 3
        and no_damage
        and ensemble_aggregate["train"]["compoundedReturnPct"] > 0
        and ensemble_aggregate["trainSevere"]["compoundedReturnPct"] > 0
        and ensemble_aggregate["validation"]["compoundedReturnPct"] > 0
        and ensemble_aggregate["validationSevere"]["compoundedReturnPct"] > 0
        and improves_early
    )
    return passed, {
        "candidate": asdict(candidate),
        "scoutSelection": selection,
        "scoutSelectionSevere": selection_severe,
        "scoutFoldNormal": scout_normal,
        "scoutFoldSevere": scout_severe,
        "ensembleFoldNormal": ensemble_normal,
        "ensembleFoldSevere": ensemble_severe,
        "scoutPositiveFolds": scout_positive,
        "scoutSeverePositiveFolds": scout_severe_positive,
        "ensemblePositiveFolds": ensemble_positive,
        "ensembleSeverePositiveFolds": ensemble_severe_positive,
        "worstScoutSeverePct": worst_scout_severe,
        "noDamage": no_damage,
        "ensembleAggregate": ensemble_aggregate,
        "baseCapture": base_capture,
        "ensembleCapture": ensemble_capture,
        "improvesEarly": improves_early,
    }


def rank_key(item: dict) -> tuple:
    return (
        item["ensembleCapture"]["selectionEarly"],
        item["ensembleCapture"]["selectionCaptured"],
        item["scoutSeverePositiveFolds"],
        item["worstScoutSeverePct"],
        item["ensembleAggregate"]["validationSevere"]["compoundedReturnPct"],
        item["scoutSelectionSevere"]["compoundedReturnPct"],
        item["scoutSelection"]["compoundedReturnPct"],
    )


def cluster_key(candidate: GatedReversal) -> tuple:
    return (candidate.gate_mom1, candidate.gate_volume, candidate.exit_profile)


def adoption_gate(trades: List[v50.Trade], folds: List[tuple[int, int]], major24: List[dict], major72: List[dict], side: int) -> tuple[bool, dict]:
    result = aggregate(trades, folds)
    audit24 = v50.capture_metrics(trades, major24, 6, side)
    audit72 = v50.capture_metrics(trades, major72, 12, side)
    total = audit24["events"] + audit72["events"]
    early = audit24["earlyCapturedEvents"] + audit72["earlyCapturedEvents"]
    profitable = audit24["profitableCapturedEvents"] + audit72["profitableCapturedEvents"]
    early_rate = early / total * 100.0 if total else None
    profitable_rate = profitable / total * 100.0 if total else None
    holdout = result["holdout"]
    severe = result["holdoutSevere"]
    passed = bool(
        holdout["trades"] >= 2 and holdout["compoundedReturnPct"] > 0 and severe["compoundedReturnPct"] > 0
        and (holdout["profitFactor"] or 0) >= 1.05 and total > 0
        and early_rate is not None and early_rate >= 50.0
        and profitable_rate is not None and profitable_rate >= 50.0
    )
    return passed, {
        "metrics": result, "major24": audit24, "major72": audit72,
        "totalMajorEvents": total, "earlyMajorEvents": early, "profitableMajorEvents": profitable,
        "earlyMajorRatePct": early_rate, "profitableMajorRatePct": profitable_rate,
    }


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for V55")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    features = v52.prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    proxy_raw = {"3h3": v50.wave_events(pengu, 3, 3.0), "6h5": v50.wave_events(pengu, 6, 5.0), "12h8": v50.wave_events(pengu, 12, 8.0)}
    proxies = {name: v50.events_by_fold(events, folds) for name, events in proxy_raw.items()}
    major24 = v50.wave_events(pengu, 24, 20.0)
    major72 = v50.wave_events(pengu, 72, 35.0)

    base_long, _ = v50.run_candidate(BASE_LONG, pengu, btc, funding, features)
    passed = []
    diagnostics = []
    for position, candidate in enumerate(candidate_space(), start=1):
        if position % 300 == 0:
            print(f"V55 candidates {position}/{len(candidate_space())}")
        scout, armed = run_candidate(candidate, pengu, btc, funding, features)
        ensemble = combine_same_side(scout, base_long)
        is_passed, evidence = evaluate(candidate, scout, ensemble, base_long, folds, proxies)
        evidence["candidateId"] = candidate.candidate_id
        evidence["armedWithoutOrder"] = armed
        evidence["scoutTrades"] = len(scout)
        diagnostics.append(evidence)
        if is_passed:
            passed.append((candidate, ensemble, evidence))
    cluster_counts: Dict[tuple, int] = {}
    for candidate, _, _ in passed:
        cluster_counts[cluster_key(candidate)] = cluster_counts.get(cluster_key(candidate), 0) + 1
    stable = [row for row in passed if cluster_counts.get(cluster_key(row[0]), 0) >= 2]
    stable.sort(key=lambda row: rank_key(row[2]), reverse=True)
    diagnostics.sort(key=rank_key, reverse=True)
    selected = stable[0][0] if stable else None
    final_long = stable[0][1] if stable else base_long
    selected_evidence = stable[0][2] if stable else None

    flash, _ = v52.run_candidate(SHORT_FLASH, pengu, btc, funding, features)
    distribution, _ = v52.run_candidate(SHORT_DISTRIBUTION, pengu, btc, funding, features)
    final_short = combine_same_side(distribution, flash)

    long_pass, long_evidence = adoption_gate(final_long, folds, major24, major72, 1)
    short_pass, short_evidence = adoption_gate(final_short, folds, major24, major72, -1)
    enabled = v50.combine_sides(final_long if long_pass else [], final_short if short_pass else [])
    enabled_metrics = aggregate(enabled, folds)
    status = "BOTH_ENABLED" if long_pass and short_pass else "LONG_ONLY_ENABLED" if long_pass else "SHORT_ONLY_ENABLED" if short_pass else "NO_PRODUCTION_CANDIDATE"
    result = rounded({
        "version": 55, "strategyId": "PENGU_WAVE_SLEEVE_V55_GATED_REVERSAL",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": status,
        "candidateCount": len(candidate_space()),
        "passedBeforeCluster": len(passed), "stablePassed": len(stable),
        "selectedReversal": asdict(selected) if selected else None,
        "selectedEvidence": selected_evidence,
        "topDiagnostics": diagnostics[:30],
        "baseLong": asdict(BASE_LONG), "fixedShortFlash": asdict(SHORT_FLASH), "fixedShortDistribution": asdict(SHORT_DISTRIBUTION),
        "longGatePassed": long_pass, "shortGatePassed": short_pass,
        "longEvidence": long_evidence, "shortEvidence": short_evidence,
        "enabledMetrics": enabled_metrics,
        "longTrades": [asdict(trade) for trade in final_long],
        "shortTrades": [asdict(trade) for trade in final_short],
        "enabledTrades": [asdict(trade) for trade in enabled],
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v55.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU Wave Sleeve V55 Gated Reversal", "", f"- Status: **{status}**",
        f"- Selected Reversal: **{selected.candidate_id if selected else 'NONE'}**",
        f"- Passed / stable: {len(passed)} / {len(stable)}",
        f"- Long gate: **{'PASS' if long_pass else 'FAIL'}**", f"- Short gate: **{'PASS' if short_pass else 'FAIL'}**",
        "", "## Long",
        f"- Full: {long_evidence['metrics']['full']['compoundedReturnPct']}%",
        f"- Full Severe: {long_evidence['metrics']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {long_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {long_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {long_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {long_evidence['profitableMajorRatePct']}%",
        "", "## Short",
        f"- Full: {short_evidence['metrics']['full']['compoundedReturnPct']}%",
        f"- Full Severe: {short_evidence['metrics']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {short_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {short_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {short_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {short_evidence['profitableMajorRatePct']}%",
        "", "## Enabled",
        f"- Full: {enabled_metrics['full']['compoundedReturnPct']}%",
        f"- Full Severe: {enabled_metrics['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {enabled_metrics['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {enabled_metrics['holdoutSevere']['compoundedReturnPct']}%",
        "", "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-wave-sleeve-v55.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
