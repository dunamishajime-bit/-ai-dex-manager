#!/usr/bin/env python3
"""Verify research-engine Gross sidecars against every equity timepoint.

This tier attests per-position model Gross, equity, mark and JPY model
notional only. It NEVER fabricates venue quantity, contract multiplier or FX.
"""
from __future__ import annotations
import csv
import math
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_GROSS = {
    "utc", "trade_id", "logic", "symbol", "side", "entry_price",
    "mark_price", "current_notional_jpy", "current_gross_x",
    "entry_gross_x", "category", "account_equity_jpy"
}
REQUIRED_ENTRY = {
    "trade_id", "utc", "logic", "symbol", "side", "route", "entry_price",
    "entry_gross_x", "source_signal_id", "source_runtime_sha"
}
GROSS_TOLERANCE=1e-7
CASH_TOLERANCE=1e-7

def utc(raw: str) -> str:
    d=datetime.fromisoformat(raw.strip().replace("Z","+00:00"))
    if d.tzinfo is None:raise ValueError("Naive model timestamp")
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def positive(raw, label: str, *, zero: bool=False) -> float:
    v=float(raw)
    if not math.isfinite(v) or (v<0 if zero else v<=0):
        raise ValueError("Invalid source model "+label)
    return v

def read_csv(path: Path, mandatory: set[str]) -> list[dict]:
    with path.open(encoding="utf-8-sig",newline="") as stream:
        reader=csv.DictReader(stream)
        if not reader.fieldnames or not mandatory.issubset(set(reader.fieldnames)):
            raise ValueError("Missing model source columns: "+str(path))
        return list(reader)

def load_model_entries(path: Path) -> dict[str,dict]:
    records={}
    for row in read_csv(path,REQUIRED_ENTRY):
        key=row["trade_id"].strip()
        if not key or key in records:raise ValueError("Duplicate/empty source model entry ID")
        if not row["logic"] or not row["symbol"] or row["side"] not in ("LONG","SHORT"):
            raise ValueError("Invalid source model entry identity")
        if not row["route"] or not row["source_signal_id"] or len(row["source_runtime_sha"])!=40:
            raise ValueError("Incomplete source model entry attestation")
        records[key]={
            "id":key,"openedAt":utc(row["utc"]), "logic":row["logic"],
            "symbol":row["symbol"],"side":row["side"],
            "entry":positive(row["entry_price"],"entry price"),
            "grossAtEntry":positive(row["entry_gross_x"],"entry Gross"),
            "route":row["route"],"sourceRuntimeSha":row["source_runtime_sha"]
        }
    if not records:raise ValueError("Empty source model entry ledger")
    return records

def load_model_gross(path: Path) -> dict[str,list[dict]]:
    groups={}
    seen=set()
    last=""
    for row in read_csv(path,REQUIRED_GROSS):
        t=utc(row["utc"])
        if last and t<last:raise ValueError("Unsorted model Gross timestamps")
        last=t
        groups.setdefault(t,[])
        key=(row["trade_id"] or "").strip()
        if not key:
            if any((val or "").strip() for col,val in row.items() if col not in ("utc","trade_id")):
                raise ValueError("Invalid model Gross flat marker")
            if groups[t]:raise ValueError("Flat marker mixed with source positions")
            if (t,"") in seen:raise ValueError("Duplicate model Gross flat marker")
            seen.add((t,""))
            continue
        if (t,key) in seen or (t,"") in seen:
            raise ValueError("Duplicate/mixed model Gross row")
        seen.add((t,key))
        category=row["category"]
        if category not in ("crypto","stock") or row["side"] not in ("LONG","SHORT"):
            raise ValueError("Invalid source Gross category or side")
        if not row["logic"] or not row["symbol"]:raise ValueError("Missing source Gross identity")
        eq=positive(row["account_equity_jpy"],"account equity")
        notional=positive(row["current_notional_jpy"],"current model notional")
        gross=positive(row["current_gross_x"],"current Gross",zero=True)
        if not math.isclose(notional/eq,gross,rel_tol=1e-9,abs_tol=1e-9):
            raise ValueError("Source model Gross/JPY notional/equity mismatch")
        groups[t].append({
            "id":key,"logic":row["logic"],"symbol":row["symbol"],
            "side":row["side"],"entry":positive(row["entry_price"],"entry"),
            "mark":positive(row["mark_price"],"mark"),
            "notional":notional,"gross":gross,
            "grossAtEntry":positive(row["entry_gross_x"],"initial Gross"),
            "_category":category,"_equity":eq
        })
    if not groups:raise ValueError("Empty model Gross snapshots")
    return groups

class GrossReconciler:
    """Verify observation times and exact inventory from model entry + closed-fill records."""
    def __init__(self, entries:dict, snapshots:dict, fills_path:Path):
        self.entries=entries
        self.snapshots=snapshots
        self.used=set()
        self.entry_events=sorted((rec["openedAt"],key) for key,rec in entries.items())
        self.exits=[]
        self.entry_cursor=0
        self.exit_cursor=0
        self.active=set()
        seen=set()
        with fills_path.open(encoding="utf-8-sig",newline="") as stream:
            for row in csv.DictReader(stream):
                key=row["trade_id"]
                if key in seen or key not in entries:raise ValueError("Model filled ID absent from model entry evidence")
                seen.add(key)
                ref=entries[key]
                if row["strategy"]!=ref["logic"] or row["symbol"]!=ref["symbol"]:
                    raise ValueError("Model fill/entry identity mismatch")
                if utc(row["entry_utc"])!=ref["openedAt"]:
                    raise ValueError("Model fill/entry timestamp mismatch")
                end=row.get("exit_utc")
                if end:
                    exit_at=utc(end)
                    if exit_at<=ref["openedAt"]:raise ValueError("Model exit not after entry")
                    self.exits.append((exit_at,key))
        self.exits.sort()

    def check(self, t:str, source_equity:dict, source_gross:dict) -> list[dict]:
        if t in self.used or t not in self.snapshots:
            raise ValueError("Missing/repeated source Gross timepoint: "+t)
        # The engine samples equity AFTER matured closes and BEFORE new
        # entries at exactly t. New entries first appear at the next sample.
        while self.entry_cursor<len(self.entry_events) and self.entry_events[self.entry_cursor][0]<t:
            self.active.add(self.entry_events[self.entry_cursor][1])
            self.entry_cursor+=1
        while self.exit_cursor<len(self.exits) and self.exits[self.exit_cursor][0]<t:
            self.active.discard(self.exits[self.exit_cursor][1])
            self.exit_cursor+=1
        # The engine processes matured heap exits BEFORE sampling equity, but
        # a same-tick preemption can close positions AFTER that sample.
        # Match the observed source IDs without claiming these two phases
        # are interchangeable. Same-time closes are allowed to straddle the
        # sampling phase only; older/newer missing IDs always fail closed.
        before_same_tick=set(self.active)
        same_tick_exits=set()
        while self.exit_cursor<len(self.exits) and self.exits[self.exit_cursor][0]==t:
            same_tick_exits.add(self.exits[self.exit_cursor][1])
            self.exit_cursor+=1
        rows=self.snapshots[t]
        observed={p["id"] for p in rows}
        after_same_tick=before_same_tick-same_tick_exits
        if not after_same_tick.issubset(observed) or not observed.issubset(before_same_tick):
            raise ValueError("Model source inventory/equity timepoint mismatch at "+t)
        self.active=after_same_tick
        if source_equity.get("open_count") not in (None,"") and int(source_equity["open_count"])!=len(rows):
            raise ValueError("Model source open count mismatch at "+t)
        eq=positive(source_equity["compounded_mtm_equity_jpy"],"equity")
        gross={"crypto":0.0,"stock":0.0,"total":0.0}
        output=[]
        for item in rows:
            ref=self.entries[item["id"]]
            if item["logic"]!=ref["logic"] or item["symbol"]!=ref["symbol"]:
                raise ValueError("Model source identity mismatch at "+t)
            # Side/entry can change at a source-modeled reversal; quantities remain UNKNOWN.
            if abs(item["grossAtEntry"]-ref["grossAtEntry"])>1e-9:
                raise ValueError("Model source initial Gross mismatch at "+t)
            if (item["logic"]=="V52")!=(item["_category"]=="stock"):
                raise ValueError("Model source stock classification mismatch at "+t)
            if abs(item["_equity"]-eq)>max(CASH_TOLERANCE,abs(eq)*1e-10):
                raise ValueError("Model source per-position equity mismatch at "+t)
            gross[item["_category"]]+=item["gross"]
            gross["total"]+=item["gross"]
            output.append({
                "id":item["id"],"logic":item["logic"],"symbol":item["symbol"],
                "side":item["side"],"entry":item["entry"],"openedAt":ref["openedAt"],
                "quantity":None,"mark":item["mark"],"notional":item["notional"],
                "gross":item["gross"],"grossAtEntry":item["grossAtEntry"],"category":item["_category"]
            })
        for key in ("total","crypto","stock"):
            if abs(gross[key]-float(source_gross[key]))>GROSS_TOLERANCE:
                raise ValueError("Model source "+key+" Gross/equity reconciliation failed at "+t)
        self.used.add(t)
        return output

    def finish(self) -> None:
        if self.used!=set(self.snapshots):
            raise ValueError("Extra/missing model Gross timepoints relative to equity")
