#!/usr/bin/env python3
"""Find the exact 2026-09-19/22 source and prerequisites. Read-only, metadata only."""
import os, pathlib, re, hashlib, json, time, subprocess
ROOTS=[
 "/home/deploy/disdex-trading/work",
 "/home/deploy/ai-dex-manager/.research-state",
 "/home/deploy/ai-dex-manager-v96-paper/.research-state",
 "/home/deploy/disdex-trading/.research-state",
 "/home/deploy/disdex-trading/research",
 "/home/deploy/ai-dex-manager/scripts",
 "/home/deploy/ai-dex-manager-v96-paper/scripts",
 "/home/deploy/ai-dex-manager/.stock-research",
 "/home/deploy/disdex-trading/.stock-research",
 "/root/disdex-research","/root/.research-state",
 "/home/deploy/disdex-trading/backups",
 "/home/deploy/disdex-trading/archive",
 "/var/backups","/tmp","/var/tmp"
]
SKIP={"node_modules",".git",".next",".venv","venv","__pycache__",".ssh","secrets","credentials","private","releases",".runtime-state","runtime-state","site-packages","npm","pip","cargo","rustup"}
NAMES={
 "research_v12_dynamic2_q102_brk2465_20260919.py",
 "research_lab_v96_v52_dual_slot_one_year_bt.py",
 "integrated-engine.py",
 "final-live-governor-20260922.json",
 "final-static-4p25-baseline-20260922.json",
}
MARKERS={
 "original_script":b"research_v12_dynamic2_q102_brk2465_20260919",
 "old_v52_module":b"research_lab_v96_v52_dual_slot_one_year_bt",
 "original_final":b"1448665533",
 "original_static":b"1479916279",
 "original_final_ref":b"final-live-governor-20260922",
 "exact_governor":b"PROFIT_4",
}
SUFFIX={".py",".json",".jsonl",".yaml",".yml",".md",".ts",".js",".sh",".log",".txt"}
PAT=re.compile(r"v12.*dynamic|research.*v12|quality102|q102|top3|fet|governor|integrat|ledger|cache|stock|pengu",re.I)
def safe_meta(p):
 st=p.stat()
 d={"path":str(p),"size":st.st_size,"mtimeUtc":int(st.st_mtime)}
 if st.st_size<=32_000_000:
  with p.open("rb") as f:d["sha256"]=hashlib.file_digest(f,"sha256").hexdigest()
 return d
def scan():
 result={"schema":"original14b-source-locator-v1","readOnly":True,"tradingMutation":0,
  "roots":[],"exactFileMatches":[],"referenceHits":[],"researchCandidates":[],"cacheDirs":[],
  "gitHistory":[],"visited":0,"stoppedByCap":False}
 seen=set()
 for root_s in ROOTS:
  root=pathlib.Path(root_s)
  item={"path":str(root),"exists":root.is_dir(),"visited":0}
  result["roots"].append(item)
  if not root.is_dir() or root.is_symlink():continue
  for parent,dirs,files in os.walk(root,followlinks=False):
   here=pathlib.Path(parent)
   depth=len(here.relative_to(root).parts)
   dirs[:]=sorted(d for d in dirs if d not in SKIP and not (here/d).is_symlink())
   if root_s=="/home/deploy/disdex-trading/work" and depth==0:
    dirs[:]=[d for d in dirs if re.search(r"v12|research|quality|fet|gross|202609|performance|final|dynamic|top3",d,re.I)]
   if depth>=7:dirs[:]=[]
   for d in dirs:
    if d==".research-state" or re.search(r"bt.*cache|research.*cache",d,re.I):
     if len(result["cacheDirs"])<160:
      p=here/d;result["cacheDirs"].append({"path":str(p),"mtimeUtc":int(p.stat().st_mtime)})
   for n in sorted(files):
    f=here/n
    if f.is_symlink() or f in seen:continue
    seen.add(f); result["visited"]+=1;item["visited"]+=1
    if result["visited"]>32000:
     result["stoppedByCap"]=True
     return result
    if n in NAMES:
     try:result["exactFileMatches"].append(safe_meta(f))
     except OSError:pass
    elif PAT.search(n) and f.suffix.lower() in SUFFIX and len(result["researchCandidates"])<350:
     try:result["researchCandidates"].append(safe_meta(f))
     except OSError:pass
    if f.suffix.lower() not in SUFFIX or f.name.startswith(".env"):continue
    if len(result["referenceHits"])>150:continue
    try:
     size=f.stat().st_size
     if size>3_000_000 or size==0:continue
     data=f.read_bytes()
     hits=[key for key,marker in MARKERS.items() if marker in data]
     if hits:result["referenceHits"].append({"path":str(f),"matches":hits,"sha256":hashlib.sha256(data).hexdigest(),"size":size})
    except (OSError,PermissionError):pass
 # Read-only git history check for original script path, even if removed from branches.
 repos=["/home/deploy/ai-dex-manager","/home/deploy/ai-dex-manager-v96-paper",
        "/home/deploy/disdex-trading/work/v12-winrate-gates-20260923"]
 for path in repos:
  if not pathlib.Path(path).is_dir():continue
  try:
   p=subprocess.run(["git","-C",path,"log","--all","--format=%H %as %s","--",
                     "scripts/research_v12_dynamic2_q102_brk2465_20260919.py",
                     "scripts/research_lab_v96_v52_dual_slot_one_year_bt.py"],
                    capture_output=True,text=True,timeout=8)
   result["gitHistory"].append({"repository":path,"matches":p.stdout.splitlines()[:20],"stderrClass":"none" if p.returncode==0 else "nonzero"})
  except (OSError,subprocess.TimeoutExpired):pass
 return result
if __name__=="__main__":
 print(json.dumps(scan(),ensure_ascii=False,separators=(",",":")))
