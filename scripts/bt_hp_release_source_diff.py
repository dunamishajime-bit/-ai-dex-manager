#!/usr/bin/env python3
"""Read-only allowlisted source-level diff of historical vs active runner releases.

This compares source files, not executed orders or historical market effects.
Identical files alone never certify a backtest as current LIVE parity.
"""
from __future__ import annotations
import argparse,hashlib,json,difflib,sys
from datetime import datetime,timezone
from pathlib import Path

PATTERNS={
 "V4":("lib/v12-v4-*.ts","lib/v12-multilogic-v4-shadow.ts","lib/v12-x1-all.ts",
       "config/v12X1AllRuntime.ts","lib/disdex-strict-portfolio-planner.ts","scripts/v12-v4-*.ts"),
 "HYPE":("lib/hype-zec-*.ts","lib/hype-*.ts","config/hype*.ts","scripts/disdex-hype-*.ts"),
}

def normalized(path:Path)->bytes:
    # CRLF differences must not count as a strategy change.
    return path.read_bytes().replace(bytes([13,10]),bytes([10]))

def compare(logic:str,old:Path,new:Path)->dict:
    if logic not in PATTERNS:raise ValueError("UNKNOWN_LOGIC")
    if not old.is_dir() or not new.is_dir():raise ValueError("SOURCE_RELEASE_NOT_PRESENT")
    paths=set()
    for pattern in PATTERNS[logic]:
        paths.update(str(p.relative_to(old)).replace(chr(92),"/") for p in old.glob(pattern) if p.is_file())
        paths.update(str(p.relative_to(new)).replace(chr(92),"/") for p in new.glob(pattern) if p.is_file())
    if not paths:raise ValueError("NO_ALLOWLISTED_SOURCE_FILES")
    results=[]
    for relative in sorted(paths):
        a=old/relative;b=new/relative
        if not a.is_file() or not b.is_file():
            results.append({"file":relative,"status":"MISSING_OLD" if not a.is_file() else "MISSING_LIVE"})
            continue
        old_bytes=normalized(a);new_bytes=normalized(b)
        sha_a=hashlib.sha256(old_bytes).hexdigest();sha_b=hashlib.sha256(new_bytes).hexdigest()
        if old_bytes==new_bytes:
            results.append({"file":relative,"status":"SAME_NORMALIZED_SOURCE","oldSha256":sha_a,"liveSha256":sha_b})
            continue
        old_lines=old_bytes.decode("utf8","replace").splitlines()
        new_lines=new_bytes.decode("utf8","replace").splitlines()
        delta=list(difflib.unified_diff(old_lines,new_lines,n=0))
        add=sum(x.startswith("+") and not x.startswith("+++") for x in delta)
        delete=sum(x.startswith("-") and not x.startswith("---") for x in delta)
        results.append({"file":relative,"status":"SOURCE_DIFF","oldSha256":sha_a,"liveSha256":sha_b,
                       "addedLines":add,"deletedLines":delete})
    counts={key:sum(x["status"]==key for x in results) for key in
            ("SAME_NORMALIZED_SOURCE","SOURCE_DIFF","MISSING_OLD","MISSING_LIVE")}
    return {"schema":"disdex-bt-release-source-diff/v1","logic":logic,
            "sourcePatternScope":list(PATTERNS[logic]),"observedAtUtc":datetime.now(timezone.utc).isoformat(),
            "oldRelease":old.name,"liveRelease":new.name,"counts":counts,
            "status":"SOURCE_SEGMENT_DIFF_UNVERIFIED" if any(x["status"]!="SAME_NORMALIZED_SOURCE" for x in results)
            else "SOURCE_SEGMENT_SAME_ONLY_UNVERIFIED",
            "economicParityCertified":False,"readOnly":True,"files":results}

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--logic",choices=tuple(PATTERNS),required=True)
    p.add_argument("--old-root",type=Path,required=True)
    p.add_argument("--live-root",type=Path,required=True)
    a=p.parse_args(argv)
    print(json.dumps(compare(a.logic,a.old_root,a.live_root),ensure_ascii=False,sort_keys=True))

if __name__=="__main__":sys.exit(main())