#!/usr/bin/env python3
"""Recompute the frozen eight-logic, source-backed 5m-overlay research BT.

This script uses the original eight-logic candidate allocator with archived
market ZIPs, not the incomplete fixed accepted-row Task9 reducer. It keeps
all outputs outside Git/Production and explicitly labels modeled fills.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import task9_initial_adverse_stop_20261020 as original  # noqa: E402

DEFAULT_OUTPUT = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"2026-10-21_task9_full8_5m_replay"
)
ARCHIVE = Path(
    r"C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research/"
    r"Previous_Projects/idle-exit-deep-research-20261016/bt120_5m_20261017/monthly_zip"
)
EXPECTED = original.BASELINE_EXPECTED
CANDIDATES = (
    ("V12_SHORT", "V12_SHORT_PCT2P0_12H_MFE1P0_R12"),
    ("V12_SHORT", "V12_SHORT_PCT1P5_6H_MFE0P5_R12"),
    ("V12_LONG", "V12_LONG_PCT2P0_12H_MFE1P0_R12"),
    ("IDLE", "IDLE_ATR2P0_6H_MFE1P0_R12"),
    ("V12_SHORT", "V12_SHORT_PCT2P25_12H_MFE1P0_R12"),
    ("V12_SHORT", "V12_SHORT_PCT2P5_12H_MFE1P0_R12"),
)

EXPLORATORY_RULES = {
    f"V12_SHORT_PCT{key}_12H_MFE1P0_R12": {
        "id": f"V12_SHORT_PCT{key}_12H_MFE1P0_R12",
        "strategy": "V12", "sides": ["SHORT"], "stop_pct": pct,
        "arm_hours": 12, "mfe_gate_pct": 0.01, "reentry_hours": 12,
    }
    for key, pct in (("2P25", 0.0225), ("2P5", 0.025))
}


def _preallocation_candidate_transform(
    rows: list[dict], overlays: list[dict], source, cost_bps: int,
    obs: dict, baseline_lookup: dict[str, dict] | None = None,
) -> list[dict]:
    """Modify proposed exits but NEVER discard an unadmitted candidate.

    Admission, quantities, gross, ownership and wallet accounting are
    recomputed by the original chronological full8 allocator afterward.
    Since this hook is upstream of admission, it must NOT pretend that a
    stopped proposal was actually filled or impose fictitious cooldown.
    """
    transformed = []
    for row in rows:
        proposed = row
        for overlay in overlays:
            if not original._matches(proposed, overlay):
                continue
            if not all(proposed.get(key) is not None for key in (
                "strategy_id", "symbol", "side", "entry_ts_ms",
                "exit_ts_ms", "entry_price", "exit_price",
            )):
                obs["invalid_input"] += 1
                continue
            proposed = original._apply_initial_stop(
                proposed, overlay, source, cost_bps, obs,
                original_row=proposed,
            )
        transformed.append(proposed)
    return transformed


def data_inventory() -> dict:
    if not ARCHIVE.is_dir():
        raise RuntimeError(f"missing archived 5-minute source: {ARCHIVE}")
    dirs = sorted(item for item in ARCHIVE.iterdir() if item.is_dir())
    symbols = {}
    archive_entries = []
    for item in dirs:
        files = sorted(item.glob("*.zip"))
        if not files:
            raise RuntimeError(f"empty market archive: {item.name}")
        for source_zip in files:
            with zipfile.ZipFile(source_zip) as opened:
                if opened.testzip() is not None:
                    raise RuntimeError(f"corrupt market ZIP: {source_zip}")
            one_sha = hashlib.sha256(source_zip.read_bytes()).hexdigest()
            archive_entries.append(f"{item.name}/{source_zip.name}:{one_sha}")
        symbols[item.name] = {
            "zipFileCount": len(files),
            "totalZipBytes": sum(p.stat().st_size for p in files),
            "firstZip": files[0].name,
            "lastZip": files[-1].name,
        }
    expected_symbols = {
        "AAVEUSDT", "ADAUSDT", "AMZNUSDT", "APTUSDT", "ARBUSDT",
        "ATOMUSDT", "AVAXUSDT", "BNBUSDT", "BTCUSDT", "DOGEUSDT",
        "DOTUSDT", "ENAUSDT", "ETHUSDT", "FETUSDT", "HYPEUSDT",
        "INJUSDT", "JUPUSDT", "LINKUSDT", "LTCUSDT", "METAUSDT",
        "MSFTUSDT", "NEARUSDT", "NVDAUSDT", "ONDOUSDT", "OPUSDT",
        "PENGUUSDT", "RENDERUSDT", "SEIUSDT", "SOLUSDT", "SUIUSDT",
        "TAOUSDT", "TIAUSDT", "TSLAUSDT", "UNIUSDT", "XRPUSDT",
    }
    if set(symbols) != expected_symbols:
        raise RuntimeError(f"market archive symbol mismatch: {sorted(expected_symbols ^ set(symbols))}")
    return {
        "source": str(ARCHIVE),
        "symbolCount": len(symbols),
        "zipCount": sum(s["zipFileCount"] for s in symbols.values()),
        "zipIntegrity": "ALL_ZIP_SHA_AND_CRC_PASS",
        "archiveSha256": hashlib.sha256("\n".join(archive_entries).encode("utf-8")).hexdigest(),
        "symbols": symbols,
        "dataLimitation": "ZIP presence is not continuous tick/L2 coverage; stock proxy archive has partial monthly coverage",
    }


def compact(result: dict) -> dict:
    o = result.get("observations") or {}
    return {
        "finalEquityJpy": result["final_equity_jpy"],
        "profitFactor": result["profit_factor"],
        "maximumMtmDdPct": result["maximum_mtm_drawdown_pct"],
        "winRate": result["win_rate"],
        "closedTrades": result["closed_trades"],
        "accounting": result["accounting"],
        "strategyTrades": result["strategy_trades"],
        "strategyPnlJpy": result["strategy_pnl_jpy"],
        "originalWinnerStopped": o.get("original_winner_triggered", 0),
        "originalLoserStopped": o.get("original_loser_triggered", 0),
        "stopProposalsBeforeAdmission": o.get("triggered", 0),
        "cooldownMode": "NOT_EVALUATED_PREALLOCATION_ONLY",
        "cooldownRejected": None,
        "eligible": o.get("eligible", 0),
        "priceDataGaps": o.get("data_gap", 0),
        "internalDataGaps": o.get("internal_gap", 0),
        "oos": result["oos"],
        "ledgerPath": result["ledger"],
    }


def compare(candidate: dict, baseline: dict) -> dict:
    return {
        "ddImprovementPercentagePoints": round(candidate["maximumMtmDdPct"] - baseline["maximumMtmDdPct"], 8),
        "finalEquityRetention": candidate["finalEquityJpy"] / baseline["finalEquityJpy"],
        "profitFactorRetention": candidate["profitFactor"] / baseline["profitFactor"],
        "tradeDelta": candidate["closedTrades"] - baseline["closedTrades"],
        "accountingPass": candidate["accounting"] == "PASS",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--candidates", nargs="*", default=[name for _, name in CANDIDATES])
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    original.OUTPUT = args.output
    original.BOOTSTRAP_REDIRECT = args.output / "_legacy-bootstrap-cache"
    original._transform_rows = _preallocation_candidate_transform
    market_inventory = data_inventory()
    allowed = {name for _, name in CANDIDATES}
    if len(set(args.candidates)) != len(args.candidates) or set(args.candidates) - allowed:
        raise RuntimeError("unknown or duplicate candidate selection")
    timestamp = datetime.now(timezone.utc).isoformat()
    started = time.monotonic()
    source, helper = original.task8.legacy.bootstrap()
    original.Path.write_text = original._path_write_text
    original.task8.legacy.ensure_baseline(helper)
    previous_factory = helper.experiment_filter
    baseline_rows = {}
    baseline_results = {}
    baseline_source = {}
    for cost in (10, 30):
        baseline = original._run_engine("BASELINE", "BASELINE", [], cost, source, helper, previous_factory)
        expected = EXPECTED[cost]
        checks = {
            "equity": math.isclose(baseline["final_equity_jpy"], expected["final"], rel_tol=2e-10, abs_tol=1e-4),
            "pf": math.isclose(baseline["profit_factor"], expected["pf"], rel_tol=2e-10, abs_tol=1e-8),
            "maxDd": math.isclose(baseline["maximum_mtm_drawdown_pct"], expected["dd"], rel_tol=2e-10, abs_tol=1e-7),
            "trades": baseline["closed_trades"] == expected["trades"],
            "accounting": baseline["accounting"] == "PASS",
        }
        if not all(checks.values()):
            raise RuntimeError(f"exact baseline not reproduced for {cost}bps: {checks}")
        baseline_results[str(cost)] = compact(baseline)
        baseline_rows[cost] = original._load_rows(baseline)
        baseline_source[cost] = {
            original._position_key(row): row for row in baseline_rows[cost]
            if original._position_key(row)
        }
        print("FULL8_EXACT_BASELINE_PASS", cost, json.dumps(baseline_results[str(cost)], ensure_ascii=False)[:260], flush=True)
    results = {}
    earlier = args.output / "manifest.json"
    if earlier.is_file():
        prior = json.loads(earlier.read_text(encoding="utf-8"))
        prior_baseline = prior.get("baseline", {})
        if prior.get("dynamicBaseline8LogicExact") and all(
            math.isclose(prior_baseline[str(cost)]["finalEquityJpy"],
                         baseline_results[str(cost)]["finalEquityJpy"], rel_tol=1e-12)
            for cost in (10, 30)
        ):
            results.update(prior.get("candidateResults", {}))
        else:
            raise RuntimeError("existing output manifest has incompatible baseline; refusing overwrite")
    for phase, candidate_name in CANDIDATES:
        if candidate_name not in args.candidates:
            continue
        rule = next((r for r in original.candidate_grid(phase) if r["id"] == candidate_name), None)
        if rule is None:
            rule = EXPLORATORY_RULES.get(candidate_name)
        if rule is None:
            raise RuntimeError(f"candidate not found in preregistered grid: {candidate_name}")
        pairs = {}
        for cost in (10, 30):
            name = f"RERUN_{candidate_name}_{cost}"
            current = original._run_engine(
                name, phase, [rule], cost, source, helper, previous_factory,
                baseline_lookup=baseline_source[cost],
            )
            cand = compact(current)
            admitted_rows = original._load_rows(current)
            real_stops = [row for row in admitted_rows if
                          str(row.get("exit_reason_actual") or "").startswith("RESEARCH_INITIAL_ADVERSE_STOP_")]
            cand["admittedStopTradeCount"] = len(real_stops)
            baseline_filled_ids = {row.get("candidate_id") for row in baseline_rows[cost]}
            changed_filled_ids = {row.get("candidate_id") for row in admitted_rows}
            cand["newlyAdmittedCandidateCount"] = len(changed_filled_ids - baseline_filled_ids)
            cand["noLongerAdmittedCandidateCount"] = len(baseline_filled_ids - changed_filled_ids)
            cand["baselineComparison"] = compare(cand, baseline_results[str(cost)])
            pairs[str(cost)] = cand
            print("FULL8_CANDIDATE", candidate_name, cost,
                  json.dumps({
                      "finalJpy": cand["finalEquityJpy"],
                      "dd": cand["maximumMtmDdPct"],
                      "pf": cand["profitFactor"],
                      "trades": cand["closedTrades"],
                      "stopEvents": cand["admittedStopTradeCount"],
                  }), flush=True)
        results[candidate_name] = {
            "rule": rule, "results": pairs,
            "postHocExploratorySensitivity": candidate_name in EXPLORATORY_RULES,
        }
        output = {
            "status": "RESEARCH_H1_PRICE_MODEL_5M_OVERLAY",
            "priceModelNotVenueVerified": True,
            "sample": "2025-08-10_to_2026-08-10",
            "dataArchive": market_inventory,
            "baselineReproduced": baseline_results,
            "candidates": results,
            "productionChanges": 0,
            "liveChanges": 0,
        }
        (args.output / "full8-5m-candidate-comparison.json").write_text(
            json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    gates = {}
    for name, entry in results.items():
        checks = {cost: entry["results"][cost]["baselineComparison"] for cost in ("10", "30")}
        oos_retention = {}
        oos_positive = {}
        for cost in ("10", "30"):
            baseline_oos = baseline_results[cost]["oos"]
            alternative_oos = entry["results"][cost]["oos"]
            source_pf = baseline_oos.get("profit_factor")
            alternative_pf = alternative_oos.get("profit_factor")
            oos_retention[cost] = (alternative_pf / source_pf
                                   if source_pf and alternative_pf else None)
            oos_positive[cost] = alternative_oos.get("net_pnl_jpy", 0) > 0
        gates[name] = {
            "oosPfRetentionByCost": oos_retention,
            "oosNetPnlPositiveByCost": oos_positive,
            "bothOosPfRetentionAtLeast90pct": all(
                v is not None and v >= 0.90 for v in oos_retention.values()),
            "bothOosNetPnlPositive": all(oos_positive.values()),
            "bothDdImprovedAtLeast0p1pp": all(item["ddImprovementPercentagePoints"] >= 0.1 for item in checks.values()),
            "bothFinalEquityRetentionAtLeast75pct": all(item["finalEquityRetention"] >= 0.75 for item in checks.values()),
            "bothAccountingPass": all(item["accountingPass"] for item in checks.values()),
            "worstCostDdImprovementPp": min(item["ddImprovementPercentagePoints"] for item in checks.values()),
            "lowestEquityRetention": min(item["finalEquityRetention"] for item in checks.values()),
        }
        gates[name]["researchGatePass"] = (
            gates[name]["bothDdImprovedAtLeast0p1pp"]
            and gates[name]["bothFinalEquityRetentionAtLeast75pct"]
            and gates[name]["bothAccountingPass"]
            and gates[name]["bothOosPfRetentionAtLeast90pct"]
            and gates[name]["bothOosNetPnlPositive"]
        )
    manifest = {
        "status": "COMPLETE_REPRODUCIBLE_RESEARCH_ONLY_NONCANONICAL",
        "researchOnly": True,
        "productionChanges": 0,
        "liveChanges": 0,
        "sourceArchive": market_inventory,
        "originalSourceSha256": original.task8.legacy.orig_provenance(),
        "runUtc": timestamp,
        "runtimeSeconds": round(time.monotonic() - started, 2),
        "model": "frozen 2026-10-17 full8 H1-price-model with 5m market trajectories",
        "independentVenueOrderBookProven": False,
        "dynamicBaseline8LogicExact": True,
        "baseline": baseline_results,
        "candidateResults": results,
        "researchCostGates": gates,
        "limitations": [
            "Not signed venue execution and not exact parity with the new Task 9 reducer.",
            "Candidate alternatives use historical 5m models with price/fee/funding approximations.",
            "Stops are modeled on candidate exits before portfolio admission. The full8 allocator then reruns; post-admission stop events are counted only from accepted trades.",
            "Cooldown from a proposed stop is NOT applied because preallocation cannot prove a real STOP fill; do not interpret these scenarios as the original cooldown-equipped candidate.",
            "Data-source stock proxy month gaps and intrabar ambiguity remain.",
            "IS/OOS split inside a previously researched window is not untouched blind forward validation.",
        ],
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("FULL8_REPLAY_COMPLETE", json.dumps({
        "baseline": {k: {x: v[x] for x in ["finalEquityJpy", "maximumMtmDdPct", "closedTrades"]} for k, v in baseline_results.items()},
        "candidates": list(results),
        "elapsed": manifest["runtimeSeconds"],
        "output": str(args.output),
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
