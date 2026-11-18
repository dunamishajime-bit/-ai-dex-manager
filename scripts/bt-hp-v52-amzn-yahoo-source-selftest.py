"""Offline V52 source-native AMZN SHORT reference gate regression.
No connection to credentials, Yahoo, Aster or any LIVE module.
"""
from __future__ import annotations
import ast
import hashlib
import importlib.util
import sys
sys.dont_write_bytecode=True
import json
from pathlib import Path
from datetime import datetime

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/"lib"/"bt-verification"/"pinned-native-v52"
manifest=json.loads((SOURCE/"source-manifest.json").read_text(encoding="utf-8"))
module_path=SOURCE/"amzn_yahoo_gate_pure.py"
source_text=module_path.read_text(encoding="utf-8")
tree=ast.parse(source_text)
actual={}
for n in tree.body:
    if isinstance(n,ast.FunctionDef) and n.name in manifest["extractedNativeFunctionSha256"]:
        actual[n.name]=hashlib.sha256(ast.get_source_segment(source_text,n).replace(chr(10),chr(13)+chr(10)).encode("utf-8")).hexdigest()
assert actual==manifest["extractedNativeFunctionSha256"],"NATIVE_EXTRACTED_FUNCTION_BODY_MISMATCH"
assert manifest["upstreamRawSha256"]=="a460ec08d3b9d5dfc5df0d43edb41e54a37e6fc280af8ebf9f8a20ab4821e920"
assert "urllib" not in source_text and "def fetch_yahoo_h1_bars" not in source_text
spec=importlib.util.spec_from_file_location("bt_hp_v52_amzn_pure",module_path)
assert spec is not None and spec.loader is not None
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def ts(value:str)->int:
    return int(datetime.fromisoformat(value.replace("Z","+00:00")).timestamp()*1000)
def bar(time:str,close:float)->dict:
    return {"start_ms":ts(time),"close":close}
fri=bar("2026-10-16T13:30:00Z",100)
mon=bar("2026-10-19T15:30:00Z",101)
now=ts("2026-10-19T16:30:00Z")
allow=module.evaluate_amzn_short_yahoo_gate(decision_ms=now,bars=[fri,mon])
assert allow["status"]=="PASS" and allow["reason"]=="AMZN_SHORT_YAHOO_PREV_CLOSE_NOT_GT_1PCT"
deny=module.evaluate_amzn_short_yahoo_gate(decision_ms=now,bars=[fri,bar("2026-10-19T15:30:00Z",101.000001)])
assert deny["status"]=="BLOCK" and deny["reason"]=="AMZN_SHORT_YAHOO_PREV_CLOSE_GT_1PCT"
for bars in ([],[mon],[fri,bar("2026-10-19T16:00:00Z",115)],
             [bar("2026-10-15T13:30:00Z",100),mon]):
    assert module.evaluate_amzn_short_yahoo_gate(decision_ms=now,bars=bars)["status"]=="DATA_UNAVAILABLE"
holiday=module.evaluate_amzn_short_yahoo_gate(
    decision_ms=ts("2025-09-02T16:30:00Z"),
    bars=[bar("2025-08-29T13:30:00Z",100),
          bar("2025-09-01T13:30:00Z",125),
          bar("2025-09-02T15:30:00Z",100.5)])
assert holiday["status"]=="PASS"
assert holiday["previousNySessionDate"]=="2025-08-29"
assert module.normalize_yahoo_h1_bars([bar("2025-09-01T13:30:00Z",99)])==[]
print("PASS source-pinned V52 AMZN SHORT gate: 13 original pure functions, boundary exact +1%, strict >1%, no future, no missing prior date fallback, holidays, fail closed; no orders")
