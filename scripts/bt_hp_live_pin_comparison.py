#!/usr/bin/env python3
"""Fail-closed source-model vs active-systemd SHA comparison for research BT.

This is evidence of version identity ONLY, never evidence of actual venue
executions, model/economic parity, trading permissions, or safe deployment.
Does not connect to a host or mutate LIVE services.
"""
from __future__ import annotations
import argparse,csv,hashlib,json,re,sys
from datetime import datetime,timezone
from pathlib import Path

SERVICE_PREFIX={
 "V4":"disdex-v12-v4",
 "Q102":"disdex-quality102-causal-v1",
 "PENGU":"disdex-pengu-dual-ls-v2",
 "FET":"disdex-fet-brk48",
 "HYPE":"disdex-hype-long",
 "IDLE":"disdex-idle-priority-short",
 "V52":"disdex-v52-aster-only",
}
SHA=re.compile(r"[0-9a-f]{40}\Z")

def digest(path:Path)->str:
 h=hashlib.sha256()
 with path.open("rb") as fh:
  for chunk in iter(lambda:fh.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()

def parse_active_services(raw:str)->dict[str,set[str]]:
 observed={k:set() for k in SERVICE_PREFIX}
 for line in raw.splitlines():
  parts=line.strip().split()
  if len(parts)<4:continue
  unit,load,active,sub=parts[:4]
  if (load,active,sub)!=("loaded","active","running"):continue
  for logic,prefix in SERVICE_PREFIX.items():
   if not unit.startswith(prefix+"@"):continue
   match=re.fullmatch(re.escape(prefix)+r"@([0-9a-f]{40})\.service",unit)
   if match:observed[logic].add(match.group(1))
   else:observed[logic].add("INVALID_SYSTEMD_SERVICE_NAME")
 return observed

def source_pins(paths:list[Path])->tuple[dict[str,set[str]],dict[str,list[str]]]:
 out={k:set() for k in SERVICE_PREFIX}
 input_cases={k:[] for k in SERVICE_PREFIX}
 for path in paths:
  with path.open("r",encoding="utf-8-sig",newline="") as fh:
   reader=csv.DictReader(fh)
   need={"trade_id","logic","source_runtime_sha","entry_price"}
   if not reader.fieldnames or not need.issubset(reader.fieldnames):
    raise ValueError("Incomplete source model admissions: "+str(path))
   seen=set()
   for row in reader:
    key=(row["trade_id"] or "").strip()
    logic=(row["logic"] or "").strip()
    value=(row["source_runtime_sha"] or "").strip().lower()
    if not key or key in seen:raise ValueError("Duplicate source admission ID")
    if logic not in SERVICE_PREFIX:raise ValueError("Unknown source logic: "+logic)
    if not SHA.fullmatch(value):raise ValueError("Invalid model-runtime SHA: "+logic)
    seen.add(key);out[logic].add(value)
    if path.name not in input_cases[logic]:input_cases[logic].append(path.name)
  if not seen:raise ValueError("Empty model admissions: "+str(path))
 return out,input_cases

def compare(snapshot:Path,entries:list[Path])->dict:
 active=parse_active_services(snapshot.read_text(encoding="utf-8-sig"))
 recorded,origin=source_pins(entries)
 output={}
 for logic in SERVICE_PREFIX:
  current=sorted(active[logic]);historical=sorted(recorded[logic])
  if not current:status="NO_RUNNING_SERVICE"
  elif "INVALID_SYSTEMD_SERVICE_NAME" in current:status="INVALID_SYSTEMD_SERVICE"
  elif len(current)!=1:status="MULTIPLE_ACTIVE_SERVICE_PINS"
  elif not historical:status="NO_MODEL_ADMISSIONS"
  elif len(historical)!=1:status="MULTIPLE_SOURCE_PINS"
  elif current[0]!=historical[0]:status="PIN_MISMATCH"
  else:status="PIN_SHA_MATCH_ONLY"
  output[logic]={"status":status,"activeSystemdSha":current,
    "sourceModelShas":historical,"sourceCases":origin[logic]}
 return {
  "kind":"READ_ONLY_BT_SOURCE_PIN_COMPARISON_NOT_TRADE_CERTIFICATION",
  "checkedAtUtc":datetime.now(timezone.utc).isoformat(),
  "snapshotSha256":digest(snapshot),
  "modelAdmissionsSha256":{p.name:digest(p) for p in entries},
  "overall":"BLOCKED_FULL_LIVE_PARITY" if any(v["status"]!="PIN_SHA_MATCH_ONLY" for v in output.values()) else "SHA_MATCH_ONLY_ECONOMIC_PARITY_UNVERIFIED",
  "logic":output,
  "productionChanged":False,
 }

def main(argv=None)->int:
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--systemd-snapshot",type=Path,required=True)
 p.add_argument("--model-entries",type=Path,required=True,nargs="+")
 p.add_argument("--output",type=Path)
 args=p.parse_args(argv)
 if len({x.resolve() for x in args.model_entries})!=len(args.model_entries):
  raise ValueError("Duplicate model-admission source path")
 result=compare(args.systemd_snapshot,args.model_entries)
 payload=json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n"
 if args.output:
  args.output.parent.mkdir(parents=True,exist_ok=True)
  args.output.write_text(payload,encoding="utf8")
 print(payload)
 return 2 if result["overall"]=="BLOCKED_FULL_LIVE_PARITY" else 0

if __name__=="__main__":sys.exit(main())