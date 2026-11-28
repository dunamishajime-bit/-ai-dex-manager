"""Audit the 12 limited real-monthly Q102 causal V1 BTC/SOL observations.

Separate, bounded provenance from full Q102 universe or seven-runner execution.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/research/STABLE4_Q102_BINANCE_BTC_SOL_12_MONTHLY_NATIVE_H1_20261128.json"
H=3_600_000
PINS = {
 "lib/disdex-quality102-causal-v1-signal.ts":"ae530d14fc088b5f018495f4a17ab5615388df57",
 "lib/disdex-quality102-causal-pipeline.ts":"388054044274f34c9156a343d22a72cc611f4071",
 "lib/disdex-quality102-causal-selector.ts":"6e309f2ccc08e2a8812493be00e5b591fe6f2cff",
 "config/disdexQuality102CausalV1Runtime.ts":"f679dde1007e7aa521d7e81c82d00ca543d3b2dc",
}
INPUT_SHA={
 "BTCUSDT":"c367d886cbf4470c791026ac067f1d85c6807610f3f2579ecb8dcc8f98bc3e1d",
 "SOLUSDT":"a11a62dab778ded86b7bfdaf961e1a898c7c159319b56200afd1bcd1f369df1b",
}

def blob_digest(raw:bytes)->str:
 return hashlib.sha1(b"blob "+str(len(raw)).encode("ascii")+b"\0"+raw).hexdigest()

def validate(doc:dict,root:Path=ROOT)->dict:
 if (doc.get("schema")!="stable4-q102-binance-btc-sol-real-h1-monthly-native-v1"
  or doc.get("status")!="LIMITED_NATIVE_H1_MONTHLY_REPLAY_PASS_NO_TRADES"
  or doc.get("periodUtc")!=["2025-10-01T00:00:00Z","2026-10-01T00:00:00Z"]
  or doc.get("sourceOnly") is not True
  or any(doc.get(k) is not False for k in ("rootCertificateIssued","orderAuthority",
                                           "portfolioReplayComplete","productionEligible"))):
  raise ValueError("Q102_MONTHLY_SCOPE_OR_AUTHORITY_INVALID")
 for path,pin in PINS.items():
  file=root/path
  if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root):
   raise ValueError("Q102_NATIVE_SOURCE_UNSAFE")
  if doc.get("sourcePins",{}).get(path)!=pin or blob_digest(file.read_bytes())!=pin:
   raise ValueError("Q102_NATIVE_SOURCE_SHA_MISMATCH:"+path)
 for name,sha in INPUT_SHA.items():
  v=doc.get("inputs",{}).get(name,{})
  if v.get("sha256")!=sha or v.get("h1")!=13896:
   raise ValueError("Q102_NATIVE_REAL_DATA_DIGEST_OR_H1_COUNT_MISMATCH")
 rows=doc.get("cases")
 if not isinstance(rows,list) or len(rows)!=12:
  raise ValueError("Q102_MONTHLY_CASE_COUNT_INVALID")
 for idx,r in enumerate(rows):
  date=dt.datetime(2025+((9+idx)//12),(9+idx)%12+1,1,tzinfo=dt.timezone.utc)
  ts=int(date.timestamp()*1000)
  native=r.get("nativeSource",{})
  if (r.get("decisionTs")!=ts
   or r.get("monthUtc")!=date.strftime("%Y-%m")
   or r.get("hoursOfClosedHistory")!=(ts-int(dt.datetime(2025,3,1,tzinfo=dt.timezone.utc).timestamp()*1000))//H
   or r.get("orderAuthority") is not False
   or r.get("venueExecutionConfirmed") is not False
   or native.get("status")!="NO_SOURCE_ENTRY" or native.get("side")!=0
   or native.get("symbol") is not None or native.get("requestedGross")!=0
   or native.get("dataCutoffTs")!=ts-H):
   raise ValueError("Q102_MONTHLY_CASE_SOURCE_OR_EXECUTION_INVALID")
 if doc.get("summary")!={"months":12,"rawLong":0,"rawShort":0,"noSignal":12,"blocked":0}:
  raise ValueError("Q102_MONTHLY_SUMMARY_INVALID")
 return {"status":"LIMITED_NATIVE_Q102_REAL_MONTHLY_H1_EVIDENCE_VERIFIED",
         "months":12,"symbols":["BTCUSDT","SOLUSDT"],"noOrders":True,
         "fullQ102UniverseCertified":False,"fullYearEntryBacktestCertified":False}

if __name__=="__main__":
 print(json.dumps(validate(json.loads(EVIDENCE.read_text(encoding="utf8")))))
