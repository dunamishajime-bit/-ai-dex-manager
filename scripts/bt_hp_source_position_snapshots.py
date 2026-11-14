#!/usr/bin/env python3
"""Strict read-only import of model-engine, time-aligned position snapshot evidence.

No price, position quantity or per-position Gross is ever guessed, derived from
a BTC candle or allocated from Total Gross. Each official equity observation
needs its full position set or an explicit empty snapshot sentinel.
"""
from __future__ import annotations
import csv,math
from pathlib import Path
from datetime import datetime,timezone

STOCKS={"AMZN","AAPL","MSFT","NVDA","META","TSLA","GOOGL","GOOG"}
REQUIRED={"utc","trade_id","logic","symbol","side","quantity","entry_price",
          "mark_price","fx_jpy_per_price_unit","contract_multiplier",
          "notional_jpy","current_gross_x","entry_gross_x","category"}
MONEY_TOLERANCE=0.001
GROSS_TOLERANCE=0.02

def _time(raw:str)->str:
    dt=datetime.fromisoformat(raw.strip().replace("Z","+00:00"))
    if dt.tzinfo is None:raise ValueError("Naive position timestamp")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def _float(raw:str,name:str,strictly_positive:bool=False)->float:
    v=float(raw)
    if not math.isfinite(v) or (v<=0 if strictly_positive else v<0):
        raise ValueError("Invalid source position "+name)
    return v

def load_position_snapshots(path:Path)->dict[str,list[dict]]:
    """Require every timepoint, including empty timepoints, to have evidence."""
    grouped:dict[str,list[dict]]={}
    sentinel:set[str]=set()
    seen:set[tuple[str,str]]=set()
    with path.open("r",encoding="utf-8-sig",newline="") as stream:
        reader=csv.DictReader(stream)
        if not reader.fieldnames or not REQUIRED.issubset(set(reader.fieldnames)):
            raise ValueError("Missing mandatory source position snapshot columns")
        previous=""
        for row in reader:
            t=_time(row["utc"])
            if previous and t<previous:raise ValueError("Unsorted source position timestamps")
            previous=t
            if t not in grouped:grouped[t]=[]
            key=row["trade_id"].strip()
            if key=="":
                if t in sentinel or grouped[t]:
                    raise ValueError("Invalid duplicate/mixed source empty-snapshot marker")
                if any((val or "").strip() for k,val in row.items() if k not in ("utc","trade_id")):
                    raise ValueError("Empty position snapshot marker must not carry positions")
                sentinel.add(t)
                continue
            if t in sentinel or (t,key) in seen:
                raise ValueError("Duplicate or mixed source position snapshot ID")
            seen.add((t,key))
            quantity=_float(row["quantity"],"quantity",True)
            entry=_float(row["entry_price"],"entry",True)
            mark=_float(row["mark_price"],"mark",True)
            fx=_float(row["fx_jpy_per_price_unit"],"FX rate",True)
            multiplier=_float(row["contract_multiplier"],"contract multiplier",True)
            notional=_float(row["notional_jpy"],"JPY notional",True)
            gross=_float(row["current_gross_x"],"current Gross")
            entry_gross=_float(row["entry_gross_x"],"entry Gross")
            if not row["logic"].strip() or not row["symbol"].strip() or row["side"] not in ("LONG","SHORT"):
                raise ValueError("Invalid source position identity")
            if row["category"] not in ("crypto","stock"):
                raise ValueError("Unknown source position category")
            # The account's FX and multiplier must be carried in source evidence.
            # Recompute notional only as an integrity check, never as a substitute.
            model=quantity*mark*fx*multiplier
            if abs(model-notional)>max(.01,notional*MONEY_TOLERANCE):
                raise ValueError("Position quantity/mark/FX/notional mismatch")
            grouped[t].append({
                "id":key,"logic":row["logic"].strip(),"symbol":row["symbol"].strip(),
                "side":row["side"],"quantity":quantity,"entry":entry,"mark":mark,
                "notional":notional,"gross":gross,"grossAtEntry":entry_gross,
                "_category":row["category"]
            })
    if not grouped:raise ValueError("Empty source position snapshots")
    if set(sentinel)&{t for t,v in grouped.items() if v}:
        raise ValueError("Position snapshot sentinel mixed with positions")
    return grouped

def check_source_snapshot(*,timestamp:str,active:dict[str,dict],
                          summary:dict,source_gross:dict,positions:dict[str,list[dict]])->list[dict]:
    if timestamp not in positions:
        raise ValueError("Missing source position snapshot for equity timestamp "+timestamp)
    records=positions[timestamp]
    if {p["id"] for p in records}!=set(active):
        raise ValueError("Model fill/position snapshot ID mismatch at "+timestamp)
    expected_count=summary.get("open_count")
    if expected_count not in (None,"") and int(expected_count)!=len(records):
        raise ValueError("Open count mismatch at "+timestamp)
    gross_total=0.0;gross_crypto=0.0;gross_stock=0.0
    out=[]
    for item in records:
        ref=active[item["id"]]
        for a,b in (("logic","logic"),("symbol","symbol"),("side","side")):
            if item[a]!=ref[b]:raise ValueError("Source position identity mismatch at "+timestamp)
        if abs(item["entry"]-ref["entry"])>max(1e-5,ref["entry"]*1e-7):
            raise ValueError("Source position entry mismatch at "+timestamp)
        # Partial closes may change grossAtEntry only in original lifecycle
        # evidence, so compare to the fill's *initial* exposure.
        if abs(item["grossAtEntry"]-ref["grossAtEntry"])>1e-6:
            raise ValueError("Source position initial Gross mismatch at "+timestamp)
        symbol=item["symbol"].upper().removesuffix("USDT")
        if (symbol in STOCKS) != (item["_category"]=="stock"):
            raise ValueError("Source category/symbol mismatch at "+timestamp)
        if item["gross"]<0:raise ValueError("Negative position Gross")
        gross_total+=item["gross"]
        if item["_category"]=="stock":gross_stock+=item["gross"]
        else:gross_crypto+=item["gross"]
        out.append({**{k:v for k,v in ref.items() if k in ("id","logic","symbol","side","entry","openedAt",
                "lastPartialGrossX","lastPartialAt","lastPartialFractionClosed")},
                "quantity":item["quantity"],"mark":item["mark"],"notional":item["notional"],
                "gross":item["gross"],"grossAtEntry":item["grossAtEntry"]})
    for kind,current in (("total",gross_total),("crypto",gross_crypto),("stock",gross_stock)):
        if abs(current-source_gross[kind])>GROSS_TOLERANCE:
            raise ValueError("Source position "+kind+" Gross fails source equity reconciliation at "+timestamp)
    return out
