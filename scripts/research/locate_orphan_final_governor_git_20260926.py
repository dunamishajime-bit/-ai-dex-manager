#!/usr/bin/env python3
"""Read-only scan of local Git unreachable blobs for original 14.49億 BT generator."""
from __future__ import annotations
import os,subprocess,json,re,hashlib
repos=["/home/deploy/ai-dex-manager","/home/deploy/disdex-trading/work/v12-winrate-gates-20260923"]
markers={"original_script":b"research_v12_dynamic2_q102_brk2465_20260919",
 "final_result":b"1448665533","result_path":b"final-live-governor-20260922.json",
 "final_engine":b"final_live_governor"}
out={"readOnly":True,"tradingMutation":0,"repos":[]}
os.environ["GIT_OPTIONAL_LOCKS"]="0"
for repo in repos:
 d={"path":repo,"status":"UNKNOWN","unreachableBlobs":0,"scannedBlobs":0,
    "truncated":False,"matches":[],"unreachableCommits":[]}
 out["repos"].append(d)
 try:
  r=subprocess.run(["git","-C",repo,"fsck","--full","--no-reflogs","--unreachable",
     "--no-progress"],capture_output=True,text=True,timeout=75)
  rows=r.stdout.splitlines()
  blobs=re.findall(r"^unreachable blob ([0-9a-f]{40})$",r.stdout,re.M)
  commits=re.findall(r"^unreachable commit ([0-9a-f]{40})$",r.stdout,re.M)
  d["status"]="OK" if r.returncode==0 else "FSCK_NONZERO"
  d["unreachableBlobs"]=len(blobs)
  d["unreachableCommits"]=commits[:40]
  for sha in blobs[:5000]:
   d["scannedBlobs"]+=1
   size=subprocess.run(["git","-C",repo,"cat-file","-s",sha],capture_output=True,text=True,timeout=2)
   if not size.stdout.strip().isdigit() or int(size.stdout)>6_000_000:continue
   blob=subprocess.run(["git","-C",repo,"cat-file","blob",sha],capture_output=True,timeout=3)
   if blob.returncode!=0:continue
   hits=[name for name,p in markers.items() if p in blob.stdout]
   if hits:
    d["matches"].append({"sha":sha,"bytes":len(blob.stdout),"markers":hits,
       "sha256":hashlib.sha256(blob.stdout).hexdigest()})
  d["truncated"]=len(blobs)>5000
 except (OSError,subprocess.TimeoutExpired):
  d["status"]="UNAVAILABLE_OR_TIMEOUT"
print(json.dumps(out,ensure_ascii=False,separators=(",",":")))
