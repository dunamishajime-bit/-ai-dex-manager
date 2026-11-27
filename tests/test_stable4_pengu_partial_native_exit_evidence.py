"""Research-only evidence contract: reject any PENGU partial replay promoted to fills/LIVE."""
from __future__ import annotations
import copy
import hashlib
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCES={
 "shortV20":"STABLE4_PENGU_V20_NATIVE_TIMED_M5_NO_LOOKAHEAD_V2_20261128.json",
 "recoveryV8":"STABLE4_PENGU_RECOVERY_V8_NATIVE_RISK_H1_AUDIT_20261128.json",
 "normalLong":"STABLE4_PENGU_LONG_NATIVE_H1_RISK_AUDIT_20261128.json",
}
PINS={
 "shortV20":"0a6ea1538dbb69678dcb9d39a79a523cbad3c572ef367c6365d93b82da535039",
 "recoveryV8":"f90c0129931144319e092927a5b839a8e420beebb1c84cd7015758386ea846f8",
 "normalLong":"34ca1c275aa663e4f5e2365c00479806b1a39323ab4f544afbc47bb93a83e57f",
}
def load(name:str)->dict:
    p=ROOT/"docs/research"/SOURCES[name]
    raw=p.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=PINS[name]:raise ValueError("EVIDENCE_SHA_MISMATCH")
    return json.loads(raw)
def verify(name:str, doc:dict)->None:
    if doc.get("orderAuthority") is not False or doc.get("fullPenguAnnualTradeReplay") is not False:
        raise ValueError("RESEARCH_SCOPE_FORGED")
    if name=="shortV20":
        if doc.get("schema")!="stable4-pengu-v20-native-timed-aster-m5-isolated/v2":
            raise ValueError("V20_SCHEMA")
        summary=doc["summary"]
        if (summary["uniqueShortV20"]!=41 or summary["rawShortV20EachArm"]!=41
          or summary["priceProxyAfter5m"]!=23 or summary["firstM5Positive"]!=23
          or summary["nextM5PositiveExPost"]!=18
          or summary["nativeTimed3hThreshold"]!=3
          or summary["nativeTimed8hThreshold"]!=1
          or summary["notTriggered"]!=19 or summary["unknownOrBlocked"]!=18):
            raise ValueError("V20_SUMMARY_MISMATCH")
        rows=doc["records"]
        if len(rows)!=41 or len({r["entryTs"] for r in rows})!=41:raise ValueError("V20_ROWS")
        for r in rows:
            if r["modelEntryTs"]!=r["entryTs"]+300000 or r["firstConfirmedM5Ts"]!=r["entryTs"]+300000:
                raise ValueError("V20_CAUSAL_M5_CLOCK")
            if r["nextM5OpenPriceProxy"] is not None and r["firstConfirmedM5PositiveVolume"] is not True:
                raise ValueError("V20_UNCONFIRMED_ADMISSION")
        if not any(r["nextM5OpenPriceProxy"] is not None and r["followingM5VolumePositiveExPost"] is False for r in rows):
            raise ValueError("V20_EXPOST_GATE_REINTRODUCED")
    elif name=="recoveryV8":
        if doc.get("schema")!="stable4-pengu-recovery-v8-native-risk-h1-observations/v1":
            raise ValueError("V8_SCHEMA")
        summary=doc["summary"]
        if (summary["recoveryRawH1Candidates"]!=48 or summary["modelStatus"]!={"MODELED_SOURCE_NATIVE_RISK_EXIT_NOT_FILL":29,"FIRST_M5_CONFIRMATION_UNAVAILABLE":19}
          or summary["modeledExitReasons"]!={"TRAILING_STOP":13,"HARD_STOP":12,"MAX_HOLD":4}
          or summary["modeledPartialCandidates"]!=8):
            raise ValueError("V8_SUMMARY")
        rows=doc["outcomes"]
        if len(rows)!=48 or len({r["originalEntryTs"] for r in rows})!=48:raise ValueError("V8_ROWS")
        if any(r.get("yieldBaseLongNotReplayed") is not True for r in rows if r.get("events") is not None):
            raise ValueError("V8_YIELD_FALSE_PARITY")
        for r in rows:
            events=r.get("events",[])
            if r.get("modeledPartial")!=any(e.get("kind")=="PARTIAL_DEFENSE" for e in events) and events:
                raise ValueError("V8_PARTIAL_HARD_SAME_BAR_NOT_RECORDED")
    elif name=="normalLong":
        if doc.get("schema")!="stable4-pengu-long-source-native-h1-exit-observations/v1":
            raise ValueError("LONG_SCHEMA")
        s=doc["summary"]
        if (s["rawLongBase"]!=13 or s["rawLongV8V64"]!=23
           or s["modelStatus"]!={"ISOLATED_NATIVE_LONG_RISK_EXIT_NOT_FILL":17,"FIRST_M5_CONFIRMATION_UNAVAILABLE":6}
           or s["modeledExitReasons"]!={"LONG_TRAILING_STOP":11,"LONG_MAX_HOLD":2,"LONG_HARD_STOP":4}):
            raise ValueError("LONG_SUMMARY")
        if len(doc["outcomes"])!=23:raise ValueError("LONG_ROWS")
    else:raise ValueError("UNKNOWN_RESEARCH_ARM")
    for path,pin in doc["sourcePins"].items():
        if not path.startswith(("lib/","config/","scripts/research/")) or not (ROOT/path).is_file():
            raise ValueError("SOURCE_PATH_INVALID")
        if hashlib.sha256((ROOT/path).read_bytes()).hexdigest()!=pin:
            raise ValueError("SOURCE_PIN_MISMATCH:"+path)

class PenguExitEvidenceTest(unittest.TestCase):
    def test_partial_research_only_and_source_sha(self):
        for name in SOURCES:
            with self.subTest(name=name):verify(name,load(name))
    def test_reject_forged_live_or_full_bt_claim(self):
        for name in SOURCES:
            with self.subTest(name=name):
                for field in ("orderAuthority","fullPenguAnnualTradeReplay"):
                    doc=copy.deepcopy(load(name));doc[field]=True
                    with self.assertRaises(ValueError):verify(name,doc)
    def test_reject_explicit_summary_and_exit_scope_tamper(self):
        v=load("shortV20");v["summary"]["priceProxyAfter5m"]+=1
        with self.assertRaises(ValueError):verify("shortV20",v)
        v=load("recoveryV8");v["summary"]["modeledPartialCandidates"]-=1
        with self.assertRaises(ValueError):verify("recoveryV8",v)
        v=load("normalLong");v["summary"]["rawLongBase"]+=1
        with self.assertRaises(ValueError):verify("normalLong",v)
    def test_reject_next_bar_lookahead_regression(self):
        v=load("shortV20")
        for row in v["records"]:
            if row["nextM5OpenPriceProxy"] is not None and not row["followingM5VolumePositiveExPost"]:
                row["nextM5OpenPriceProxy"]=None
        with self.assertRaises(ValueError):verify("shortV20",v)

if __name__=="__main__":unittest.main()
