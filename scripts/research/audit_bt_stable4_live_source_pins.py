#!/usr/bin/env python3
"""Compare STABLE4 research source commits to independently observed LIVE service commits.

Read-only local evidence reconciliation; source SHA match does not certify execution parity.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

TRADING_MODELS = frozenset({"V4", "PENGU", "Q102", "V52", "HYPE", "IDLE", "FET"})
RISK_SERVICE = "SharedRisk"
COMMIT = re.compile(r"^[a-f0-9]{40}$")


def compare(study: dict, live: dict) -> dict:
    if study.get("schema") != "disdex-bt-stable4-research-source-audit/v1":
        raise ValueError("Research audit schema mismatch")
    if live.get("schema") != "disdex-bt-vps-entrypoint-parity/v1" or not live.get("all_entrypoints_verified"):
        raise ValueError("VPS entrypoint evidence is absent or incomplete")
    rows = live.get("rows")
    if not isinstance(rows, list) or len(rows) != len(TRADING_MODELS) + 1:
        raise ValueError("Expected exactly eight named source entrypoint records (including SharedRisk)")
    pins = {}
    for row in rows:
        name, sha = row.get("runner"), row.get("git_commit")
        if name in pins or name not in (TRADING_MODELS | {RISK_SERVICE}) or not isinstance(sha, str) or not COMMIT.fullmatch(sha) or row.get("verified") is not True:
            raise ValueError("Ambiguous or unverified live runner source")
        pins[name] = sha
    if set(pins) != TRADING_MODELS | {RISK_SERVICE}:
        raise ValueError("Live source coverage mismatch")
    scenarios = study.get("scenarios", {})
    if set(scenarios) != {"10", "30"}:
        raise ValueError("Expected independent 10bps and 30bps scenarios")
    scenario_reports = {}
    for cost in ("10", "30"):
        scenario = scenarios[cost]
        source_models = scenario.get("source_models", {})
        if set(source_models) != TRADING_MODELS:
            raise ValueError(f"{cost}bps: missing or unexpected research source categories")
        model_details = []
        mismatch_exits = 0
        total = 0
        for name in sorted(TRADING_MODELS):
            info = source_models[name]
            ids = info.get("source_identifiers")
            if not isinstance(ids, list) or not ids:
                raise ValueError(f"{cost}bps {name}: no source evidence")
            source_count = 0
            all_match = True
            observed_sha_list = []
            for entry in ids:
                sha, n = entry.get("sha"), entry.get("trades")
                if not isinstance(sha, str) or not COMMIT.fullmatch(sha) or type(n) is not int or n < 0:
                    raise ValueError(f"{cost}bps {name}: invalid source SHA or trade count")
                source_count += n
                observed_sha_list.append(sha)
                if sha != pins[name]:
                    all_match = False
                    mismatch_exits += n
            expected = info.get("modeled_exits")
            if type(expected) is not int or source_count != expected:
                raise ValueError(f"{cost}bps {name}: modeled exit count mismatch")
            total += source_count
            model_details.append({
                "model": name,
                "modeled_exits": source_count,
                "source_shas": observed_sha_list,
                "observed_live_sha": pins[name],
                "source_sha_matches_live": all_match,
                "execution_parity_certified": False,
                "exit_model_classes": info.get("model_classes", {}),
            })
        if total != scenario.get("modeled_exits"):
            raise ValueError(f"{cost}bps: scenario total does not reconcile")
        scenario_reports[cost] = {
            "modeled_exits": total,
            "sha_mismatched_modeled_exits": mismatch_exits,
            "sha_mismatch_pct": round(mismatch_exits * 100 / total, 6) if total else 0.0,
            "all_research_model_shas_match_live": mismatch_exits == 0,
            "reported_max_dd_pct": scenario.get("reported_max_dd_pct"),
            "target_max_dd_le_20pct": scenario.get("drawdown_20pct_limit_satisfied") is True,
            "modeled_not_actual_exchange_fills": True,
            "models": model_details,
        }
    return {
        "schema": "disdex-bt-stable4-vps-source-comparison/v1",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "observed_live_snapshot_utc": live.get("observed_utc"),
        "current_live_reference_source": "GitHub commit per active systemd unit + normalized VPS entrypoint bytes",
        "shared_risk_sha": pins[RISK_SERVICE],
        "shared_risk_applied_to_research_replay_verified": False,
        "full_eight_runner_causal_backtest_verified": False,
        "research_to_current_production_backtest_certified": False,
        "requires_source_dependent_files_and_trade_reexecution": True,
        "scenarios": scenario_reports,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    base = Path(__file__).resolve().parents[2] / "docs" / "research-results"
    parser.add_argument("--study", type=Path, default=base / "BT_STABLE4_SOURCE_PARITY_AUDIT_20261119.json")
    parser.add_argument("--live", type=Path, default=base / "BT_VPS_ENTRYPOINT_PARITY_20261119_UNCERTIFIED.json")
    parser.add_argument("--output", type=Path, default=base / "BT_STABLE4_VS_LIVE_SOURCE_20261119_UNCERTIFIED.json")
    args = parser.parse_args()
    report = compare(json.loads(args.study.read_text(encoding="utf-8")), json.loads(args.live.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for cost, info in report["scenarios"].items():
        names = [model["model"] for model in info["models"] if not model["source_sha_matches_live"]]
        print(f"{cost}bps: mismatched_model_exits={info['sha_mismatched_modeled_exits']}/{info['modeled_exits']} ({info['sha_mismatch_pct']}%); models={','.join(names)}")
    print("CERTIFICATION=BLOCKED_RESEARCH_NOT_LIVE_PARITY")


if __name__ == "__main__":
    main()
