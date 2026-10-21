"""Research-only V12 SHORT STOP/Cooldown decomposition for Task 9.

The fixed accepted baseline is kept as the only admission boundary.  This
script changes only the research overlay applied to accepted V12 SHORT
positions; it never promotes rejected candidates and never connects to a
venue or Production runtime.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from task9_fixed_ledger_replay_20261020 import (
    CANONICAL_ROOT,
    OUTPUT,
    _H1Source,
    load_canonical,
    replay_case,
    sha256_file,
    t9,
)


FOCUSED_OUTPUT = OUTPUT / "fixed-ledger-replay" / "focused-v12-short"


def _bootstrap_sources():
    t9.Path.write_text = t9._redirect_legacy_write_text
    source, helper = t9.task8.legacy.bootstrap()
    t9.Path.write_text = t9._path_write_text
    return source, _H1Source(helper.base.s.w.bars)


def _plans() -> list[dict]:
    plans = []
    base = {
        "strategy": "V12",
        "sides": ["SHORT"],
        "stop_pct": 0.020,
        "mfe_gate_pct": 0.010,
    }
    # STOP/Cooldown decomposition: hold the stop definition fixed while
    # changing only the same-direction re-entry holdoff.
    for hours in (0, 3, 6, 12, 24):
        plans.append({
            **base,
            "id": f"V12_SHORT_STOP2_ARM12_MFE1_COOLDOWN{hours}H",
            "arm_hours": 12,
            "reentry_hours": hours,
            "study_group": "STOP_COOLDOWN_SEPARATION",
        })
    # Arm-time sensitivity with cooldown disabled isolates the timing effect.
    for hours in (0, 0.25, 0.5, 1, 2, 3, 6, 12):
        plans.append({
            **base,
            "id": f"V12_SHORT_STOP2_ARM{str(hours).replace('.', 'P')}H_MFE1_NO_COOLDOWN",
            "arm_hours": hours,
            "reentry_hours": 0,
            "study_group": "ARM_TIME_NO_COOLDOWN",
        })
    # ATR alternatives are a separate robustness group, not an automatic
    # replacement for the fixed-percent candidate.
    for mult, floor, cap in ((1.25, 0.008, 0.035), (1.5, 0.010, 0.040), (2.0, 0.010, 0.050)):
        plans.append({
            "id": f"V12_SHORT_ATR{str(mult).replace('.', 'P')}_ARM6_MFE1_R12",
            "strategy": "V12",
            "sides": ["SHORT"],
            "atr_mult": mult,
            "atr_floor_pct": floor,
            "atr_cap_pct": cap,
            "arm_hours": 6,
            "mfe_gate_pct": 0.010,
            "reentry_hours": 12,
            "study_group": "ATR_ROBUSTNESS",
        })
    return plans


def _summarize(metrics: dict, audit: dict, cost: int) -> dict:
    expected = t9.BASELINE_EXPECTED[cost]
    oos = metrics.get("oos") or {}
    cooldown = audit.get("cooldown_audit") or []
    return {
        "cost_bps": cost,
        "final_equity_jpy": metrics["final_equity_jpy"],
        "final_equity_ratio": metrics["final_equity_jpy"] / expected["final"],
        "profit_factor": metrics["profit_factor"],
        "maximum_mtm_drawdown_pct": metrics["maximum_mtm_drawdown_pct"],
        "dd_improvement_pp": metrics["maximum_mtm_drawdown_pct"] - expected["dd"],
        "win_rate": metrics["win_rate"],
        "closed_trades": metrics["closed_trades"],
        "accounting": metrics["accounting"],
        "oos": oos,
        "stop_triggered": audit["observations"]["triggered"],
        "original_winner_triggered": audit["observations"]["original_winner_triggered"],
        "original_loser_triggered": audit["observations"]["original_loser_triggered"],
        "original_unsettled_triggered": audit["observations"]["original_unsettled_triggered"],
        "cooldown_rejected": audit["observations"]["reentry_rejected"],
        "cooldown_overlap_before_stop": sum(
            float(item.get("elapsed_hours_from_stop", 0.0)) < 0.0 for item in cooldown
        ),
        "cooldown_holdoff_after_stop": sum(
            float(item.get("elapsed_hours_from_stop", 0.0)) >= 0.0 for item in cooldown
        ),
        "stop_reason_counts": dict(audit["observations"]["by_reason"]),
    }


def main() -> None:
    FOCUSED_OUTPUT.mkdir(parents=True, exist_ok=True)
    source, h1_source = _bootstrap_sources()
    cases = []
    for plan in _plans():
        results = {}
        for cost in (10, 30):
            baseline_rows, baseline_events, _ledger, _events = load_canonical(cost)
            case_dir = FOCUSED_OUTPUT / plan["study_group"] / plan["id"] / f"{cost}bps"
            metrics, audit, _rows = replay_case(
                baseline_rows,
                baseline_events,
                [plan],
                source,
                cost,
                case_dir,
                h1_source,
            )
            (case_dir / "audit.json").write_text(
                json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            results[str(cost)] = _summarize(metrics, audit, cost)
        cases.append({"plan": plan, "results": results})
        print("TASK9_V12_SHORT_FOCUSED_CASE", plan["id"], flush=True)
    summary = {
        "status": "COMPLETE_RESEARCH_ONLY_NONCANONICAL",
        "classification": "RESEARCH_ONLY_NONCANONICAL",
        "contract": "FIXED_ACCEPTED_LEDGER_LIFECYCLE_OVERLAY",
        "baseline_sha256": {
            str(cost): sha256_file(load_canonical(cost)[2]) for cost in (10, 30)
        },
        "case_count": len(cases),
        "cases": cases,
        "source_sha256": {
            "task9_audit": sha256_file(Path(t9.__file__)),
            "fixed_replay": sha256_file(Path(__file__).with_name("task9_fixed_ledger_replay_20261020.py")),
            "focused_script": sha256_file(Path(__file__)),
        },
        "production_changes": 0,
    }
    (FOCUSED_OUTPUT / "v12-short-deep-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("TASK9_V12_SHORT_FOCUSED_COMPLETE", FOCUSED_OUTPUT, flush=True)


if __name__ == "__main__":
    main()
