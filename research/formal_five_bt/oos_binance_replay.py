"""Previously unused 2024-08-10..2025-08-09 Binance crypto four-logic BT.

Audited strategy source is restored by the workflow and never rewritten. Only
price/funding venue and research clock are changed. Never mix Aster rows into
this validation, assert period disjoint from hypothesis-design sample.
V52 is NOT replayed without historic stock-perpetual basis and Yahoo reference.
"""
from __future__ import annotations
import argparse
from datetime import date, datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import tarfile

from . import signal_scan, crypto_price_model, portfolio_price_model, fx_ecb
from .acquire import extract_universes
from .fet_dual_gate_combo_bt import REQUESTED_CAPS, gate_candidate_stream
from .crypto_price_model import _rows

START = date(2024,8,10)
END = date(2025,8,10)  # previous day Aug9 inclusive; no overlap with old sample
START_MS = int(datetime(2024,8,10,tzinfo=timezone.utc).timestamp()*1000)
END_MS = int(datetime(2025,8,10,tzinfo=timezone.utc).timestamp()*1000)
PRIOR_TRAINING_START = date(2024,1,1)

def _date_overrides():
    # Do NOT mutate audited runtime TypeScript; these are only Python research
    # replay boundaries. Both modules import the bounds at module load time.
    crypto_price_model.PERIOD_START_MS = START_MS
    crypto_price_model.PERIOD_END_MS = END_MS
    portfolio_price_model.PERIOD_START_MS = START_MS
    portfolio_price_model.PERIOD_END_MS = END_MS
    # The earlier 2025-08-10..2026-08-10 sample had 13 deposits. To keep
    # ¥130,000 AND strict period separation, the final deposit is booked at
    # 2025-08-09 instead of 2025-08-10. This one-day timing deviation is
    # recorded prominently and MUST NOT be passed off as exact deposit parity.
    def deposits():
        result = {}
        for i in range(13):
            y = 2024 + (8+i-1)//12
            m = (8+i-1)%12 + 1
            d = 9 if i==12 else 10
            stamp = int(datetime(y,m,d,tzinfo=timezone.utc).timestamp()*1000)
            result[stamp] = 10000.0
        return result
    portfolio_price_model._monthly_deposits = deposits

def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def _dump(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,sort_keys=True,indent=2,allow_nan=False)+"\n",encoding="utf-8")

def _stage_market_data(root):
    m = json.loads((root/"acquisition-manifest.json").read_text())
    if m["venue"]!="binance" or m["period_start"]!=START.isoformat():
        raise ValueError("INVALID_OOS_VENUE_OR_PERIOD")
    if m.get("no_aster_market_data") is not True:
        raise ValueError("OOS_ASTER_MARKET_DATA_FORBIDDEN")
    alias=root/"normalized"/"aster"
    if alias.exists() or alias.is_symlink():
        raise ValueError("PREEXISTING_ASTER_MARKET_ALIAS_FORBIDDEN")
    normalized=root/"normalized"/"binance"
    expected=extract_universes()["crypto_union"]
    missing=[]
    excluded=[]
    for sym in expected:
        info=m["symbols"].get(sym,{})
        path=normalized/"klines"/f"{sym}.jsonl"
        fpath=normalized/"funding"/f"{sym}.jsonl"
        if not path.is_file() or not fpath.is_file():
            missing.append(sym)
            for dest in (path,fpath):
                dest.parent.mkdir(parents=True,exist_ok=True)
                if not dest.is_file():
                    dest.write_text("")
            continue
        if _sha(path)!=info.get("klines_sha256") or _sha(fpath)!=info.get("funding_sha256"):
            raise ValueError("SOURCE_INTEGRITY_FAILED:"+sym)
        if info.get("h1_count",0)==0:
            missing.append(sym)
            continue
        if info.get("h1_gap_count",0)>0 or info.get("funding_count",0)==0:
            excluded.append({"symbol":sym,"reason":"MISSING_H1_OR_FUNDING"})
            path.write_text("")
            fpath.write_text("")
            continue
        first_ms=info.get("first_h1")
        last_ms=info.get("last_h1")
        if not first_ms or not last_ms:
            raise ValueError("SOURCE_TIME_RANGE_MISSING:"+sym)
        def mo(ms):
            return datetime.fromtimestamp(ms/1000, timezone.utc).strftime("%Y-%m")
        fy,ly=mo(first_ms),mo(last_ms)
        # Missing funding archives in a month when H1 trading was available
        # invalidate this instrument rather than silently charging zero funding.
        unavailable=[month for month in info.get("missing_funding_months",[])
                     if fy <= month <= ly and month >= START.strftime("%Y-%m")]
        if unavailable:
            excluded.append({"symbol":sym,"reason":"FUNDING_MONTHS_MISSING","months":unavailable})
            path.write_text("")
            fpath.write_text("")
    critical={s for s in ("BTCUSDT","FETUSDT","PENGUUSDT") if s in missing or
              any(t["symbol"]==s for t in excluded)}
    if critical:
        raise ValueError("OOS_CRITICAL_CANDLE_OR_FUNDING_UNVERIFIABLE:"+",".join(sorted(critical)))
    # A path alias is necessary because the original fixed audited evaluators
    # expect the old staging directory. The source field within EVERY row is
    # unchanged BINANCE, never ASTER, and copied synthetic prices are forbidden.
    alias.symlink_to(normalized.resolve(),target_is_directory=True)
    return m,sorted(missing),excluded

def run(root, output):
    root,output=Path(root).resolve(),Path(output).resolve()
    output.mkdir(parents=True,exist_ok=True)
    manifest,missing,excluded=_stage_market_data(root)
    _date_overrides()
    from .manifest import load_manifest
    from .acquire import MANIFEST_PATH
    if manifest.get("runtime_sha")!=load_manifest(MANIFEST_PATH)["runtime_sha"]:
        raise ValueError("SOURCE_SHA_CHANGED_SINCE_ORIGINAL_BT")
    fx_ecb.acquire_ecb_cross(root,start=PRIOR_TRAINING_START,end=END)
    scans=output/"scans"
    base=scans/"baseline-signal-scan"
    high=scans/"baseline-signal-scan-q102"
    a=signal_scan.scan(root,base,strategies=("V12","PENGU","FET"),
                       start_date=START,end_date_exclusive=END)
    b=signal_scan.scan(root,high,strategies=("Q102",),
                       start_date=START,end_date_exclusive=END,q102_fast=True)
    candidate_root=output/"candidates"
    candidate_report=crypto_price_model.build_candidate_ledger(root,scans,candidate_root)
    rows=_rows(candidate_root/"crypto-price-model-candidates.jsonl")
    gate_root,audit=gate_candidate_stream(rows,root,output/"gated-candidates")
    pairs=(("BASELINE",candidate_root,None),
           ("BRK0P75_MR0P75_FET1_CAP_ONLY",candidate_root,REQUESTED_CAPS),
           ("BRK0P75_MR0P75_FET1_DUAL_GATE",gate_root,REQUESTED_CAPS))
    report={
        "scope":"OOS_PRIOR_CALENDAR_YEAR_CRYPTO4_BINANCE_USDM_EXCLUDING_V52",
        "period":"2024-08-10..2025-08-09",
        "in_sample_design_period":"2025-08-10..2026-08-10",
        "calendar_date_overlap":False,
        "source":"OFFICIAL_BINANCE_MONTHLY_USDM_FUTURES_ARCHIVE",
        "v52":{"status":"NOT_TESTED","reason":"HISTORICAL_STOCK_PERP_AND_EQUITY_REFERENCE_NOT_VERIFIED_FOR_PRIOR_YEAR"},
        "pengu_parameters_unchanged":True,
        "fixed_requested_caps":REQUESTED_CAPS,
        "fixed_fet_gates":{"overheat":"FET24H>=15% AND ATR24H>=2%",
                           "relative_weak":"FET24H-BTC24H<0 AND FET24H<1%"},
        "contributions":{"total_jpy":130000,
                         "schedule":"2024-08-10..2025-07-10 MONTHLY_PLUS_2025-08-09_FINAL_ONE_DAY_EARLY",
                         "last_one_day_early_for_strict_oos_period":True},
        "missing_unlisted_optional_symbols":missing,
        "quarantined_optional_symbols":excluded,
        "data_manifest_sha256":_sha(root/"acquisition-manifest.json"),
        "signal_scan_stats":{"v12_pengu_fet":a["stats"],"q102":b["stats"]},
        "candidate_strategy_summary":candidate_report.get("strategies"),
        "fet_gate_evaluated_candidates":len(audit),
        "fet_gate_rejected_candidates":sum(bool(x["gate_reasons"]) for x in audit),
        "costs_bps":[8,10],
        "historical_l2_verified":False,
        "status":"IN_PROGRESS","cases":{}
    }
    for label,source,caps in pairs:
        result=portfolio_price_model.run_portfolio_model(
            root,source,output/label,ecb_fx_root=root,v52_ledger_root=None,
            cost_scenarios=(("PRICE_MODEL_8BPS",8.0),("PRICE_MODEL_10BPS",10.0)),
            research_risk_caps=caps)
        report["cases"][label]=[]
        for scenario in result["scenarios"]:
            info={k:scenario.get(k) for k in
                  ("scenario_id","contributed_jpy","final_equity_jpy",
                   "profit_factor","win_rate","maximum_mtm_drawdown",
                   "closed_trades","strategy_pnl_jpy","strategy_trades",
                   "monthly_equity_jpy","accounting_reconciliation",
                   "strategy_trade_outcome_aggregates")}
            report["cases"][label].append(info)
            if info["accounting_reconciliation"]["status"]!="PASS":
                raise ValueError("OOS_ACCOUNTING_RECONCILIATION_FAILED:"+label)
            if info["contributed_jpy"]!=130000:
                raise ValueError("OOS_CONTRIBUTIONS_MISMATCH")
        _dump(output/"oos-summary-progress.json",report)
    # Archive all candidate and trade ledgers in compressed form; separate
    # from durable normalized venue data to avoid replaying from stale exits.
    report["status"]="OOS_CRYPTO4_COMPLETED_PRICE_MODEL_NOT_L2_VERIFIED"
    _dump(output/"oos-summary.json",report)
    for path in output.rglob("*.jsonl"):
        source=path.read_bytes()
        with gzip.open(str(path)+".gz","wb",compresslevel=6) as f:
            f.write(source)
        path.unlink()
    print("OOS_FINAL",json.dumps({
        "status":report["status"],"venue":"binance",
        "period":report["period"],"fet_gate_candidates":report["fet_gate_evaluated_candidates"],
        "gate_blocked":report["fet_gate_rejected_candidates"],
        "ten_bps":{k:next(({"final_jpy":x["final_equity_jpy"],
                            "dd":x["maximum_mtm_drawdown"],
                            "trades":x["closed_trades"]}
                    for x in v if x["scenario_id"]=="PRICE_MODEL_10BPS"),None)
                   for k,v in report["cases"].items()}},sort_keys=True),flush=True)
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    run(args.root,args.output)

if __name__=="__main__":
    main()
