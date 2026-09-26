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
 # Search previously overlooked temporary source and research-state filenames.
 result["tempFiles"]=[]
 temp=pathlib.Path("/tmp")
 if temp.is_dir():
  for parent,dirs,files in os.walk(temp,followlinks=False):
   here=pathlib.Path(parent)
   dirs[:]=[d for d in sorted(dirs) if d not in SKIP and not (here/d).is_symlink()]
   if len(here.relative_to(temp).parts)>=3:dirs[:]=[]
   for name in sorted(files):
    p=here/name
    if p.is_symlink() or not re.search(
      r"final|monthly|integrat|gross|top3|fet|q102|quality|pengu|v12|backtest|bt|govern|source|ledger|cache",name,re.I):continue
    try:
     meta=safe_meta(p);meta["suffix"]=p.suffix
     if p.suffix.lower()==".json" and p.stat().st_size<3_000_000:
      try:
       v=json.loads(p.read_bytes())
       meta["shape"]={"type":type(v).__name__,"length":len(v) if hasattr(v,"__len__") else None,
        "keys":list(v)[:35] if isinstance(v,dict) else None,
        "firstKeys":list(v[0])[:35] if isinstance(v,list) and v and isinstance(v[0],dict) else None}
      except (ValueError,UnicodeError):pass
     result["tempFiles"].append(meta)
    except OSError:continue
    if len(result["tempFiles"])>=250:break
 result["researchStateFiles"]=[]
 for p in [pathlib.Path("/home/deploy/disdex-trading/work/v12-winrate-gates-20260923/.research-state"),
           pathlib.Path("/home/deploy/disdex-trading/work/repair-20260918/.research-state")]:
  if not p.is_dir():continue
  for parent,dirs,files in os.walk(p,followlinks=False):
   here=pathlib.Path(parent)
   dirs[:]=[d for d in sorted(dirs) if d not in SKIP and not (here/d).is_symlink()]
   if len(here.relative_to(p).parts)>=6:dirs[:]=[]
   for name in files:
    f=here/name
    if f.is_symlink():continue
    try:result["researchStateFiles"].append(safe_meta(f))
    except OSError:pass
    if len(result["researchStateFiles"])>=300:break
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
 # Inventory VPS backup sets and inspect archive member names, never extract.
 result["backupFiles"]=[]
 for root_s in ("/home/deploy/disdex-trading/backups","/var/backups","/home/deploy/ai-dex-manager/backups"):
  b=pathlib.Path(root_s)
  if not b.is_dir():continue
  for parent,dirs,files in os.walk(b,followlinks=False):
   here=pathlib.Path(parent)
   dirs[:]=[d for d in dirs if d not in SKIP and not (here/d).is_symlink()]
   if len(here.relative_to(b).parts)>=4:dirs[:]=[]
   for name in sorted(files):
    p=here/name
    if p.is_symlink():continue
    try:
     stat=p.stat()
     meta={"path":str(p),"size":stat.st_size,"mtimeUtc":int(stat.st_mtime)}
     if stat.st_size<150_000_000 and (p.suffix==".zip" or name.endswith((".tar",".tar.gz",".tgz"))):
      try:
       if p.suffix==".zip":
        import zipfile
        with zipfile.ZipFile(p) as z:names=z.namelist()
       else:
        import tarfile
        with tarfile.open(p) as t:names=t.getnames()
       meta["archiveEntries"]=len(names)
       meta["relevantEntries"]=[n for n in names if re.search(
        r"research_v12_dynamic|research_lab_v96_v52|final-live-governor|q102|fet|integrat|research-state",n,re.I)][:120]
      except (OSError,ValueError):meta["archiveReadable"]=False
     result["backupFiles"].append(meta)
    except OSError:pass
 result["shellHistoryMatches"]=[]
 for filename in ("/root/.bash_history","/home/deploy/.bash_history","/root/.zsh_history","/home/deploy/.zsh_history"):
  p=pathlib.Path(filename)
  if not p.is_file() or p.is_symlink():continue
  try:
   raw=p.read_bytes()[:2_000_000]
   terms=[k for k,v in MARKERS.items() if v in raw]
   if terms:result["shellHistoryMatches"].append({"path":str(p),"markers":terms})
  except OSError:pass
 result["oldCodexSessionMatches"]=[]
 for root_s in ("/root/.codex/sessions","/home/deploy/.codex/sessions",
                "/root/.local/share/codex","/home/deploy/.local/share/codex"):
  p=pathlib.Path(root_s)
  if not p.is_dir():continue
  for parent,dirs,files in os.walk(p,followlinks=False):
   here=pathlib.Path(parent)
   dirs[:]=[d for d in dirs if d not in SKIP and not (here/d).is_symlink()]
   if len(here.relative_to(p).parts)>=9:dirs[:]=[]
   for filename in files:
    f=here/filename
    if f.is_symlink() or f.suffix.lower() not in (".jsonl",".json",".log",".txt",".md"):continue
    try:
     stat=f.stat()
     if stat.st_size>40_000_000:continue
     raw=f.read_bytes()
     terms=[k for k,v in MARKERS.items() if v in raw]
     if terms:result["oldCodexSessionMatches"].append({"path":str(f),"bytes":stat.st_size,
       "mtimeUtc":int(stat.st_mtime),"markers":terms,"sha256":hashlib.sha256(raw).hexdigest()})
    except OSError:pass
 result["additionalTmpPython"]=[]
 for base in ("/tmp","/var/tmp"):
  p=pathlib.Path(base)
  if not p.is_dir():continue
  for here,ds,files in os.walk(p,followlinks=False):
   depth=len(pathlib.Path(here).relative_to(p).parts)
   ds[:]=[d for d in ds if d not in SKIP]
   if depth>=3:ds[:]=[]
   for name in files:
    if not name.endswith((".py",".sh",".ipynb")):continue
    f=pathlib.Path(here)/name
    if f.is_symlink():continue
    try:
     meta=safe_meta(f)
     result["additionalTmpPython"].append(meta)
    except OSError:pass
    if len(result["additionalTmpPython"])>=150:break
 return result
if __name__=="__main__":
 print(json.dumps(scan(),ensure_ascii=False,separators=(",",":")))
