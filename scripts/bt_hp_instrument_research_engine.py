#!/usr/bin/env python3
"""Research-only source-Gross observer for the archived STABLE4 BT wrapper.

Does not place orders or edit the source model. Replays with the same
causal mark_current/mtm_gross_state phase, writing auditable sidecar CSVs.
The source engine stores JPY model notional, NOT actual venue quantity/FX;
neither may be reconstructed from model fills.
"""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path

PREFIX = """  position_gross_evidence=[]
  model_entry_evidence=[]
  def capture_position_gross(t,eq,gs):
   if eq is None or gs is None or not (0 < eq < float("inf")):
    raise RuntimeError("GROSS_SOURCE_EQUITY_UNAVAILABLE:"+iso(t))
   rows=[]
   for pid,q in sorted(opened.items()):
    if q["s"]=="V52":
     mark=v52_mark5(q["symbol"],t)
     if mark is None:mark=q["entry"]
    else:
     z=completed_h1(q["symbol"],t)
     if z is None:raise RuntimeError("GROSS_SOURCE_QUOTE_MISSING:"+q["symbol"]+":"+iso(t))
     mark=q["entry"] if z[0]+H<=q.get("active_ts",q["ts"]) else z[4]
    notional=float(q["notional"])*float(mark)/float(q["entry"])
    gross=notional/eq
    if not all(math.isfinite(x) and x>=0 for x in (notional,gross,mark)):
     raise RuntimeError("GROSS_SOURCE_NONFINITE:"+pid+":"+iso(t))
    rows.append(dict(utc=iso(t),trade_id=pid,logic=q["s"],symbol=q["symbol"],
     side=q["side"],entry_price=q["entry"],mark_price=mark,
     current_notional_jpy=notional,current_gross_x=gross,
     entry_gross_x=q.get("original_gross",q["gross"]),
     category="stock" if q["s"]=="V52" else "crypto",
     account_equity_jpy=eq))
   for key,actual in (("total",sum(x["current_gross_x"] for x in rows)),
                      ("crypto",sum(x["current_gross_x"] for x in rows if x["category"]=="crypto")),
                      ("stock",sum(x["current_gross_x"] for x in rows if x["category"]=="stock"))):
    if abs(actual-float(gs[key]))>1e-8:
     raise RuntimeError("GROSS_SOURCE_MISMATCH:"+key+":"+iso(t))
   position_gross_evidence.extend(rows if rows else [dict(utc=iso(t))])
"""

def replace_exact(source: str, before: str, after: str, name: str) -> str:
    count=source.count(before)
    if count!=1:raise ValueError(f"Research engine {name} anchor mismatch: {count}")
    return source.replace(before,after,1)

def instrument_generated(source: str) -> str:
    source=replace_exact(
        source,
        'def simulate(name,bps,priority,include_v4):',
        'def simulate(name,bps,priority,include_v4):\n'+''.join(line[1:] if line.startswith(' ') else line for line in PREFIX.splitlines(True)).rstrip('\n'),
        "simulate init",
    )
    source=replace_exact(
        source,
        '  v4_mtm_overcap=False',
        '  capture_position_gross(t,eq,gs)\n  v4_mtm_overcap=False',
        "equity timepoint",
    )
    source=replace_exact(
        source,
        '   opened[pid]=q',
        '''   opened[pid]=q
   model_entry_evidence.append(dict(trade_id=pid,utc=iso(t),logic=s,
    symbol=q["symbol"],side=q["side"],route=q["route"],
    entry_price=q["entry"],entry_gross_x=q.get("original_gross",q["gross"]),
    source_signal_id=q["sid"],source_runtime_sha=PIN[q["s"]]))''',
        "admitted entry",
    )
    source=replace_exact(
        source,
        ' expected_cash=10000+sum(x["net_pnl_jpy"] for x in fills)',
        ' capture_position_gross(END,terminal_eq,gs_end)\n expected_cash=10000+sum(x["net_pnl_jpy"] for x in fills)',
        "terminal timepoint",
    )
    source=replace_exact(
        source,
        ' wr(pp+"_DECISIONS.csv",entries,["signal_id","strategy","utc","decision","reason","requested_gross"])',
        ''' wr(pp+"_MODEL_ENTRIES.csv",model_entry_evidence,["trade_id","utc","logic","symbol","side","route",
  "entry_price","entry_gross_x","source_signal_id","source_runtime_sha"])
 wr(pp+"_POSITION_GROSS_SNAPSHOTS.csv",position_gross_evidence,["utc","trade_id","logic","symbol","side",
  "entry_price","mark_price","current_notional_jpy","current_gross_x",
  "entry_gross_x","category","account_equity_jpy"])
 wr(pp+"_DECISIONS.csv",entries,["signal_id","strategy","utc","decision","reason","requested_gross"])''',
        "sidecar output",
    )
    compile(source, "<bt-model-research-with-gross-observer>", "exec")
    return source

def run_wrapper(wrapper: Path, *, verify_only: bool=False, suffix: str="_GROSS_CAPTURE_V1") -> None:
    if not suffix.startswith("_") or not suffix.replace("_","").isalnum():
        raise ValueError("Unsafe output suffix")
    code=wrapper.read_text(encoding="utf-8")
    out='out_name="STABLE4_OPPORTUNITY_PROD_CAPS_20261114"'
    if code.count(out)!=1:raise ValueError("Unknown STABLE4 wrapper output")
    code=code.replace(out,out[:-1]+suffix+'"',1)
    anchor='exec(compile(orig,str(SRC)+"::PRETARGET_STABLE_"+case,"exec"),{"__name__":"__main__"})'
    injection='''from bt_hp_instrument_research_engine import instrument_generated
orig=instrument_generated(orig)
print("BT_GROSS_CAPTURE_SOURCE_SHA",hashlib.sha256(orig.encode("utf-8")).hexdigest(),flush=True)
'''+anchor
    if code.count(anchor)!=1:raise ValueError("Unknown STABLE4 execution anchor")
    code=code.replace(anchor,injection,1)
    compile(code,str(wrapper)+"::GROSS_CAPTURE_WRAPPER","exec")
    print("WRAPPER_SHA256",hashlib.sha256(wrapper.read_bytes()).hexdigest(),flush=True)
    print("OUTPUT_SUFFIX",suffix,"VERIFY_ONLY",verify_only,flush=True)
    os.environ.setdefault("DISDEX_Q102_ADOPTED_MODE","ON")
    os.environ.setdefault("DISDEX_PRETARGET_STABLE_CASE","STABLE3")
    if verify_only:
        # Execute generator prelude without executing simulation or writing outputs.
        preview=code.replace(anchor,'print("INSTRUMENTED_GENERATED_SHA256",hashlib.sha256(orig.encode("utf8")).hexdigest(),flush=True)',1)
        preview=preview.split("O=R/out_name",1)[0]
        exec(compile(preview,str(wrapper)+"::GROSS_CAPTURE_VERIFY","exec"),
             {"__name__":"__main__","__file__":str(wrapper)})
        return
    # No source or production code edited; stdout and sidecars land in separate research directory.
    exec(compile(code,str(wrapper)+"::GROSS_CAPTURE_WRAPPER","exec"),{"__name__":"__main__","__file__":str(wrapper)})

def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--wrapper",required=True,type=Path)
    p.add_argument("--suffix",default="_GROSS_CAPTURE_V1")
    p.add_argument("--verify-only",action="store_true")
    a=p.parse_args()
    run_wrapper(a.wrapper,verify_only=a.verify_only,suffix=a.suffix)

if __name__=="__main__":main()
