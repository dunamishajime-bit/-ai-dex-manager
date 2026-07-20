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
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR
COOLDOWN_HOURS = 6

BASE_LONG = v50.Candidate(
    side=1,
    family="BREAK",
    lookback=6,
    momentum1h=0.35,
    momentum3h=2.0,
    relative3h=0.5,
    volume_acceleration=1.1,
    volatility_expansion=1.0,
    extreme_factor=2.2,
    confirmation_move_pct=0.4,
    exit_profile="WIDE",
)

SHORT_FLASH = v52.Candidate(-1, "FLASH", 6, 1.5, 2.5, 0.0, 0.8, 0.7, 1.0, 0.2, 1, "WIDE")
SHORT_DISTRIBUTION = v52.Candidate(-1, "DISTRIBUTION", 6, 0.7, 0.5, 1.5, 0.5, 0.6, 1.0, 0.2, 2, "FAST")


@dataclass(frozen=True)
class ScoutCandidate:
    side: int
    family: str
    lookback: int
    momentum1h: float
    momentum3h: float
    relative3h: float
    volume_threshold: float
    volatility_threshold: float
    body_threshold: float
    distance_atr: float
    confirmation_move_pct: float
    confirmation_hours: int
    exit_profile: str

    @property
    def candidate_id(self) -> str:
        return (
            f"L_{self.family}_LB{self.lookback}_M1{self.momentum1h:g}"
            f"_M3{self.momentum3h:g}_REL{self.relative3h:g}"
            f"_VOL{self.volume_threshold:g}_VX{self.volatility_threshold:g}"
            f"_BD{self.body_threshold:g}_DA{self.distance_atr:g}"
            f"_CF{self.confirmation_move_pct:g}_CH{self.confirmation_hours}_{self.exit_profile}"
        ).replace(".", "p")


def reversal_space() -> List[ScoutCandidate]:
    return [
        ScoutCandidate(1, "RARE_REVERSAL", 6, *row)
        for row in itertools.product(
            (1.0, 1.5, 2.0),
            (2.5, 4.0, 6.0),
            (-0.5, 0.0),
            (1.5, 2.5, 3.5),
            (0.9, 1.2),
            (0.45, 0.65),
            (9.0,),
            (0.2, 0.4),
            (1, 2),
            ("FAST", "WIDE"),
        )
    ]


def compression_space() -> List[ScoutCandidate]:
    return [
        ScoutCandidate(1, "STRONG_COMPRESSION", lookback, *row)
        for lookback, row in itertools.product(
            (6, 12),
            itertools.product(
                (0.8, 1.2, 1.6),
                (1.5, 2.5, 3.5),
                (0.75, 1.5),
                (0.5, 0.9),
                (0.7, 0.95),
                (0.25,),
                (0.4, 0.7),
                (0.2, 0.4),
                (1, 2),
                ("FAST", "WIDE"),
            ),
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


def features_for(pengu: List[dict], btc: List[dict]) -> dict:
    return v52.prepare_features(pengu, btc)


def prior_boundary(rows: List[dict], index: int, lookback: int) -> float:
    return max(float(row["high"]) for row in rows[index - lookback:index])


def distance_to_high_atr(candidate: ScoutCandidate, rows: List[dict], index: int, features: dict) -> float:
    atr = features["atr24"][index]
    if atr is None or atr <= 0:
        return 999.0
    return (prior_boundary(rows, index, candidate.lookback) - float(rows[index]["close"])) / float(atr)


def scout_signal(candidate: ScoutCandidate, rows: List[dict], index: int, features: dict, btc_index: int) -> tuple[bool, bool, float]:
    if index < 200:
        return False, False, 0.0
    if not v50.btc_risk_allows(1, features, btc_index):
        return False, False, 0.0
    m1 = features["mom1"][index]
    m3 = features["mom3"][index]
    relative = features["relative3"][index]
    volume = features["volumeAcceleration"][index]
    volatility = features["volatilityExpansion"][index]
    body = features["bodyStrength"][index]
    if any(value is None for value in (m1, m3, relative, volume, volatility, body)):
        return False, False, 0.0
    level = prior_boundary(rows, index, candidate.lookback)
    if candidate.family == "RARE_REVERSAL":
        prior_m3 = features["mom3"][index - 1]
        if prior_m3 is None:
            return False, False, level
        if float(m1) < candidate.momentum1h or float(prior_m3) > -candidate.momentum3h:
            return False, False, level
        if float(relative) < candidate.relative3h:
            return False, False, level
        if float(volume) < candidate.volume_threshold or float(volatility) < candidate.volatility_threshold:
            return False, False, level
        if float(body) < candidate.body_threshold:
            return False, False, level
        extreme = bool(
            float(m1) >= candidate.momentum1h * 1.35
            and float(volume) >= candidate.volume_threshold * 1.20
            and float(volatility) >= candidate.volatility_threshold * 1.10
            and float(body) >= max(0.70, candidate.body_threshold)
        )
        return True, extreme, level

    if float(m1) < candidate.momentum1h or float(m3) < candidate.momentum3h:
        return False, False, level
    if float(relative) < candidate.relative3h:
        return False, False, level
    if float(volume) > candidate.volume_threshold or float(volatility) > candidate.volatility_threshold:
        return False, False, level
    if float(body) < candidate.body_threshold:
        return False, False, level
    distance = distance_to_high_atr(candidate, rows, index, features)
    if distance > candidate.distance_atr or distance < -0.50:
        return False, False, level
    return True, False, level


def confirmation_index(candidate: ScoutCandidate, rows: List[dict], features: dict, signal_index: int, level: float) -> Optional[int]:
    signal_close = float(rows[signal_index]["close"])
    progress = signal_close * (1.0 + candidate.confirmation_move_pct / 100.0)
    end = min(signal_index + candidate.confirmation_hours, len(rows) - 2)
    for cursor in range(signal_index + 1, end + 1):
        close = float(rows[cursor]["close"])
        m1 = features["mom1"][cursor]
        relative = features["relative3"][cursor]
        if m1 is None or relative is None:
            continue
        if candidate.family == "STRONG_COMPRESSION":
            passed = close >= level and close >= progress
        else:
            passed = close >= progress
        if passed and float(m1) > 0 and float(relative) >= candidate.relative3h * 0.25:
            return cursor
    return None


def run_scout(candidate: ScoutCandidate, pengu: List[dict], btc: List[dict], funding: List[dict], features: dict) -> tuple[List[v50.Trade], int]:
    btc_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    trades: List[v50.Trade] = []
    armed_without_order = 0
    next_free = 0
    for index in range(200, len(pengu) - 60):
        ts = int(pengu[index]["ts"])
        if ts < next_free:
            continue
        btc_index = btc_map.get(ts)
        if btc_index is None:
            continue
        armed, extreme, level = scout_signal(candidate, pengu, index, features, btc_index)
        if not armed:
            continue
        funding_now = v47.latest_funding(funding, int(pengu[index]["closeTime"]))
        if funding_now is None or funding_now > 0.0003:
            continue
        confirmed_at = confirmation_index(candidate, pengu, features, index, level)
        if confirmed_at is not None:
            trade = v50.make_confirmed_trade(candidate, pengu, funding, features, index, confirmed_at, extreme)
        elif extreme:
            trade = v50.make_unconfirmed_probe(candidate, pengu, funding, features, index)
        else:
            armed_without_order += 1
            next_free = ts + candidate.confirmation_hours * HOUR
            continue
        if trade is None:
            continue
        trades.append(trade)
        next_free = trade.exit_ts + COOLDOWN_HOURS * HOUR
    return trades, armed_without_order


def metrics(trades: Iterable[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def fold_metrics(trades: List[v50.Trade], folds: List[tuple[int, int]], severe: bool = False) -> List[dict]:
    return [metrics(trades, start, end, severe) for start, end in folds]


def aggregate_metrics(trades: List[v50.Trade], folds: List[tuple[int, int]]) -> dict:
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


def proxy_counts(trades: List[v50.Trade], folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> dict:
    names = ("3h3", "6h5", "12h8")
    early_hours = {"3h3": 2, "6h5": 3, "12h8": 4}
    by_fold = []
    for index, (start, end) in enumerate(folds):
        fold_trades = [trade for trade in trades if start <= trade.entry_ts < end]
        by_fold.append({
            name: v50.capture_metrics(fold_trades, proxies[name][index], early_hours[name], 1)
            for name in names
        })
    def total(indices, key):
        return sum(by_fold[index][name][key] for index in indices for name in names)
    return {
        "folds": by_fold,
        "selectionEvents": total(range(4), "events"),
        "selectionCaptured": total(range(4), "capturedEvents"),
        "selectionEarly": total(range(4), "earlyCapturedEvents"),
        "trainEarly": total(range(3), "earlyCapturedEvents"),
        "validationEarly": total((3,), "earlyCapturedEvents"),
    }


def robust_selection_pass(scout_trades: List[v50.Trade], ensemble: List[v50.Trade], base: List[v50.Trade], folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> tuple[bool, dict]:
    scout_normal = fold_metrics(scout_trades, folds)
    scout_severe = fold_metrics(scout_trades, folds, True)
    ensemble_normal = fold_metrics(ensemble, folds)
    ensemble_severe = fold_metrics(ensemble, folds, True)
    base_normal = fold_metrics(base, folds)
    base_severe = fold_metrics(base, folds, True)
    selection_folds = range(4)
    scout_positive = sum(scout_normal[index]["compoundedReturnPct"] > 0 for index in selection_folds)
    scout_severe_positive = sum(scout_severe[index]["compoundedReturnPct"] > 0 for index in selection_folds)
    ensemble_positive = sum(ensemble_normal[index]["compoundedReturnPct"] > 0 for index in selection_folds)
    ensemble_severe_positive = sum(ensemble_severe[index]["compoundedReturnPct"] > 0 for index in selection_folds)
    worst_scout_severe = min(scout_severe[index]["compoundedReturnPct"] for index in selection_folds)
    no_large_damage = all(
        ensemble_severe[index]["compoundedReturnPct"] >= base_severe[index]["compoundedReturnPct"] - 0.35
        for index in selection_folds
    )
    ensemble_aggregate = {
        "train": metrics(ensemble, folds[0][0], folds[2][1]),
        "trainSevere": metrics(ensemble, folds[0][0], folds[2][1], True),
        "validation": metrics(ensemble, folds[3][0], folds[3][1]),
        "validationSevere": metrics(ensemble, folds[3][0], folds[3][1], True),
    }
    scout_aggregate = metrics(scout_trades, folds[0][0], folds[3][1])
    scout_aggregate_severe = metrics(scout_trades, folds[0][0], folds[3][1], True)
    base_capture = proxy_counts(base, folds, proxies)
    ensemble_capture = proxy_counts(ensemble, folds, proxies)
    improves_early = ensemble_capture["selectionEarly"] > base_capture["selectionEarly"]
    passed = bool(
        scout_aggregate["trades"] >= 5
        and scout_aggregate["compoundedReturnPct"] > 0
        and scout_aggregate_severe["compoundedReturnPct"] > 0
        and (scout_aggregate["profitFactor"] or 0) >= 1.10
        and scout_positive >= 3
        and scout_severe_positive >= 3
        and worst_scout_severe >= -0.35
        and ensemble_positive >= 3
        and ensemble_severe_positive >= 3
        and no_large_damage
        and ensemble_aggregate["train"]["compoundedReturnPct"] > 0
        and ensemble_aggregate["trainSevere"]["compoundedReturnPct"] > 0
        and ensemble_aggregate["validation"]["compoundedReturnPct"] > 0
        and ensemble_aggregate["validationSevere"]["compoundedReturnPct"] > 0
        and improves_early
    )
    evidence = {
        "scoutFoldNormal": scout_normal,
        "scoutFoldSevere": scout_severe,
        "ensembleFoldNormal": ensemble_normal,
        "ensembleFoldSevere": ensemble_severe,
        "baseFoldNormal": base_normal,
        "baseFoldSevere": base_severe,
        "scoutPositiveFolds": scout_positive,
        "scoutSeverePositiveFolds": scout_severe_positive,
        "ensemblePositiveFolds": ensemble_positive,
        "ensembleSeverePositiveFolds": ensemble_severe_positive,
        "worstScoutSeverePct": worst_scout_severe,
        "noLargeDamage": no_large_damage,
        "scoutSelection": scout_aggregate,
        "scoutSelectionSevere": scout_aggregate_severe,
        "ensembleAggregate": ensemble_aggregate,
        "baseCapture": base_capture,
        "ensembleCapture": ensemble_capture,
        "improvesEarly": improves_early,
    }
    return passed, evidence


def rank_key(evidence: dict) -> tuple:
    capture = evidence["ensembleCapture"]
    selection = evidence["scoutSelection"]
    severe = evidence["scoutSelectionSevere"]
    ensemble = evidence["ensembleAggregate"]
    return (
        capture["selectionEarly"],
        capture["selectionCaptured"],
        evidence["scoutSeverePositiveFolds"],
        evidence["worstScoutSeverePct"],
        ensemble["validationSevere"]["compoundedReturnPct"],
        severe["compoundedReturnPct"],
        selection["compoundedReturnPct"],
    )


def cluster_key(candidate: ScoutCandidate) -> tuple:
    return (candidate.family, candidate.confirmation_hours, candidate.exit_profile)


def select_scout(candidates: List[ScoutCandidate], base: List[v50.Trade], pengu: List[dict], btc: List[dict], funding: List[dict], features: dict, folds: List[tuple[int, int]], proxies: Dict[str, List[List[dict]]]) -> tuple[Optional[ScoutCandidate], List[v50.Trade], dict]:
    passed_rows = []
    diagnostics = []
    for position, candidate in enumerate(candidates, start=1):
        if position % 500 == 0:
            print(f"Scout candidates {position}/{len(candidates)}")
        scout_trades, armed = run_scout(candidate, pengu, btc, funding, features)
        ensemble = combine_same_side(scout_trades, base)
        passed, evidence = robust_selection_pass(scout_trades, ensemble, base, folds, proxies)
        item = {
            "candidate": asdict(candidate),
            "candidateId": candidate.candidate_id,
            "armedWithoutOrder": armed,
            "scoutTrades": len(scout_trades),
            "evidence": evidence,
            "passedBeforeCluster": passed,
        }
        diagnostics.append(item)
        if passed:
            passed_rows.append((candidate, ensemble, item))
    cluster_counts: Dict[tuple, int] = {}
    for candidate, _, _ in passed_rows:
        key = cluster_key(candidate)
        cluster_counts[key] = cluster_counts.get(key, 0) + 1
    stable = [row for row in passed_rows if cluster_counts.get(cluster_key(row[0]), 0) >= 2]
    stable.sort(key=lambda row: rank_key(row[2]["evidence"]), reverse=True)
    diagnostics.sort(key=lambda item: rank_key(item["evidence"]), reverse=True)
    if not stable:
        return None, base, {
            "passedBeforeCluster": len(passed_rows),
            "stablePassed": 0,
            "topDiagnostics": diagnostics[:20],
        }
    selected, ensemble, item = stable[0]
    return selected, ensemble, {
        "passedBeforeCluster": len(passed_rows),
        "stablePassed": len(stable),
        "selected": item,
        "topDiagnostics": diagnostics[:20],
    }


def adoption_gate(trades: List[v50.Trade], folds: List[tuple[int, int]], major24: List[dict], major72: List[dict], side: int) -> tuple[bool, dict]:
    aggregate = aggregate_metrics(trades, folds)
    audit24 = v50.capture_metrics(trades, major24, 6, side)
    audit72 = v50.capture_metrics(trades, major72, 12, side)
    total = audit24["events"] + audit72["events"]
    early = audit24["earlyCapturedEvents"] + audit72["earlyCapturedEvents"]
    profitable = audit24["profitableCapturedEvents"] + audit72["profitableCapturedEvents"]
    early_rate = early / total * 100.0 if total else None
    profitable_rate = profitable / total * 100.0 if total else None
    holdout = aggregate["holdout"]
    holdout_severe = aggregate["holdoutSevere"]
    passed = bool(
        holdout["trades"] >= 2
        and holdout["compoundedReturnPct"] > 0
        and holdout_severe["compoundedReturnPct"] > 0
        and (holdout["profitFactor"] or 0) >= 1.05
        and total > 0
        and early_rate is not None and early_rate >= 50.0
        and profitable_rate is not None and profitable_rate >= 50.0
    )
    return passed, {
        "metrics": aggregate,
        "major24": audit24,
        "major72": audit72,
        "totalMajorEvents": total,
        "earlyMajorEvents": early,
        "profitableMajorEvents": profitable,
        "earlyMajorRatePct": early_rate,
        "profitableMajorRatePct": profitable_rate,
    }


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now_end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    print("Fetching Aster PENGU/BTC history for V54")
    pengu = v47.fetch_klines("PENGUUSDT", now_end)
    btc = v47.fetch_klines("BTCUSDT", now_end)
    funding = v47.fetch_funding("PENGUUSDT", now_end)
    features = features_for(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    proxy_raw = {
        "3h3": v50.wave_events(pengu, 3, 3.0),
        "6h5": v50.wave_events(pengu, 6, 5.0),
        "12h8": v50.wave_events(pengu, 12, 8.0),
    }
    proxies = {name: v50.events_by_fold(events, folds) for name, events in proxy_raw.items()}
    major24 = v50.wave_events(pengu, 24, 20.0)
    major72 = v50.wave_events(pengu, 72, 35.0)

    base_long, _ = v50.run_candidate(BASE_LONG, pengu, btc, funding, features)
    selected_reversal, long_after_reversal, reversal_search = select_scout(
        reversal_space(), base_long, pengu, btc, funding, features, folds, proxies
    )
    selected_compression, final_long, compression_search = select_scout(
        compression_space(), long_after_reversal, pengu, btc, funding, features, folds, proxies
    )

    flash_trades, _ = v52.run_candidate(SHORT_FLASH, pengu, btc, funding, features)
    distribution_trades, _ = v52.run_candidate(SHORT_DISTRIBUTION, pengu, btc, funding, features)
    final_short = combine_same_side(distribution_trades, flash_trades)

    long_pass, long_evidence = adoption_gate(final_long, folds, major24, major72, 1)
    short_pass, short_evidence = adoption_gate(final_short, folds, major24, major72, -1)
    enabled = v50.combine_sides(final_long if long_pass else [], final_short if short_pass else [])
    enabled_metrics = aggregate_metrics(enabled, folds)
    status = (
        "BOTH_ENABLED" if long_pass and short_pass
        else "LONG_ONLY_ENABLED" if long_pass
        else "SHORT_ONLY_ENABLED" if short_pass
        else "NO_PRODUCTION_CANDIDATE"
    )
    result = rounded({
        "version": 54,
        "strategyId": "PENGU_WAVE_SLEEVE_V54_ROBUST_RARE_SCOUT",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "baseLong": asdict(BASE_LONG),
        "fixedShortFlash": asdict(SHORT_FLASH),
        "fixedShortDistribution": asdict(SHORT_DISTRIBUTION),
        "candidateCounts": {"reversal": len(reversal_space()), "compression": len(compression_space())},
        "selectedReversal": asdict(selected_reversal) if selected_reversal else None,
        "selectedCompression": asdict(selected_compression) if selected_compression else None,
        "reversalSearch": reversal_search,
        "compressionSearch": compression_search,
        "longGatePassed": long_pass,
        "shortGatePassed": short_pass,
        "longEvidence": long_evidence,
        "shortEvidence": short_evidence,
        "enabledMetrics": enabled_metrics,
        "longTrades": [asdict(trade) for trade in final_long],
        "shortTrades": [asdict(trade) for trade in final_short],
        "enabledTrades": [asdict(trade) for trade in enabled],
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False},
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-wave-sleeve-v54.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU Wave Sleeve V54 Robust Rare Scout",
        "",
        f"- Status: **{status}**",
        f"- Selected Reversal: **{selected_reversal.candidate_id if selected_reversal else 'NONE'}**",
        f"- Selected Compression: **{selected_compression.candidate_id if selected_compression else 'NONE'}**",
        f"- Long gate: **{'PASS' if long_pass else 'FAIL'}**",
        f"- Short gate: **{'PASS' if short_pass else 'FAIL'}**",
        "",
        "## Long",
        f"- Full: {long_evidence['metrics']['full']['compoundedReturnPct']}%",
        f"- Full Severe: {long_evidence['metrics']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {long_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {long_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {long_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {long_evidence['profitableMajorRatePct']}%",
        "",
        "## Short",
        f"- Full: {short_evidence['metrics']['full']['compoundedReturnPct']}%",
        f"- Full Severe: {short_evidence['metrics']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {short_evidence['metrics']['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {short_evidence['metrics']['holdoutSevere']['compoundedReturnPct']}%",
        f"- Early major rate: {short_evidence['earlyMajorRatePct']}%",
        f"- Profitable major rate: {short_evidence['profitableMajorRatePct']}%",
        "",
        "## Enabled portfolio",
        f"- Full: {enabled_metrics['full']['compoundedReturnPct']}%",
        f"- Full Severe: {enabled_metrics['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout: {enabled_metrics['holdout']['compoundedReturnPct']}%",
        f"- Holdout Severe: {enabled_metrics['holdoutSevere']['compoundedReturnPct']}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-wave-sleeve-v54.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
