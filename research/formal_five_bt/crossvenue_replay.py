"""Frozen-rule 2025-08-10..2026-08-10 crypto cross-venue BT (no Aster data).

Each exchange is an independent market. Only reuse the audited strategy source
code; never reuse Aster candles, decisions, entries, funding or orders.
V52 requires independently verified stock-perp basis data unavailable in this
crypto-only test and is therefore excluded and prominently labeled.
"""
from __future__ import annotations
import argparse,hashlib,json,shutil
from pathlib import Path
from .acquire import extract_universes
from . import signal_scan,crypto_price_model,portfolio_price_model,fx_ecb
from .fet_dual_gate_combo_bt import gate_candidate_stream,REQUESTED_CAPS
from .crypto_price_model import _rows

def run(venue:str,root:Path,output:Path):
    if venue not in ("binance","okx"): raise ValueError("NON_ASTER_VENUE_REQUIRED")
    manifest=json.loads((root/"crossvenue-acquisition-manifest.json").read_text())
    if manifest["venue"]!=venue: raise ValueError("SOURCE_VENUE_MISMATCH")
    # Original runtime bridge is path-constrained to Aster: an isolated staging
    # directory supplies *only* this venue's rows under its expected paths.
    # Every row retains its true source/exchange field. No Aster download occurs.
    originals=root/"normalized"/venue
    alias=root/"normalized"/"aster"
    if alias.exists(): raise ValueError("IMPLICIT_ASTER_OR_MIXED_SOURCE_FORBIDDEN")
    alias.symlink_to(originals, target_is_directory=True)
    universe=extract_universes()["crypto_union"]
    mandatory={"BTCUSDT","FETUSDT","PENGUUSDT"}
    missing_mandatory=sorted(x for x in mandatory if manifest["symbols"].get(x,{}).get("h1_count",0)==0)
    if missing_mandatory: raise ValueError("MANDATORY_MARKET_NOT_AVAILABLE:"+",".join(missing_mandatory))
    if manifest["funding_incomplete"]:
        raise ValueError("MISSING_FUNDING_STRICT:"+",".join(manifest["funding_incomplete"]))
    missing_optional=[s for s in universe if manifest["symbols"].get(s,{}).get("h1_count",0)==0]
    # Distinguish unlisted optional Q102/V12 instruments from zero-signal coins.
    # Existing bridge expects every configured universe file; empty histories
    # remain empty and are excluded from any trade instead of being backfilled.
    for symbol in missing_optional:
        p=alias/"klines"/(symbol+".jsonl");p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text("")
    # Incomplete instruments *with* known gaps do not get synthetic candles.
    # The existing bridge and price model quarantine noncontiguous windows.
    root.mkdir(parents=True,exist_ok=True)
    scan=output/"scan";cand=output/"candidates"
    signal_scan.scan(root,scan/"baseline-signal-scan",
                     strategies=("V12","PENGU","FET"))
    signal_scan.scan(root,scan/"baseline-signal-scan-q102",
                     strategies=("Q102",),q102_fast=True)
    crypto_price_model.build_candidate_ledger(root,scan,cand)
    fx_ecb.acquire_ecb_cross(root)
    costs=(("PRICE_MODEL_8BPS",8.0),("PRICE_MODEL_10BPS",10.0))
    gated,audit=gate_candidate_stream(_rows(cand/"crypto-price-model-candidates.jsonl"),root,output/"gated-candidates")
    cases=(("BASELINE_CRYPTO4",cand,None),
           ("CAP_ONLY_CRYPTO4",cand,REQUESTED_CAPS),
           ("CAP_PLUS_FET_DUAL_GATE_CRYPTO4",gated,REQUESTED_CAPS))
    summary={"scope":"CRYPTO_FOUR_STRATEGIES_ONLY_V52_NOT_TESTED",
             "source_venue":venue,"period":"2025-08-10..2026-08-10",
             "independent_aster_market_data":False,
             "same_calendar_dates_as_original_hypothesis":True,
             "out_of_sample_classification":"CROSS_VENUE_NOT_UNSEEN_TIME",
             "candidate_source_sha256":hashlib.sha256((cand/"crypto-price-model-candidates.jsonl").read_bytes()).hexdigest(),
             "missing_optional_symbols":missing_optional,
             "fet_gate_candidate_decisions":len(audit),
             "fet_gate_blocked_count":sum(bool(a["gate_reasons"]) for a in audit),
             "caps":REQUESTED_CAPS,"pengu_parameters_unchanged":True,
             "v52":{"status":"NOT_TESTED","reason":"NO_VERIFIED_NON_ASTER_STOCK_PERP_REFERENCE_AND_FUNDING"},
             "limitations":["Venue fills modeled on H1 only; no historical L2 order-book replay.",
                "Cross-venue same-period transfer is not genuinely unseen-calendar-period validation.",
                "Funding/volume/basis conventions differ between exchanges; native-market provenance kept.",
                "Unavailable instruments cannot be represented as zero-profit or synthetic candles."],
             "cases":{}}
    for label,source,caps in cases:
        result=portfolio_price_model.run_portfolio_model(
            root,source,output/label,v52_ledger_root=None,ecb_fx_root=root,
            cost_scenarios=costs,research_risk_caps=caps)
        summary["cases"][label]=[{
            "scenario":s["scenario_id"],
            "equity_jpy":s["final_equity_jpy"],
            "max_dd":s["maximum_mtm_drawdown"],
            "profit_factor":s["profit_factor"],
            "closed_trades":s["closed_trades"],
            "per_strategy_pnl_jpy":s["strategy_pnl_jpy"],
            "monthly_equity_jpy":s["monthly_equity_jpy"],
            "reconciliation_status":s["accounting_reconciliation"]["status"],
            "status":s["status"],
            "fet_hard_stop":s["strategy_trade_outcome_aggregates"].get("fet_by_exit_reason",{}).get("FET_HARD_STOP"),
        } for s in result["scenarios"]]
        if any(s["accounting_reconciliation"]["status"]!="PASS" for s in result["scenarios"]):
            raise ValueError("LEDGER_ACCOUNTING_RECONCILIATION_FAILED:"+label)
        if any(s["maximum_mtm_drawdown"] is None for s in result["scenarios"]):
            raise ValueError("INCOMPLETE_MTM_DD:"+label)
    summary["status"]="CRYPTO4_CROSSVENUE_PRICE_MODEL_FINISHED_NOT_L2_VERIFIED"
    output.mkdir(parents=True,exist_ok=True)
    (output/"crossvenue-comparison.json").write_text(json.dumps(summary,sort_keys=True,indent=2,allow_nan=False)+"\n")
    print("CROSSVENUE_SUMMARY",json.dumps({k:summary[k] for k in ("scope","source_venue","status","fet_gate_blocked_count")},sort_keys=True))
    for name,scenarios in summary["cases"].items():
        for x in scenarios:
            print("CASE",json.dumps({"venue":venue,"case":name,"scenario":x["scenario"],
                "final_jpy":x["equity_jpy"],"dd":x["max_dd"],"pf":x["profit_factor"],
                "trades":x["closed_trades"]},sort_keys=True))
    return summary

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--venue",choices=["binance","okx"],required=True)
    p.add_argument("--root",type=Path,required=True);p.add_argument("--output",type=Path,required=True)
    a=p.parse_args();run(a.venue,a.root,a.output)
