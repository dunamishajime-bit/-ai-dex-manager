"""Archived 2026-10-23 eight-family modeled tape replay using the shared dynamic allocator.

DO NOT use to authorize LIVE: source tapes are old, execution/funding incomplete.
"""
from __future__ import annotations
import argparse
from collections import Counter
import copy
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
from typing import Any
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import research_formal_dynamic_score_bt as core

ARCHIVED_STRATEGIES = ("V12", "PENGU", "Q102", "FET", "HYPE_LONG", "IDLE", "RESIDUAL", "V52")
ARCHIVED_LIMITS = {"HYPE_LONG": 1.5, "IDLE": 0.25, "RESIDUAL": 1.0}
ARCHIVED_V4_SHA = "23ddd4b01fcff38cd10d4d4614221f93dc6b44e5"


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024*1024), b""): h.update(part)
    return h.hexdigest()


def load_hype_h1(path: Path) -> dict:
    src = json.loads(path.read_text(encoding="utf-8"))
    entries = src.get("hype")
    if not isinstance(entries, list) or not entries:
        raise ValueError("HYPE_ARCHIVED_H1_MISSING")
    rows = []
    for r in entries:
        ts = int(r["t"])
        price = float(r["o"])
        if ts <= 0 or price <= 0 or float(r["c"]) <= 0:
            raise ValueError("HYPE_ARCHIVED_H1_INVALID")
        rows.append({"event_time_ms": ts, "open": price, "close": float(r["c"])})
    rows.sort(key=lambda r: r["event_time_ms"])
    times = [x["event_time_ms"] for x in rows]
    if len(set(times)) != len(times):
        raise ValueError("HYPE_H1_DUPLICATE")
    return {"rows": rows, "times": times}


def add_archived_eight_caps() -> None:
    core.STRATEGY_CAPS.update(ARCHIVED_LIMITS)
    core.STRATEGY_PRIORITY.update({"HYPE_LONG": 5, "IDLE": 6, "RESIDUAL": 7})


def replay_archived_full8(*, candidate_ledger: Path, v52_root: Path,
                          data_root: Path, replay_source_root: Path,
                          ecb_root: Path, hype_h1: Path,
                          signal_paths: dict[str, Path], output_root: Path,
                          cost_bps: float) -> dict[str, Any]:
    add_archived_eight_caps()
    core.ARCHIVED_EIGHT_OWNER_POLICY_RESEARCH_ONLY = True
    tape,meta = core.load_formal_candidates(candidate_ledger, v52_root)
    families = Counter(str(r.get("strategy_id")) for r in tape)
    if set(families) != set(ARCHIVED_STRATEGIES):
        raise ValueError(f"ARCHIVED_FULL8_FAMILY_PARITY_FAILED:{dict(families)}")
    archived_source_shas = dict(Counter(str(row.get("source_runtime_sha")) for row in tape))
    replay = core.load_recovered_replay_module(replay_source_root)
    original_market = replay._market
    hype_series = load_hype_h1(hype_h1)
    def extended_market(base_root, symbols):
        result = original_market(base_root, set(symbols) - {"HYPEUSDT"})
        if "HYPEUSDT" in symbols:
            result["HYPEUSDT"] = hype_series
        return result
    replay._market = extended_market
    fx = replay.load_ecb_cross(ecb_root)
    # This is a model of archived completed outcomes. No price tape has been
    # overwritten and missing HYPE venue funding is not presumed certified.
    modeled = copy.deepcopy(tape)
    valid_symbols={str(r["symbol"]) for r in modeled if r.get("status") == "MODELED_CLOSED_TRADE"}
    raw_market = extended_market(data_root,valid_symbols)
    meta_scores = core.attach_causal_scores_and_prior(
        modeled,signal_paths=signal_paths,
        market_by_symbol={"FETUSDT":core._read_jsonl(data_root/"normalized/aster/klines/FETUSDT.jsonl")},
        round_trip_cost_bps=cost_bps)
    scenario = core._dynamic_portfolio_scenario(
        modeled,data_root,replay,
        round_trip_cost_bps=cost_bps,
        scenario_id=f"ARCHIVED_FULL8_MODEL_{int(cost_bps)}BPS",
        fx_series=fx)
    scenario["scoreSourceCounts"] = meta_scores["scoreCounts"]
    scenario["strategyFamilies"] = dict(families)
    scenario["sourceLineageCounts"] = archived_source_shas
    scenario["sourceStatus"] = "ARCHIVED_EIGHT_FAMILY_PRICE_MODEL_NOT_CURRENT_SHA_PARITY"
    scenario["modelPriceStatus"] = scenario["status"]
    scenario["status"] = "RESEARCH_ONLY_BLOCKED_NATIVE_GATE_AND_LATEST_SHA_PARITY"
    scenario["nativeGateParityVerified"] = False
    scenario["nativeOwnershipAndCooldownParityVerified"] = False
    scenario["independentHoldoutVerified"] = False
    scenario["HypeFunding"] = "NOT_CERTIFIED_IN_THIS_ARCHIVE"
    scenario["venueFillEvidence"] = "NOT_L2_VERIFIED"
    output_root.mkdir(parents=True,exist_ok=True)
    tag=f"{int(cost_bps)}bps"
    scenario_dir=output_root/tag
    scenario_dir.mkdir(parents=True,exist_ok=True)
    for key,name in [("trade_rows","portfolio-trades.jsonl"),
                     ("candidate_decision_rows_full","candidate-decisions.jsonl"),
                     ("event_rows","portfolio-events.jsonl")]:
        core._write_jsonl(scenario_dir/name,scenario.pop(key))
    (scenario_dir/"metrics.json").write_text(json.dumps(scenario,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf-8")
    return {
        "scenario":tag,"candidateCount":len(tape),
        "closedTrades":scenario["closed_trades"],
        "finalEquityJpy":scenario["final_equity_jpy"],
        "maxMtmDD":scenario["maximum_mtm_drawdown"],
        "PF":scenario["profit_factor"],"winRate":scenario["win_rate"],
        "strategyTrades":scenario["strategy_trades"],
        "status":scenario["status"],
        "sourceHash":sha(candidate_ledger),
        "archivedSourceSHA":archived_source_shas,
        "metricsHash":sha(scenario_dir/"metrics.json"),
        "modelResearchOnly":True,
        "latestStrategyParityVerified":False,
        "venueFillCertified":False,
    }


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("candidate-ledger","v52-root","data-root","replay-source-root",
                 "ecb-root","hype-h1","v12-signal","pengu-signal","q102-signal",
                 "fet-signal","output-root"):
        parser.add_argument("--"+name,required=True,type=Path)
    parser.add_argument("--cost-bps",required=True,type=float)
    a=parser.parse_args()
    result=replay_archived_full8(
        candidate_ledger=a.candidate_ledger,v52_root=a.v52_root,
        data_root=a.data_root,replay_source_root=a.replay_source_root,
        ecb_root=a.ecb_root,hype_h1=a.hype_h1,
        signal_paths={"V12":a.v12_signal,"PENGU":a.pengu_signal,
                      "Q102":a.q102_signal,"FET":a.fet_signal},
        output_root=a.output_root,cost_bps=a.cost_bps)
    print(json.dumps(result,sort_keys=True,indent=2,allow_nan=False))


if __name__=="__main__":
    main()
