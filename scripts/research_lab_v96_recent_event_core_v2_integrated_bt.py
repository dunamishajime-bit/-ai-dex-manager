from __future__ import annotations

import argparse
import datetime as py_dt
import json
from pathlib import Path

import research_lab_v96_v52_pengu_dual_ls_v1_combined_bt as combined

UTC = py_dt.timezone.utc
END = py_dt.datetime(2026, 8, 3, tzinfo=UTC)


class FrozenDateTime(py_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return END.replace(tzinfo=None)
        return END.astimezone(tz)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--pengu-replay", required=True)
    parser.add_argument("--v96-event-v2", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    research = json.loads(Path(args.v96_event_v2).read_text(encoding="utf-8"))
    replay = research["selectedReplay"]

    original_datetime = combined.dt.datetime
    original_build_core = combined.build_core
    combined.dt.datetime = FrozenDateTime
    try:
        baseline = combined.analyze(Path(args.stock_cache_dir), Path(args.pengu_replay))

        def event_build_core(start_ms: int, end_ms: int) -> dict:
            normal = [row for row in replay["normal"] if start_ms <= int(row["ts"]) < end_ms]
            severe = [row for row in replay["severe"] if start_ms <= int(row["ts"]) < end_ms]
            if not normal or not severe:
                raise RuntimeError("V96 event V2 replay is empty")
            return {
                "normal": normal,
                "severe": severe,
                "diagnostics": {
                    "normalRows": len(normal),
                    "severeRows": len(severe),
                    "first": combined.iso_ms(int(normal[0]["ts"])),
                    "last": combined.iso_ms(int(normal[-1]["ts"])),
                    "maximumDesiredCoreGross": max(float(row.get("gross", 0.0)) for row in normal),
                    "legacyPenguIncluded": False,
                    "source": "V96_RECENT_EVENT_CORE_V2_6H selectedReplay",
                    "variantId": replay["variantId"],
                    "strategyId": replay["strategyId"],
                },
            }

        combined.build_core = event_build_core
        redesigned = combined.analyze(Path(args.stock_cache_dir), Path(args.pengu_replay))
    finally:
        combined.build_core = original_build_core
        combined.dt.datetime = original_datetime

    redesigned["strategyId"] = "DISDEX_V96_RECENT_EVENT_CORE_V2_PLUS_PENGU_DUAL_LS_V1_PLUS_V52_UNIFIED_BT"
    redesigned["architecture"]["v96"] = f"V96_RECENT_EVENT_CORE_V2_6H ({replay['variantId']}); legacy V96 unchanged"

    def row(result: dict, scenario: str, window: str) -> dict:
        return result["results"][scenario]["CORE_FIRST"][window]

    b_full = row(baseline, "NORMAL", "full")
    n_full = row(redesigned, "NORMAL", "full")
    b_recent = row(baseline, "NORMAL", "holdoutFreshStart")
    n_recent = row(redesigned, "NORMAL", "holdoutFreshStart")
    b_severe = row(baseline, "SEVERE", "full")
    n_severe = row(redesigned, "SEVERE", "full")
    b_severe_recent = row(baseline, "SEVERE", "holdoutFreshStart")
    n_severe_recent = row(redesigned, "SEVERE", "holdoutFreshStart")

    comparison = {
        "baseline": {
            "normalFull": {k: b_full[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "reused20260311Window": {k: b_recent[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeFull": {k: b_severe[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeReused20260311Window": {k: b_severe_recent[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "v96SleeveFull": b_full["bySleeve"]["V96_CORE"],
            "v96SleeveReused20260311Window": b_recent["bySleeve"]["V96_CORE"],
        },
        "redesigned": {
            "normalFull": {k: n_full[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "reused20260311Window": {k: n_recent[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeFull": {k: n_severe[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeReused20260311Window": {k: n_severe_recent[k] for k in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "v96SleeveFull": n_full["bySleeve"]["V96_CORE"],
            "v96SleeveReused20260311Window": n_recent["bySleeve"]["V96_CORE"],
        },
        "deltaRedesignedMinusBaseline": {
            "normalFullReturnPctPoints": n_full["compoundedReturnPct"] - b_full["compoundedReturnPct"],
            "reused20260311WindowReturnPctPoints": n_recent["compoundedReturnPct"] - b_recent["compoundedReturnPct"],
            "severeFullReturnPctPoints": n_severe["compoundedReturnPct"] - b_severe["compoundedReturnPct"],
            "severeReused20260311WindowReturnPctPoints": n_severe_recent["compoundedReturnPct"] - b_severe_recent["compoundedReturnPct"],
            "v96FullReturnPctPoints": n_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"] - b_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"],
        },
    }

    passed = bool(
        research["selectedPassesLateEvaluation"]
        and research["selectedBeatsPreviousT8"]
        and n_full["compoundedReturnPct"] > b_full["compoundedReturnPct"]
        and n_recent["compoundedReturnPct"] > b_recent["compoundedReturnPct"]
        and n_severe["compoundedReturnPct"] > b_severe["compoundedReturnPct"]
        and n_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"] > 49.57
        and n_full["observedMaximumTotalGross"] <= combined.TOTAL_GROSS_CAP + 1e-9
        and n_recent["observedMaximumTotalGross"] <= combined.TOTAL_GROSS_CAP + 1e-9
    )

    payload = {
        "status": "V96_EVENT_V2_INTEGRATED_PASS" if passed else "V96_EVENT_V2_INTEGRATED_DIAGNOSTIC",
        "researchStatus": research["status"],
        "selected": research["selected"],
        "comparison": comparison,
        "baselineResult": baseline,
        "redesignedResult": redesigned,
        "checks": {
            "selectedLateEvaluationPass": research["selectedPassesLateEvaluation"],
            "selectedBeatsT8": research["selectedBeatsPreviousT8"],
            "portfolioFullImproved": n_full["compoundedReturnPct"] > b_full["compoundedReturnPct"],
            "portfolioReused20260311WindowImproved": n_recent["compoundedReturnPct"] > b_recent["compoundedReturnPct"],
            "severeFullImproved": n_severe["compoundedReturnPct"] > b_severe["compoundedReturnPct"],
            "v96SleeveAbove49p57": n_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"] > 49.57,
            "grossCapPass": n_full["observedMaximumTotalGross"] <= combined.TOTAL_GROSS_CAP + 1e-9,
        },
        "limitations": [
            "The 2026 evaluation windows are reused evidence from earlier research and are not pristine holdout.",
            "The candidate was ranked only on the first three chronological folds inside the recent regime search.",
            "6h entries use completed-bar signals and next-bar execution; intrabar high/low ordering is not used.",
        ],
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    }
    (output / "v96-recent-event-core-v2-integrated.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# V96 Recent Event Core V2 — Integrated Portfolio",
        "",
        f"- Status: **{payload['status']}**",
        f"- Selected: **{replay['variantId']}**",
        f"- V96 sleeve Full: baseline {b_full['bySleeve']['V96_CORE']['compoundedReturnPct']}% -> **{n_full['bySleeve']['V96_CORE']['compoundedReturnPct']}%**",
        f"- Portfolio NORMAL Full: {b_full['compoundedReturnPct']}% -> **{n_full['compoundedReturnPct']}%**",
        f"- Portfolio DD: {b_full['maxDrawdownPct']}% -> **{n_full['maxDrawdownPct']}%**",
        f"- Portfolio PF: {b_full['profitFactor']} -> **{n_full['profitFactor']}**",
        f"- Reused 2026-03-11 window: {b_recent['compoundedReturnPct']}% -> **{n_recent['compoundedReturnPct']}%**",
        f"- SEVERE Full: {b_severe['compoundedReturnPct']}% -> **{n_severe['compoundedReturnPct']}%**",
        f"- Checks: {payload['checks']}",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-event-core-v2-integrated.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
