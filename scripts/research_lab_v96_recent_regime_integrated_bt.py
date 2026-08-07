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


def load_replay(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    replay = payload["selectedReplay"]
    return payload, replay


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stock-cache-dir", default=".cache/aster-only-v39-overnight-open")
    parser.add_argument("--pengu-replay", default=".research-state/v96-recent-regime-redesign/pengu-evidence-replay.json")
    parser.add_argument("--v96-redesign", default=".research-state/v96-recent-regime-redesign/v96-recent-regime-redesign.json")
    parser.add_argument("--output-dir", default=".research-state/v96-recent-regime-redesign")
    args = parser.parse_args()

    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    redesign_payload, replay = load_replay(Path(args.v96_redesign))

    original_datetime = combined.dt.datetime
    original_build_core = combined.build_core
    combined.dt.datetime = FrozenDateTime
    try:
        baseline = combined.analyze(Path(args.stock_cache_dir), Path(args.pengu_replay))

        def recent_build_core(start_ms: int, end_ms: int) -> dict:
            normal = [row for row in replay["normal"] if start_ms <= int(row["ts"]) < end_ms]
            severe = [row for row in replay["severe"] if start_ms <= int(row["ts"]) < end_ms]
            if not normal or not severe:
                raise RuntimeError("recent V96 replay rows are empty")
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
                    "source": "V96_RECENT_REGIME_REDESIGN_V1 selectedReplay",
                    "variantId": replay["variantId"],
                    "strategyId": replay["strategyId"],
                },
            }

        combined.build_core = recent_build_core
        redesigned = combined.analyze(Path(args.stock_cache_dir), Path(args.pengu_replay))
    finally:
        combined.build_core = original_build_core
        combined.dt.datetime = original_datetime

    redesigned["strategyId"] = "DISDEX_V96_RECENT_ADAPTIVE_V1_PLUS_PENGU_DUAL_LS_V1_PLUS_V52_UNIFIED_BT"
    redesigned["architecture"]["v96"] = f"V96_RECENT_ADAPTIVE_V1 ({replay['variantId']}); legacy V96 unchanged"
    redesigned["v96Redesign"] = {
        "researchStatus": redesign_payload["status"],
        "selected": redesign_payload["selected"],
        "selectedPassesFreshHoldout": redesign_payload["selectedPassesFreshHoldout"],
        "holdoutUsedForRanking": redesign_payload["selectionPolicy"]["holdoutUsedForRanking"],
    }

    def row(result: dict, scenario: str, window: str) -> dict:
        return result["results"][scenario]["CORE_FIRST"][window]

    b_full = row(baseline, "NORMAL", "full")
    n_full = row(redesigned, "NORMAL", "full")
    b_hold = row(baseline, "NORMAL", "holdoutFreshStart")
    n_hold = row(redesigned, "NORMAL", "holdoutFreshStart")
    b_severe = row(baseline, "SEVERE", "full")
    n_severe = row(redesigned, "SEVERE", "full")
    b_severe_hold = row(baseline, "SEVERE", "holdoutFreshStart")
    n_severe_hold = row(redesigned, "SEVERE", "holdoutFreshStart")

    comparison = {
        "baseline": {
            "normalFull": {key: b_full[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "normalHoldout": {key: b_hold[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeFull": {key: b_severe[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeHoldout": {key: b_severe_hold[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "v96SleeveFull": b_full["bySleeve"]["V96_CORE"],
            "v96SleeveHoldout": b_hold["bySleeve"]["V96_CORE"],
        },
        "redesigned": {
            "normalFull": {key: n_full[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "normalHoldout": {key: n_hold[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeFull": {key: n_severe[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "severeHoldout": {key: n_severe_hold[key] for key in ("compoundedReturnPct", "cagrPct", "maxDrawdownPct", "profitFactor")},
            "v96SleeveFull": n_full["bySleeve"]["V96_CORE"],
            "v96SleeveHoldout": n_hold["bySleeve"]["V96_CORE"],
        },
        "deltaRedesignedMinusBaseline": {
            "normalFullReturnPctPoints": n_full["compoundedReturnPct"] - b_full["compoundedReturnPct"],
            "normalHoldoutReturnPctPoints": n_hold["compoundedReturnPct"] - b_hold["compoundedReturnPct"],
            "severeFullReturnPctPoints": n_severe["compoundedReturnPct"] - b_severe["compoundedReturnPct"],
            "severeHoldoutReturnPctPoints": n_severe_hold["compoundedReturnPct"] - b_severe_hold["compoundedReturnPct"],
            "v96FullReturnPctPoints": n_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"] - b_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"],
            "v96HoldoutReturnPctPoints": n_hold["bySleeve"]["V96_CORE"]["compoundedReturnPct"] - b_hold["bySleeve"]["V96_CORE"]["compoundedReturnPct"],
        },
    }

    integrated_pass = bool(
        redesign_payload["selectedPassesFreshHoldout"]
        and n_full["compoundedReturnPct"] > b_full["compoundedReturnPct"]
        and n_hold["compoundedReturnPct"] > b_hold["compoundedReturnPct"]
        and n_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"] > b_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"]
        and n_hold["bySleeve"]["V96_CORE"]["compoundedReturnPct"] > 0.0
        and n_severe["compoundedReturnPct"] > b_severe["compoundedReturnPct"]
        and n_full["observedMaximumTotalGross"] <= combined.TOTAL_GROSS_CAP + 1e-9
        and n_hold["observedMaximumTotalGross"] <= combined.TOTAL_GROSS_CAP + 1e-9
    )

    payload = {
        "status": "V96_RECENT_INTEGRATED_PASS" if integrated_pass else "V96_RECENT_INTEGRATED_DIAGNOSTIC",
        "comparison": comparison,
        "baselineResult": baseline,
        "redesignedResult": redesigned,
        "checks": {
            "selectedFreshHoldoutPass": redesign_payload["selectedPassesFreshHoldout"],
            "portfolioFullImproved": n_full["compoundedReturnPct"] > b_full["compoundedReturnPct"],
            "portfolioHoldoutImproved": n_hold["compoundedReturnPct"] > b_hold["compoundedReturnPct"],
            "v96FullImproved": n_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"] > b_full["bySleeve"]["V96_CORE"]["compoundedReturnPct"],
            "v96HoldoutPositive": n_hold["bySleeve"]["V96_CORE"]["compoundedReturnPct"] > 0.0,
            "severeFullImproved": n_severe["compoundedReturnPct"] > b_severe["compoundedReturnPct"],
            "grossCapPass": n_full["observedMaximumTotalGross"] <= combined.TOTAL_GROSS_CAP + 1e-9,
        },
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    }
    (output / "v96-recent-integrated.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# V96 Recent Regime Redesign — Integrated Portfolio",
        "",
        f"- Status: **{payload['status']}**",
        f"- Selected V96: **{replay['variantId']}**",
        "",
        "## V96 sleeve",
        f"- Baseline Full: {b_full['bySleeve']['V96_CORE']['compoundedReturnPct']}% -> Redesign **{n_full['bySleeve']['V96_CORE']['compoundedReturnPct']}%**",
        f"- Baseline Holdout: {b_hold['bySleeve']['V96_CORE']['compoundedReturnPct']}% -> Redesign **{n_hold['bySleeve']['V96_CORE']['compoundedReturnPct']}%**",
        "",
        "## Full portfolio NORMAL",
        f"- Baseline: {b_full['compoundedReturnPct']}% / CAGR {b_full['cagrPct']}% / DD {b_full['maxDrawdownPct']}% / PF {b_full['profitFactor']}",
        f"- Redesign: **{n_full['compoundedReturnPct']}%** / CAGR **{n_full['cagrPct']}%** / DD **{n_full['maxDrawdownPct']}%** / PF **{n_full['profitFactor']}**",
        "",
        "## Fresh Holdout NORMAL",
        f"- Baseline: {b_hold['compoundedReturnPct']}% / DD {b_hold['maxDrawdownPct']}% / PF {b_hold['profitFactor']}",
        f"- Redesign: **{n_hold['compoundedReturnPct']}%** / DD **{n_hold['maxDrawdownPct']}%** / PF **{n_hold['profitFactor']}**",
        "",
        "## SEVERE",
        f"- Full: {b_severe['compoundedReturnPct']}% -> **{n_severe['compoundedReturnPct']}%**",
        f"- Holdout: {b_severe_hold['compoundedReturnPct']}% -> **{n_severe_hold['compoundedReturnPct']}%**",
        "",
        f"- Checks: {payload['checks']}",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-integrated.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
