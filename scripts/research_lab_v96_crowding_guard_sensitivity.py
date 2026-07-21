from __future__ import annotations

import datetime as dt
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List

import research_lab_v96_crowding_guarded_boost_replay as guard

v95 = guard.v95
r1 = guard.r1
core = guard.core
basis = guard.basis
BAR = guard.BAR

THRESHOLDS = (0.0, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0)
CANDIDATES = tuple(
    guard.GuardConfig(
        name=f"BOOST2P5_T6_FUND_{str(value).replace('.', 'P')}_L1",
        family="FUNDING_LOCAL_SENSITIVITY",
        max_funding_bps=value,
        funding_lookback=1,
    )
    for value in THRESHOLDS
)


def annual_periods(times: List[int]) -> Dict[str, tuple[int, int]]:
    result: Dict[str, tuple[int, int]] = {}
    for year in (2023, 2024, 2025, 2026):
        start = int(dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        end = int(dt.datetime(year + 1, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        if year == 2026:
            end = times[-1] + BAR
        result[str(year)] = (start, end)
    return result


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    raw = v95.v89.build_raw()
    times = list(raw["times"])
    premiums, coverage = basis.build_premiums(times)
    targets, _ = v95.v90.stabilize(raw["targets"], times, v95.TARGET_CONFIG)
    base_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_core = core.v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    features = core.v34.features_with_vol(times, targets, raw["bars"], raw["indexes"], raw["funding"])
    base_rows = core.core_rows(core.CoreConfig(), times, base_core, features)
    severe_rows = core.core_rows(core.CoreConfig(), times, severe_core, features)
    context = v95.v89.context_for(targets, raw, base_core, features)

    baseline_config = guard.GuardConfig("BASELINE", "BASELINE", add=0.0)
    baseline_normal = guard.simulate(
        baseline_config, raw, premiums, targets, times, base_core, features, base_rows, context, 10.0, 0.0, 0
    )
    baseline_severe = guard.simulate(
        baseline_config, raw, premiums, targets, times, severe_core, features, severe_rows, context, 50.0, 3.0, 1
    )
    full = (times[0], times[-1] + BAR)
    periods = annual_periods(times)
    baseline_full = {
        "normal": r1.metrics(baseline_normal["rows"], *full),
        "severe": r1.metrics(baseline_severe["rows"], *full),
    }
    baseline_annual = {
        year: {
            "normal": r1.metrics(baseline_normal["rows"], start, end),
            "severe": r1.metrics(baseline_severe["rows"], start, end),
        }
        for year, (start, end) in periods.items()
    }

    rows = []
    details = {}
    for config in CANDIDATES:
        normal = guard.simulate(
            config, raw, premiums, targets, times, base_core, features, base_rows, context, 10.0, 0.0, 0
        )
        severe = guard.simulate(
            config, raw, premiums, targets, times, severe_core, features, severe_rows, context, 50.0, 3.0, 1
        )
        normal_full = r1.metrics(normal["rows"], *full)
        severe_full = r1.metrics(severe["rows"], *full)
        annual = {
            year: {
                "normal": r1.metrics(normal["rows"], start, end),
                "severe": r1.metrics(severe["rows"], start, end),
            }
            for year, (start, end) in periods.items()
        }
        annual_delta = {
            year: {
                "normal": annual[year]["normal"]["compoundedReturnPct"] - baseline_annual[year]["normal"]["compoundedReturnPct"],
                "severe": annual[year]["severe"]["compoundedReturnPct"] - baseline_annual[year]["severe"]["compoundedReturnPct"],
            }
            for year in periods
        }
        event = normal["eventSummary"]
        severe_event = severe["eventSummary"]
        direct = [r1.finite(item.get("directDelta")) for item in normal["events"]]
        positive_events = sum(value > 0 for value in direct)
        pass_basic = bool(
            normal_full["compoundedReturnPct"] > baseline_full["normal"]["compoundedReturnPct"]
            and severe_full["compoundedReturnPct"] > baseline_full["severe"]["compoundedReturnPct"]
            and all(annual_delta[year]["normal"] >= -1e-9 for year in periods)
            and all(annual_delta[year]["severe"] >= -1e-9 for year in periods)
            and normal_full["maxDrawdownPct"] >= baseline_full["normal"]["maxDrawdownPct"] - 1.0
            and int(event["count"]) >= 5
            and len(event["years"]) >= 2
            and len(event["symbols"]) >= 2
            and r1.finite(event["topPositiveEventShare"]) <= 0.50
            and positive_events / len(direct) >= 0.60 if direct else False
        )
        row = {
            "config": asdict(config),
            "thresholdBps": config.max_funding_bps,
            "screenPass": pass_basic,
            "fullNormalDeltaPctPoints": normal_full["compoundedReturnPct"] - baseline_full["normal"]["compoundedReturnPct"],
            "fullSevereDeltaPctPoints": severe_full["compoundedReturnPct"] - baseline_full["severe"]["compoundedReturnPct"],
            "drawdownDeltaPctPoints": normal_full["maxDrawdownPct"] - baseline_full["normal"]["maxDrawdownPct"],
            "annualDelta": annual_delta,
            "normalEventSummary": event,
            "severeEventSummary": severe_event,
            "positiveEventRate": positive_events / len(direct) if direct else 0.0,
            "events": normal["events"],
        }
        rows.append(row)
        details[config.name] = {"normal": normal_full, "severe": severe_full, "annual": annual}

    rows.sort(key=lambda item: float(item["thresholdBps"]))
    pass_indices = {index for index, item in enumerate(rows) if item["screenPass"]}
    for index, item in enumerate(rows):
        item["adjacentPass"] = bool(
            item["screenPass"]
            and ((index - 1 in pass_indices) or (index + 1 in pass_indices))
        )
    result = r1.rounded({
        "strategyId": "V96_CROWDING_GUARD_LOCAL_SENSITIVITY",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "researchPolicy": {
            "productionChanged": False,
            "liveChanged": False,
            "ordersSent": False,
            "localSensitivityOnly": True,
            "promotionAllowed": False,
        },
        "coverage": coverage,
        "baseline": {"full": baseline_full, "annual": baseline_annual},
        "screen": rows,
        "screenPassedCount": sum(bool(item["screenPass"]) for item in rows),
        "adjacentPassedCount": sum(bool(item["adjacentPass"]) for item in rows),
        "details": details,
        "limitations": [
            "This is a local sensitivity test around the previously observed 1 bps guard, not a new optimization grid.",
            "No 2025 or 2026 activation is itself a lack of Forward evidence, even if annual delta is zero.",
            "No candidate changes Production or submits orders.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    json_path = state_dir / "v96-crowding-guard-sensitivity.json"
    md_path = state_dir / "v96-crowding-guard-sensitivity.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# V96 Crowding Guard Local Sensitivity",
        "",
        f"- Screen passes: {result['screenPassedCount']}",
        f"- Adjacent passes: {result['adjacentPassedCount']}",
        "- Production changed: **NO**",
        "",
        "| Funding cap bps | Pass | Adjacent | Full N | Full S | DD | Events | Positive rate | 2023 N/S | 2024 N/S | 2025 N/S | 2026 N/S |",
        "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |",
    ]
    for item in result["screen"]:
        annual = item["annualDelta"]
        report.append(
            f"| {item['thresholdBps']} | {'YES' if item['screenPass'] else 'NO'} | "
            f"{'YES' if item['adjacentPass'] else 'NO'} | {item['fullNormalDeltaPctPoints']} | "
            f"{item['fullSevereDeltaPctPoints']} | {item['drawdownDeltaPctPoints']} | "
            f"{item['normalEventSummary']['count']} | {item['positiveEventRate']} | "
            f"{annual['2023']['normal']}/{annual['2023']['severe']} | "
            f"{annual['2024']['normal']}/{annual['2024']['severe']} | "
            f"{annual['2025']['normal']}/{annual['2025']['severe']} | "
            f"{annual['2026']['normal']}/{annual['2026']['severe']} |"
        )
    md_path.write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
