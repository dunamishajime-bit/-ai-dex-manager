"""Predeclared additive V12 route grid, replayed through the original five-logic Aster shared allocator.

This grid starts ONLY from the already user-selected V12 Score1.00 / Volume0.80,
Strong-Regime unchanged, non-strong Momentum rescue Score0.35 baseline.
Preserve the baseline V12 signal-and-exit ledger and add a separate rescue
candidate only when an existing selection leaves an available downstream slot.
All extra features are calculated from fully closed H2 bars available before
the next H1 entry open. Not an executable LIVE strategy or formal L2 proof.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime,timezone,date,timedelta
import hashlib,json,math
from pathlib import Path
from typing import Any

from .crypto_price_model import (
    _rows,_bars,_funding,_funding_return_per_gross,_source_quarantine_reason,
    _v12_outcome,_v12_primary_map,
)
from .fet_dual_gate_combo_bt import gate_candidate_stream,REQUESTED_CAPS
from .portfolio_price_model import run_portfolio_model
from .strategies import RuntimeBridge

HOUR=3_600_000;H2=2*HOUR
START=int(datetime(2025,8,10,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2026,8,11,tzinfo=timezone.utc).timestamp()*1000)
ORIGINAL_SHA="ed57c0a7f6d0b5bf47cfcfb9f45fd5eb6e02add5"
BASE_EXPECT={
  "PRICE_MODEL_8BPS":{"ending":82305462.98540382,"dd":-.22784512208384422,"pf":2.0306733799286967,"trades":1083},
  "PRICE_MODEL_10BPS":{"ending":68350059.3203925,"dd":-.22914064363871933,"pf":1.9867239897087217,"trades":1083},
}
# All of these are incremental rescue proposals ON TOP OF the selected 1.00/.80 base.
# Requirements below either keep .80 volume and rescue score<1, or allow a
# separately named quality-protected exception to .80 volume.
VARIANTS={
 "CONTROL_NO_RESCUE":{"kind":"none","cap":.0},
 "HC_SCORE070_099_VOLUME080":{"kind":"hc_score_gap","minscore":.70,"minvol":.80,"cap":.25},
 "HC_SCORE085_099_VOLUME080":{"kind":"hc_score_gap","minscore":.85,"minvol":.80,"cap":.25},
 "HC_SCORE070_099_VOLUME080_SATELLITE":{"kind":"hc_score_gap","minscore":.70,"minvol":.80,"satellite_only":True,"cap":.10},
 "HC_SCORE085_099_VOLUME080_BTC12":{"kind":"hc_score_gap","minscore":.85,"minvol":.80,"btc12_min":0.0,"cap":.25},
 "HC_SCORE085_099_VOLUME080_RS2":{"kind":"hc_score_gap","minscore":.85,"minvol":.80,"relative24_min":.02,"cap":.25},
 "HC_NEUTRAL_SCORE085_099_VOLUME080":{"kind":"hc_neutral_gap","minscore":.85,"minvol":.80,"cap":.25},
 "HC_STRONG_GAP_SCORE070_099_VOLUME080":{"kind":"hc_strong_gap","minscore":.70,"minvol":.80,"cap":.25},
 "HC_VOLUME055_079_SCORE100":{"kind":"hc_low_volume","minvol":.55,"maxvol":.80,"scoremin":1.0,"cap":.25},
 "HC_VOLUME065_079_SCORE100":{"kind":"hc_low_volume","minvol":.65,"maxvol":.80,"scoremin":1.0,"cap":.25},
 "HC_VOLUME055_079_SCORE146":{"kind":"hc_low_volume","minvol":.55,"maxvol":.80,"scoremin":1.4649,"cap":.25},
 "STRONG_GAP_CONFIRMED_BREAKOUT":{"kind":"strong_breakout_gap","minvol":.80,"cap":.25,"hc_required":False},
 "RANK4_HC_SCORE100_VOLUME080":{"kind":"rank4_hc","minvol":.80,"cap":.10},
}
COSTS=(("PRICE_MODEL_8BPS",8.),("PRICE_MODEL_10BPS",10.),("PRICE_MODEL_STRESS_30BPS",30.))

def sha(path:Path)->str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path:Path,value:dict)->None:
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,sort_keys=True,indent=2,allow_nan=False,ensure_ascii=False)+"\n",encoding="utf-8")

def h2_bars(root:Path,syms:set[str])->dict[str,dict[int,dict]]:
    data={}
    for symbol in sorted(syms):
        by_hour={int(r["event_time_ms"]):r for r in _rows(root/"normalized/aster/klines"/(symbol+".jsonl"))}
        bars={}
        for start,first in by_hour.items():
            if start%H2:continue
            second=by_hour.get(start+HOUR)
            if second is None:continue
            bars[start+H2]={
                "close":float(second["close"]),
                "high":max(float(first["high"]),float(second["high"])),
                "low":min(float(first["low"]),float(second["low"])),
                "volume":float(first["base_volume"])+float(second["base_volume"]),
            }
        data[symbol]=bars
    return data

def ret(bars:dict[int,dict],ts:int,count:int,side:str)->float:
    a=bars.get(ts);b=bars.get(ts-count*H2)
    if not a or not b or b["close"]<=0:return float("nan")
    sign=1 if side=="LONG" else -1
    return sign*(a["close"]/b["close"]-1)

def er(bars:dict[int,dict],ts:int,count:int)->float:
    closes=[bars.get(ts-i*H2,{}).get("close") for i in range(count,-1,-1)]
    if any(x is None or x<=0 for x in closes):return float("nan")
    total=sum(abs(y-x) for x,y in zip(closes,closes[1:]))
    return abs(closes[-1]-closes[0])/total if total>0 else 0.

def features(bars:dict[str,dict[int,dict]],symbol:str,ts:int,side:str)->dict|None:
    own=bars.get(symbol,{});btc=bars.get("BTCUSDT",{})
    ret24=ret(own,ts,12,side);btc24=ret(btc,ts,12,side)
    prior=own.get(ts-H2)
    volumes=[own.get(ts-i*H2,{}).get("volume") for i in range(2,22)]
    prior_vol=(prior["volume"]/(sum(volumes)/20)
      if prior and len(volumes)==20 and all(x is not None and x>=0 for x in volumes) and sum(volumes)>0
      else float("nan"))
    out={"ret6h":ret(own,ts,3,side),"ret24h":ret24,"btc12h":ret(btc,ts,6,side),
         "btc24h":btc24,"btcEr12":er(btc,ts,6),"btcEr24":er(btc,ts,12),
         "rel24h":ret24-btc24,"previousVolumeRatio":prior_vol}
    return out if all(math.isfinite(v) for v in out.values()) else None

def strong_btc(bars:dict[str,dict[int,dict]],ts:int,regime:str)->bool:
    btc=bars["BTCUSDT"]
    closes=[btc.get(ts-i*H2,{}).get("close") for i in range(53)]
    if len(closes)!=53 or any(v is None or v<=0 for v in closes):return False
    distance=closes[0]/(sum(closes)/53)-1
    return regime=="LONG" and distance>=.0359 or regime=="SHORT" and distance<=-.0359

def breakout(bars:dict[str,dict[int,dict]],symbol:str,ts:int,side:str)->bool:
    s=bars[symbol]
    previous=[s.get(ts-i*H2) for i in range(1,13)]
    if any(x is None for x in previous) or s.get(ts) is None:return False
    current=s[ts]["close"]
    return current>max(x["high"] for x in previous) if side=="LONG" else current<min(x["low"] for x in previous)

def route_match(policy:dict,row:dict,regime:str,is_strong:bool,price:float,
                f:dict,bars:dict,ts:int)->bool:
    c=row["candidate"];score=float(c["score"]);v=float(c["volumeRatio"])
    mom=float(c["momentum"]);side=str(c["side"])
    atr=float(c["atr"])/price
    if not all(math.isfinite(z) for z in (score,v,mom,atr)):return False
    if v<policy.get("minvol",.80) or v>=policy.get("maxvol",float("inf")):return False
    if abs(mom)<.0227 or abs(mom)<.0060879:return False
    if regime not in ("LONG","SHORT","NEUTRAL"):return False
    if regime=="LONG" and side!="LONG" or regime=="SHORT" and side!="SHORT":return False
    kind=policy["kind"]
    if kind=="none":return False
    if kind=="hc_score_gap":return policy["minscore"]<=score<1.0
    if kind=="hc_neutral_gap":return regime=="NEUTRAL" and policy["minscore"]<=score<1.0
    if kind=="hc_strong_gap":
        return is_strong and regime!="NEUTRAL" and policy["minscore"]<score<1.0 and atr>=.014
    if kind=="hc_low_volume":
        return score>=policy["scoremin"]
    if kind=="strong_breakout_gap":
        return (is_strong and regime!="NEUTRAL" and .70<score<1.0
                and v>=1.20 and atr>=.014 and f["btc12h"]>0
                and breakout(bars,row["symbol"],ts,side))
    if kind=="rank4_hc":return score>=1.0 and v>=.80
    raise ValueError("UNKNOWN_SELECTED_BASE_VARIANT:"+kind)

def signal_record(row:dict,rank:int,gate:dict,ts:int,regime:str)->dict:
    c=row["candidate"];sym=row["symbol"]
    signal={k:c[k] for k in ("side","score","momentum","volatility","atr","volumeRatio")}
    signal.update(symbol=sym.removesuffix("USDT"),rank=rank,regime=regime,
                  referenceTs=ts,entryTs=ts,
                  entryQualityClass=("HC175" if gate.get("highConfidence") else "STANDARD"),
                  entryGrossMultiplier=float(gate.get("entryGrossMultiplier",1)),
                  entryGateReason=gate["reason"])
    return {"strategy_id":"V12","symbol":sym,"decision_ts_ms":ts,
            "status":"SIGNAL","signal":signal,
            "source_runtime_sha":ORIGINAL_SHA,"research_addon":True}

def evaluate_cases(root:Path,baseline_scans:Path,baseline_candidates:Path,
                   v52_ledger:Path,ecb:Path,output:Path)->dict:
    output.mkdir(parents=True,exist_ok=True)
    raw=_rows(baseline_scans/"baseline-signal-scan/decisions/V12.jsonl")
    original=_rows(baseline_candidates/"crypto-price-model-candidates.jsonl")
    baseline_v12=[x for x in original if x["strategy_id"]=="V12"]
    other=[x for x in original if x["strategy_id"]!="V12"]
    if len(raw)!=61502: # same frozen one-year Aster H1 decisions
        raise ValueError(f"V12_RAW_SCAN_PARITY_FAIL:{len(raw)}")
    syms={r["symbol"] for r in raw}|{"BTCUSDT"}
    bar=h2_bars(root,syms)
    own_h1={};own_funding={};invalid={}
    for s in sorted(syms):
        own_h1[s],own_map,invalid[s]=_bars(root,s)
        own_h1[s]=own_map
        own_funding[s]=_funding(root,s)
    by_ts=defaultdict(list)
    original_signals=defaultdict(list)
    for r in raw:
        ts=int(r.get("reference_ts_ms") or r["decision_ts_ms"])
        by_ts[ts].append(r)
        if r["status"]=="SIGNAL":original_signals[ts].append(r)
    def model(rows:list[dict],primary:dict|None=None)->list[dict]:
        primary=primary if primary is not None else _v12_primary_map(rows)
        ledger=[]
        for r in rows:
            sym=r["symbol"];c=_v12_outcome(r,own_h1[sym],primary)
            if r.get("research_addon"):
                c["route"]="V12_ADDON"
                c["research_addon"]=True
            reason=_source_quarantine_reason(c,invalid)
            if reason:
                c["pre_quarantine_status"]=c["status"];c["status"]="UNRESOLVED_SOURCE_OHLC"
                c["source_quarantine_reason"]=reason
            if c["status"]=="MODELED_CLOSED_TRADE":
                c["funding_return_per_gross"]=_funding_return_per_gross(
                    own_funding[sym],c["side"],int(c["entry_ts_ms"]),int(c["exit_ts_ms"]))
            else:
                c["funding_return_per_gross"]=None
            if r.get("research_addon"):
                c["requested_gross"]=min(float(c.get("requested_gross") or 0),float(r["research_cap"]))
            ledger.append(c)
        return ledger
    originals=[r for ts in sorted(original_signals) for r in original_signals[ts]]
    baseline_primary=_v12_primary_map(originals)
    recomputed=model(originals,baseline_primary)
    def sigkey(x):
        return (int(x["entry_ts_ms"]),x["symbol"],x["side"],int(x.get("rank") or 0))
    orig_map={sigkey(x):x for x in baseline_v12}
    new_map={sigkey(x):x for x in recomputed}
    if orig_map.keys()!=new_map.keys():raise ValueError("V12_ORIGINAL_LEDGER_KEY_PARITY_FAIL")
    for key,old in orig_map.items():
        new=new_map[key]
        for attr in ("status","entry_price","exit_price","exit_ts_ms","exit_reason",
                     "requested_gross","unit_price_return","funding_return_per_gross"):
            a=old.get(attr);b=new.get(attr)
            if isinstance(a,(float,int)) and isinstance(b,(float,int)):
                if not math.isclose(float(a),float(b),rel_tol=1e-9,abs_tol=1e-9):
                    raise ValueError(f"V12_LEDGER_MODEL_PARITY_FAIL:{key}:{attr}:{a}!={b}")
            elif a!=b:raise ValueError(f"V12_LEDGER_MODEL_PARITY_FAIL:{key}:{attr}:{a}!={b}")
    # Stable fee/exit/gross-source parity is established before any scenario.
    manifest={"status":"UNTESTED","baseline_v12_candidates_exact_replay":len(orig_map),
      "source_runtime_sha":ORIGINAL_SHA,"frozen_source_unchanged":True,
      "base_crypto_candidate_sha256":sha(baseline_candidates/"crypto-price-model-candidates.jsonl"),
      "raw_v12_sha256":sha(baseline_scans/"baseline-signal-scan/decisions/V12.jsonl"),
      "market_data_manifest_sha256":sha(root/"acquisition-manifest.json"),
      "selected_baseline":{"score":1.0,"volume":.80,"strong_score":[.15,.70],
                           "relaxed_score_min":.35},
      "baseline_ledger_frozen_for_addons":True,"variants":{}}
    # Gate parity: compute all original ranked candidate WR features from closed H2;
    # use EXACT frozen TypeScript exported WR evaluator through audited bridge.
    gate_cache={}
    parity=Counter()
    with RuntimeBridge() as bridge:
        def gate(row:dict,ts:int,rank:int)->dict|None:
            key=(row["symbol"],ts,row["candidate"]["side"],rank)
            if key not in gate_cache:
                f=features(bar,row["symbol"],ts,row["candidate"]["side"])
                gate_cache[key]=bridge.invoke("v12","evaluateV12WinRateGateFromFeatures",f,rank) if f else None
            return gate_cache[key]
        for ts,rs in sorted(by_ts.items()):
            for row in rs:
                c=row.get("candidate")
                if not c or not c.get("portfolioRank") or not c.get("entryGateReason"):continue
                parity["checked"]+=1
                actual=gate(row,ts,int(c["portfolioRank"]))
                if actual is None or actual.get("reason")!=c["entryGateReason"]:
                    parity["mismatches"]+=1
                    if parity["mismatches"]<=3:
                        print("V12_WR_GATE_PARITY_MISMATCH",
                              row["symbol"],ts,c["entryGateReason"],actual,flush=True)
        if parity["checked"]<1000 or parity["mismatches"]:
            raise ValueError("ORIGINAL_WINRATE_GATE_PARITY_FAILED:"+repr(dict(parity)))
        manifest["win_rate_gate_reconstruction"]=dict(parity)
        write_json(output/"source-parity.json",manifest)
        for name,policy in VARIANTS.items():
            chosen=[]
            counters=Counter()
            for ts,rows in sorted(by_ts.items()):
                existing=sorted(original_signals.get(ts,[]),
                        key=lambda r:(int(r["signal"]["rank"]),r["symbol"]))
                chosen.extend(existing)
                if len(existing)>=3:continue
                existing_ranks={int(r["signal"]["rank"]) for r in existing}
                if policy.get("base_empty") and existing:continue
                if policy.get("kind")=="none":continue
                if policy.get("satellite_only") and existing_ranks!={1,2}:continue
                # Never promote a rescue ahead of a baseline-selected signal.
                # It may only occupy a later slot at that closed-bar timestamp.
                rank=(3 if policy.get("satellite_only")
                    else (max(existing_ranks)+1 if existing_ranks else 1))
                if rank>3:continue
                if rank is None:continue
                regime=rows[0].get("btc_regime")
                if regime not in ("NEUTRAL","LONG","SHORT"):continue
                is_strong=strong_btc(bar,ts,regime)
                possibilities=[]
                protected={r["symbol"] for r in existing}
                for row in rows:
                    c=row.get("candidate");sym=row["symbol"]
                    if not c or sym in protected or ts not in bar.get(sym,{}):continue
                    # Accept only originally gate-rejected (score/volume/quality)
                    # NOT an HC/false-burst refusal or an already eligible rank4.
                    why=c.get("signalReason")
                    if policy["kind"]=="rank4_hc":
                        if why!="SIGNAL_ELIGIBLE" or c.get("portfolioRank"):continue
                    elif why not in ("VOLUME_RATIO_BELOW_MINIMUM",
                                      "BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED"):continue
                    f=features(bar,sym,ts,c["side"])
                    if f is None:
                        counters["FEATURES_INVALID"]+=1;continue
                    if not route_match(policy,row,regime,is_strong,
                                       bar[sym][ts]["close"],f,bar,ts):continue
                    if f["btc12h"]<policy.get("btc12_min",-100):continue
                    if f["rel24h"]<policy.get("relative24_min",-100):continue
                    counters["ELIGIBLE_BEFORE_WINRATE"]+=1
                    decision=gate(row,ts,rank)
                    if decision is None or not decision.get("allow"):
                        counters["ORIGINAL_WINRATE_BLOCK"]+=1;continue
                    if policy.get("hc_required",True) and not decision.get("highConfidence"):
                        counters["NON_HC_NOT_ELIGIBLE"]+=1;continue
                    if rank==3 and float(c["score"])<.70:continue
                    possibilities.append((float(c["score"]),sym,row,decision))
                if possibilities:
                    possibilities.sort(key=lambda x:(-x[0],x[1]))
                    _,_,winner,decision=possibilities[0]
                    s=signal_record(winner,rank,decision,ts,regime)
                    s["research_cap"]=policy["cap"]
                    chosen.append(s)
                    counters["EXTRA_SELECTED"]+=1
            addon_rows=[r for r in chosen if r.get("research_addon")]
            addon=model(addon_rows,baseline_primary)
            # Existing V12 entries and their original modeled exits are byte-level
            # identical to the selected-base ledger; only addon lifecycles are new.
            modeled=[*baseline_v12,*addon]
            # Include non-V12 source as originally built; no other strategy
            # receives a modified signal/exit. The portfolio allocates all 5
            # chronologically under the actual common gross/slot logic.
            result_root=output/name
            candidate_root=result_root/"candidate-stream"
            candidate_root.mkdir(parents=True,exist_ok=True)
            merged=sorted([*other,*modeled],
              key=lambda r:(int(r.get("entry_ts_ms") or 0),r["strategy_id"],r["symbol"],
                            int(r.get("rank") or 0)))
            candidate_path=candidate_root/"crypto-price-model-candidates.jsonl"
            candidate_path.write_text("".join(json.dumps(x,sort_keys=True,allow_nan=False)+"\n"
                                              for x in merged),encoding="utf-8")
            gated_root,audit=gate_candidate_stream(merged,root,result_root/"fet-gated")
            portfolio=run_portfolio_model(root,gated_root,result_root/"portfolio",
                         v52_ledger_root=v52_ledger,ecb_fx_root=ecb,
                         cost_scenarios=COSTS,research_risk_caps=REQUESTED_CAPS)
            if portfolio["status"]!="ALL_FIVE_H1_PRICE_MODEL_NOT_FORMAL_L2_VERIFIED":
                raise ValueError("VARIANT_FIVE_LOGIC_INCOMPLETE:"+name+":"+portfolio["status"])
            metrics={}
            for scenario in portfolio["scenarios"]:
                sid=scenario["scenario_id"]
                if scenario["accounting_reconciliation"]["status"]!="PASS":
                    raise ValueError("ACCOUNTING_RECONCILIATION_FAILED:"+name+":"+sid)
                candidate_decisions=_rows(result_root/"portfolio"/sid/"candidate-decisions.jsonl")
                accepted_extra=[r for r in candidate_decisions if r["strategy_id"]=="V12"
                                and r.get("route")=="V12_ADDON"
                                and r["decision"]=="ACCEPTED_MODELED_ENTRY"]
                if len(accepted_extra)>counters["EXTRA_SELECTED"]:
                    raise ValueError("EXTRA_ACCEPTED_GT_SIGNAL_GENERATED")
                metrics[sid]={
                  "final_equity_jpy":scenario["final_equity_jpy"],
                  "maximum_mtm_drawdown":scenario["maximum_mtm_drawdown"],
                  "profit_factor":scenario["profit_factor"],
                  "win_rate":scenario["win_rate"],
                  "closed_trades":scenario["closed_trades"],
                  "by_strategy_trades":scenario["strategy_trades"],
                  "by_strategy_pnl_jpy":scenario["strategy_pnl_jpy"],
                  "extra_accepted":len(accepted_extra),
                  "base_selected_signal_count":len(originals),
                  "monthly_equity_jpy":scenario["monthly_equity_jpy"],
                  "candidate_decisions":scenario["candidate_decision_counts"],
                  "accounting_pass":True,
                }
            manifest["variants"][name]={
              "policy":policy,"signal_audit":dict(counters),
              "extra_candidates_frozen_lifecycle":len(addon),
              "crypto_stream_sha256":sha(candidate_path),
              "fet_blocked_unique":sum(bool(r["gate_reasons"]) for r in audit),
              "scenarios":metrics}
            write_json(result_root/"compact-metrics.json",manifest["variants"][name])
            print("V12_ADDON_VARIANT_FINISHED",json.dumps({
                "name":name,"additional_candidates":len(addon),
                "metrics":{sid:{"final":v["final_equity_jpy"],"dd":v["maximum_mtm_drawdown"],
                    "trades":v["closed_trades"],"extra_accepted":v["extra_accepted"]}
                           for sid,v in metrics.items()}},sort_keys=True),flush=True)
    manifest["status"]="ALL_PREDECLARED_VARIANTS_FINISHED_RESEARCH_ONLY"
    write_json(output/"grid-summary.json",manifest)
    return manifest

def main():
    p=argparse.ArgumentParser()
    for arg in ("root","baseline-scans","baseline-candidates","v52-ledger","ecb","output"):
        p.add_argument("--"+arg,required=True,type=Path)
    a=p.parse_args()
    evaluate_cases(a.root,a.baseline_scans,a.baseline_candidates,a.v52_ledger,a.ecb,a.output)
if __name__=="__main__":main()
