from __future__ import annotations

import datetime as dt
import itertools
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v57_extended_bt_v3 as archive_source
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v49 as v49
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52

HOUR = v47.HOUR
PROBE_GROSS = 0.05
ADD_GROSS = 0.10
FULL_GROSS = 0.15
BASE_COST_PCT = 0.14
SEVERE_COST_PCT = 0.28
COOLDOWN_HOURS = 6

FLASH = v52.Candidate(-1, "FLASH", 6, 2.0, 5.0, 0.0, 0.8, 1.0, 1.0, 0.4, 2, "WIDE")
DISTRIBUTION = v52.Candidate(-1, "DISTRIBUTION", 6, 1.4, 1.0, 1.5, 0.5, 0.6, 0.5, 0.2, 1, "WIDE")


@dataclass(frozen=True)
class ExitConfig:
    hold_hours: int
    hard_stop_atr: float
    trail_start_hours: int
    trail_atr: float

    @property
    def config_id(self) -> str:
        return (
            f"H{self.hold_hours}_STOP{self.hard_stop_atr:g}"
            f"_TS{self.trail_start_hours}_TR{self.trail_atr:g}"
        ).replace(".", "p")


def exit_configs() -> List[ExitConfig]:
    return [ExitConfig(*row) for row in itertools.product(
        (24, 36, 48, 72),
        (2.5, 3.5, 5.0),
        (999, 24, 36),
        (3.5, 5.0),
    )]


def funding_decimal(points: List[dict], start: int, end: int) -> float:
    return sum(float(point["rate"]) for point in points if start <= int(point["ts"]) < end)


def side_return(side: int, entry: float, exit_price: float) -> float:
    return side * (exit_price / entry - 1.0)


def make_probe_only(
    candidate: v52.Candidate,
    config: ExitConfig,
    rows: List[dict],
    funding: List[dict],
    features: dict,
    signal_index: int,
) -> Optional[v50.Trade]:
    entry_index = signal_index + 1
    end_index = entry_index + candidate.confirmation_hours - 1
    if end_index >= len(rows):
        return None
    entry_ts = int(rows[entry_index]["ts"])
    entry_price = float(rows[entry_index]["open"])
    atr = features["atr24"][signal_index]
    if atr is None or atr <= 0:
        return None
    stop = entry_price - candidate.side * config.hard_stop_atr * float(atr)
    exit_index = end_index
    exit_price = float(rows[end_index]["close"])
    reason = "NO_FOLLOW_THROUGH"
    for cursor in range(entry_index, end_index + 1):
        high = float(rows[cursor]["high"])
        low = float(rows[cursor]["low"])
        stop_hit = low <= stop if candidate.side > 0 else high >= stop
        if stop_hit:
            exit_index = cursor
            exit_price = stop
            reason = "PROBE_STOP"
            break
    exit_ts = int(rows[exit_index]["ts"]) + HOUR
    gross_account = PROBE_GROSS * side_return(candidate.side, entry_price, exit_price)
    funding_account = PROBE_GROSS * candidate.side * funding_decimal(funding, entry_ts, exit_ts)
    return v50.Trade(
        candidate_id=f"{candidate.candidate_id}_{config.config_id}",
        signal_ts=int(rows[signal_index]["ts"]),
        entry_ts=entry_ts,
        add_ts=None,
        exit_ts=exit_ts,
        side=candidate.side,
        mode="EXTREME_PROBE_ONLY",
        probe_gross=PROBE_GROSS,
        add_gross=0.0,
        total_gross=PROBE_GROSS,
        entry_price=entry_price,
        add_price=None,
        exit_price=exit_price,
        gross_pct=gross_account * 100.0,
        funding_pct=funding_account * 100.0,
        base_pct=(gross_account - funding_account - PROBE_GROSS * BASE_COST_PCT / 100.0) * 100.0,
        severe_pct=(gross_account - funding_account - PROBE_GROSS * SEVERE_COST_PCT / 100.0) * 100.0,
        confirmed=False,
        partial_taken=False,
        exit_reason=reason,
    )


def make_confirmed(
    candidate: v52.Candidate,
    config: ExitConfig,
    rows: List[dict],
    funding: List[dict],
    features: dict,
    signal_index: int,
    confirm_index: int,
    extreme: bool,
) -> Optional[v50.Trade]:
    probe_index = signal_index + 1
    full_index = confirm_index + 1
    if full_index >= len(rows):
        return None
    if extreme:
        probe_ts = int(rows[probe_index]["ts"])
        probe_price = float(rows[probe_index]["open"])
        add_ts = int(rows[full_index]["ts"])
        add_price = float(rows[full_index]["open"])
        legs = [(PROBE_GROSS, probe_price, probe_ts), (ADD_GROSS, add_price, add_ts)]
        weighted_entry = (PROBE_GROSS * probe_price + ADD_GROSS * add_price) / FULL_GROSS
        entry_ts = probe_ts
        entry_price = probe_price
        mode = "EXTREME_PROBE_ADD"
    else:
        add_ts = None
        add_price = None
        entry_ts = int(rows[full_index]["ts"])
        entry_price = float(rows[full_index]["open"])
        legs = [(FULL_GROSS, entry_price, entry_ts)]
        weighted_entry = entry_price
        mode = "ARMED_CONFIRMED_FULL"
    atr = features["atr24"][signal_index]
    if atr is None or atr <= 0:
        return None
    atr = float(atr)
    hard_stop = weighted_entry - candidate.side * config.hard_stop_atr * atr
    position_start_index = full_index
    maximum_exit_index = min(position_start_index + config.hold_hours, len(rows) - 1)
    exit_index = maximum_exit_index
    exit_price = float(rows[maximum_exit_index]["close"])
    reason = "TIME"
    best_price = weighted_entry
    for cursor in range(position_start_index, maximum_exit_index + 1):
        high = float(rows[cursor]["high"])
        low = float(rows[cursor]["low"])
        active_stop = hard_stop
        elapsed = cursor - position_start_index
        if elapsed >= config.trail_start_hours:
            trailing = best_price - candidate.side * config.trail_atr * atr
            active_stop = max(hard_stop, trailing) if candidate.side > 0 else min(hard_stop, trailing)
        stop_hit = low <= active_stop if candidate.side > 0 else high >= active_stop
        if stop_hit:
            exit_index = cursor
            exit_price = active_stop
            reason = "HARD_STOP" if elapsed < config.trail_start_hours else "DELAYED_TRAIL"
            break
        best_price = max(best_price, high) if candidate.side > 0 else min(best_price, low)
    exit_ts = int(rows[exit_index]["ts"]) + HOUR
    gross_account = sum(gross * side_return(candidate.side, price, exit_price) for gross, price, _ in legs)
    funding_account = candidate.side * sum(gross * funding_decimal(funding, start, exit_ts) for gross, _, start in legs)
    return v50.Trade(
        candidate_id=f"{candidate.candidate_id}_{config.config_id}",
        signal_ts=int(rows[signal_index]["ts"]),
        entry_ts=entry_ts,
        add_ts=add_ts,
        exit_ts=exit_ts,
        side=candidate.side,
        mode=mode,
        probe_gross=PROBE_GROSS if extreme else 0.0,
        add_gross=ADD_GROSS if extreme else FULL_GROSS,
        total_gross=FULL_GROSS,
        entry_price=entry_price,
        add_price=add_price,
        exit_price=exit_price,
        gross_pct=gross_account * 100.0,
        funding_pct=funding_account * 100.0,
        base_pct=(gross_account - funding_account - FULL_GROSS * BASE_COST_PCT / 100.0) * 100.0,
        severe_pct=(gross_account - funding_account - FULL_GROSS * SEVERE_COST_PCT / 100.0) * 100.0,
        confirmed=True,
        partial_taken=False,
        exit_reason=reason,
    )


def run_candidate(
    candidate: v52.Candidate,
    config: ExitConfig,
    pengu: List[dict],
    btc: List[dict],
    funding: List[dict],
    features: dict,
) -> List[v50.Trade]:
    btc_map = {int(row["ts"]): index for index, row in enumerate(btc)}
    trades: List[v50.Trade] = []
    next_free_ts = 0
    for index in range(200, len(pengu) - 100):
        ts = int(pengu[index]["ts"])
        if ts < next_free_ts:
            continue
        btc_index = btc_map.get(ts)
        if btc_index is None:
            continue
        armed, extreme, level = v52.signal(candidate, pengu, index, features, btc_index)
        if not armed:
            continue
        confirmed_at = v52.confirmation_index(candidate, pengu, features, index, level)
        if confirmed_at is not None:
            trade = make_confirmed(candidate, config, pengu, funding, features, index, confirmed_at, extreme)
        elif extreme:
            trade = make_probe_only(candidate, config, pengu, funding, features, index)
        else:
            next_free_ts = ts + candidate.confirmation_hours * HOUR
            continue
        if trade is None:
            continue
        trades.append(trade)
        next_free_ts = trade.exit_ts + COOLDOWN_HOURS * HOUR
    return trades


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


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def split_metrics(trades: List[v50.Trade], folds: List[Tuple[int, int]]) -> dict:
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


def selection_events(pengu: List[dict], folds: List[Tuple[int, int]]) -> List[dict]:
    cutoff = folds[3][1]
    return [
        event for event in [*v50.wave_events(pengu, 24, 20.0), *v50.wave_events(pengu, 72, 35.0)]
        if int(event["startTs"]) < cutoff
    ]


def evaluate(trades: List[v50.Trade], pengu: List[dict], folds: List[Tuple[int, int]], events: List[dict]) -> dict:
    excluded, exclusion = common.exclude_large_wave_profits(trades, events)
    included_metrics = split_metrics(trades, folds)
    excluded_metrics = split_metrics(excluded, folds)
    wave = v50.capture_metrics(trades, events, 12, -1)
    return {
        "included": included_metrics,
        "excluded": excluded_metrics,
        "wave": wave,
        "exclusion": exclusion,
        "trades": [asdict(trade) for trade in trades],
    }


def passes(item: dict) -> bool:
    included = item["included"]
    excluded = item["excluded"]
    wave = item["wave"]
    return bool(
        included["train"]["trades"] >= 12
        and included["train"]["compoundedReturnPct"] > 0
        and included["trainSevere"]["compoundedReturnPct"] > 0
        and included["validation"]["trades"] >= 2
        and included["validation"]["compoundedReturnPct"] > 0
        and included["validationSevere"]["compoundedReturnPct"] > 0
        and excluded["train"]["compoundedReturnPct"] > 0
        and excluded["trainSevere"]["compoundedReturnPct"] > 0
        and excluded["validation"]["compoundedReturnPct"] > 0
        and excluded["validationSevere"]["compoundedReturnPct"] > 0
        and wave["events"] > 0
        and wave["capturedEvents"] / wave["events"] >= 0.50
        and wave["profitableCapturedEvents"] / wave["events"] >= 0.50
    )


def rank_key(item: dict) -> tuple:
    return (
        item["excluded"]["validationSevere"]["compoundedReturnPct"],
        item["included"]["validationSevere"]["compoundedReturnPct"],
        item["wave"]["profitableCapturedEvents"],
        item["wave"]["capturedEvents"],
        item["excluded"]["trainSevere"]["compoundedReturnPct"],
        item["included"]["trainSevere"]["compoundedReturnPct"],
        item["included"]["train"]["maxDrawdownPct"],
    )


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now = dt.datetime.now(dt.timezone.utc)
    last_complete = archive_source.previous_complete_month(now)
    months = list(archive_source.iter_months(archive_source.ARCHIVE_START, last_complete))
    pengu, pengu_months = archive_source.fetch_archive_klines("PENGUUSDT", months)
    relevant = archive_source.month_pairs(pengu_months)
    btc, _ = archive_source.fetch_archive_klines("BTCUSDT", relevant)
    funding, funding_months = archive_source.fetch_archive_funding("PENGUUSDT", relevant)
    pengu, btc, funding, _ = archive_source.trim_to_complete_funding_window(pengu, btc, funding, funding_months)
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    folds = v50.fold_bounds(pengu, 5)
    events = selection_events(pengu, folds)

    flash_rows: Dict[str, List[v50.Trade]] = {}
    distribution_rows: Dict[str, List[v50.Trade]] = {}
    for position, config in enumerate(exit_configs(), start=1):
        if position % 12 == 0:
            print(f"Exit configs {position}/{len(exit_configs())}")
        flash_rows[config.config_id] = run_candidate(FLASH, config, pengu, btc, funding, features)
        distribution_rows[config.config_id] = run_candidate(DISTRIBUTION, config, pengu, btc, funding, features)

    passed = []
    diagnostics = []
    for flash_config, distribution_config in itertools.product(exit_configs(), exit_configs()):
        combined = combine_same_side(
            distribution_rows[distribution_config.config_id],
            flash_rows[flash_config.config_id],
        )
        item = evaluate(combined, pengu, folds, events)
        item["flashExit"] = asdict(flash_config)
        item["flashExitId"] = flash_config.config_id
        item["distributionExit"] = asdict(distribution_config)
        item["distributionExitId"] = distribution_config.config_id
        diagnostics.append(item)
        if passes(item):
            passed.append(item)
    passed.sort(key=rank_key, reverse=True)
    diagnostics.sort(key=rank_key, reverse=True)
    selected = passed[0] if passed else None

    holdout_pass = False
    if selected:
        h = selected["included"]["holdout"]
        hs = selected["included"]["holdoutSevere"]
        he = selected["excluded"]["holdout"]
        hes = selected["excluded"]["holdoutSevere"]
        holdout_pass = bool(
            h["trades"] >= 3
            and h["compoundedReturnPct"] > 0
            and hs["compoundedReturnPct"] > 0
            and he["compoundedReturnPct"] > 0
            and hes["compoundedReturnPct"] > 0
            and (h["profitFactor"] or 0) >= 1.05
        )
    status = "SHORT_EXIT_HOLDOUT_PASS" if selected and holdout_pass else "NO_ROBUST_SHORT_EXIT"
    result = rounded({
        "version": 60,
        "strategyId": "PENGU_V60_DELAYED_EXIT_SHORT",
        "generatedAt": now.isoformat(),
        "status": status,
        "entryFlash": asdict(FLASH),
        "entryDistribution": asdict(DISTRIBUTION),
        "exitConfigCount": len(exit_configs()),
        "combinationCount": len(exit_configs()) ** 2,
        "passedSelection": len(passed),
        "selected": selected,
        "holdoutPassed": holdout_pass,
        "topDiagnostics": diagnostics[:30],
        "safety": {
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "ordersSent": False,
            "holdoutUsedForSelection": False,
        },
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v60-delayed-exit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    if selected:
        report_values = {
            "full": selected["included"]["full"],
            "fullSevere": selected["included"]["fullSevere"],
            "excluded": selected["excluded"]["full"],
            "excludedSevere": selected["excluded"]["fullSevere"],
            "holdout": selected["included"]["holdout"],
            "holdoutSevere": selected["included"]["holdoutSevere"],
            "holdoutExcluded": selected["excluded"]["holdout"],
            "holdoutExcludedSevere": selected["excluded"]["holdoutSevere"],
        }
    else:
        report_values = {key: {} for key in ("full", "fullSevere", "excluded", "excludedSevere", "holdout", "holdoutSevere", "holdoutExcluded", "holdoutExcludedSevere")}
    report = [
        "# PENGU V60 Delayed Exit Short",
        "",
        f"- Status: **{status}**",
        f"- Selection passes: {len(passed)}",
        f"- Flash exit: **{selected['flashExitId'] if selected else 'NONE'}**",
        f"- Distribution exit: **{selected['distributionExitId'] if selected else 'NONE'}**",
        f"- Holdout pass: **{'YES' if holdout_pass else 'NO'}**",
        "",
        f"- Full included: {report_values['full'].get('compoundedReturnPct')}% / PF {report_values['full'].get('profitFactor')} / DD {report_values['full'].get('maxDrawdownPct')}%",
        f"- Full Severe: {report_values['fullSevere'].get('compoundedReturnPct')}%",
        f"- Full waves excluded: {report_values['excluded'].get('compoundedReturnPct')}% / PF {report_values['excluded'].get('profitFactor')} / DD {report_values['excluded'].get('maxDrawdownPct')}%",
        f"- Full excluded Severe: {report_values['excludedSevere'].get('compoundedReturnPct')}%",
        f"- Holdout included: {report_values['holdout'].get('compoundedReturnPct')}%",
        f"- Holdout Severe: {report_values['holdoutSevere'].get('compoundedReturnPct')}%",
        f"- Holdout excluded: {report_values['holdoutExcluded'].get('compoundedReturnPct')}%",
        f"- Holdout excluded Severe: {report_values['holdoutExcludedSevere'].get('compoundedReturnPct')}%",
        "",
        "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v60-delayed-exit.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
