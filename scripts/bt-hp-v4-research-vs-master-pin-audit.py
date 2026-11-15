"""BT-481-I2 immutable Git object comparison; not production read."""
import hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
REPO=Path(__file__).resolve().parent.parent
OLD="9118eeaa6c209dc6e37887cf5be139b3baaa005d"
MASTER="6f1a14862fb2d2e458632580178cc91ca92540ed"
manifest=json.loads((REPO/"lib/bt-verification/pinned-native-v4-full/source-manifest.json").read_text(encoding="utf-8-sig"))
master_type=subprocess.run(["git","-C",str(REPO),"cat-file","-t",MASTER],capture_output=True,check=True).stdout.strip()
assert master_type==b"commit","REMOTE_MASTER_OBJECT_MISSING"
assert manifest["gitRevision"]==OLD
paths=sorted({x["original"] for x in manifest["files"]}|
             {"lib/v12-v4-native-core.ts","config/integratedProductionRiskPolicy.ts"})
def object_bytes(ref,path):
 p=subprocess.run(["git","-C",str(REPO),"show",ref+":"+path],capture_output=True)
 if p.returncode!=0:return None
 return p.stdout
rows=[]
for path in paths:
 a=object_bytes(OLD,path)
 b=object_bytes(MASTER,path)
 assert a is not None,("OLD_GIT_SOURCE_MISSING",path)
 old_sha=hashlib.sha256(a).hexdigest()
 if b is None:
   rows.append({"path":path,"oldSha256":old_sha,"masterSha256":None,
       "kind":"MISSING_FROM_MASTER","isProductionParity":False})
   continue
 new_sha=hashlib.sha256(b).hexdigest()
 rows.append({"path":path,"oldSha256":old_sha,"masterSha256":new_sha,
        "kind":"IDENTICAL_GIT_BLOB" if a==b else "CHANGED_GIT_BLOB",
        "isProductionParity":False})
changed=[r for r in rows if r["kind"]!="IDENTICAL_GIT_BLOB"]
report={
 "schema":"bt-pr481-v4-git-master-pin-comparison-v1",
 "taskId":"BT-481-I2_READONLY_GITHUB_CHECK",
 "frozenResearchSha":OLD,"observedRemoteMasterSha":MASTER,
 "method":"git show of existing local Git objects only; no Git fetch or mutation",
 "scope":"repository master only, NOT VPS or actual deployed V4 runner",
 "sourceFiles":rows,"sourceFilesExamined":len(rows),
 "changedOrMissingPaths":len(changed),
 "currentLiveRunnerShaVerified":False,
 "sourceSemanticParityVerified":False,
 "hindsightY06Resolved":False,
 "economicParityVerified":False,
 "strategyReadyForAdmission":False,
 "orders":0,"fills":0,"note":"An old pinned research SHA or a GitHub master SHA does not identify the currently loaded V4 process on VPS. Current LIVE pin, Y06 causal validity and integrated trade admission remain blocked."
}
out=REPO/"reports/bt-verification/BT_PR481_I2_RESEARCH_VS_MASTER_PIN_20261116.json"
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(report,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
assert all(r["isProductionParity"] is False for r in rows)
assert report["currentLiveRunnerShaVerified"] is False and report["orders"]==0
print("PASS V4 Git-only source comparison old vs master",len(rows),
      "changed",len(changed))
for r in rows:print(r["kind"],r["path"],r["oldSha256"][:10],str(r["masterSha256"])[:10])
