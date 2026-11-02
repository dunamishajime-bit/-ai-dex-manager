#!/usr/bin/env python3
from __future__ import annotations
import argparse, io, json, os, shutil, subprocess, tarfile
from pathlib import Path

BASE_SHA="53a0be396719f0284af4e11b35c66a4ac7d58f79"
MANIFEST=Path("deploy/v4-staged-overlay/manifest.json")

def run(cmd, cwd: Path, **kw):
    return subprocess.run(cmd,cwd=cwd,check=True,**kw)

def safe_target(root: Path, rel: str) -> Path:
    if not rel or rel.startswith(("/", "\\")) or ".." in Path(rel).parts:
        raise ValueError("V4_OVERLAY_TARGET_UNSAFE:"+rel)
    out=(root/rel).resolve()
    if root.resolve() not in out.parents:
        raise ValueError("V4_OVERLAY_TARGET_ESCAPE:"+rel)
    return out

def load_manifest(repo: Path):
    value=json.loads((repo/MANIFEST).read_text(encoding="utf-8"))
    if value.get("schema")!="disdex-v4-staged-overlay/v1" or value.get("baseSha")!=BASE_SHA:
        raise ValueError("V4_OVERLAY_MANIFEST_INVALID")
    rows=value.get("files")
    if not isinstance(rows,list) or not rows: raise ValueError("V4_OVERLAY_FILES_INVALID")
    targets=set()
    for row in rows:
        if not isinstance(row,dict): raise ValueError("V4_OVERLAY_ROW_INVALID")
        source=str(row.get("source","")); target=str(row.get("target",""))
        if not source.endswith(".src"): raise ValueError("V4_OVERLAY_SOURCE_SUFFIX_INVALID:"+source)
        if target in targets: raise ValueError("V4_OVERLAY_TARGET_DUPLICATE:"+target)
        targets.add(target)
        src=(repo/"deploy/v4-staged-overlay"/source).resolve()
        if not src.is_file(): raise ValueError("V4_OVERLAY_SOURCE_MISSING:"+source)
        if (repo/"deploy/v4-staged-overlay").resolve() not in src.parents:
            raise ValueError("V4_OVERLAY_SOURCE_ESCAPE:"+source)
    return value

def archive_base(repo: Path, output: Path):
    probe=subprocess.run(["git","cat-file","-e",BASE_SHA+"^{commit}"],cwd=repo)
    if probe.returncode: raise RuntimeError("V4_BASE_COMMIT_MISSING")
    raw=subprocess.check_output(["git","archive","--format=tar",BASE_SHA],cwd=repo)
    with tarfile.open(fileobj=io.BytesIO(raw),mode="r:") as tf:
        for member in tf.getmembers():
            if member.issym() or member.islnk():
                raise RuntimeError("V4_BASE_ARCHIVE_LINK_NOT_ALLOWED:"+member.name)
            safe_target(output,member.name)
        tf.extractall(output,filter="data")

def build(repo: Path, output: Path, candidate_sha: str):
    if not __import__("re").fullmatch(r"[0-9a-f]{40}",candidate_sha):
        raise ValueError("V4_CANDIDATE_SHA_INVALID")
    manifest=load_manifest(repo)
    # Refuse existing paths: this tool must never recursively delete an
    # operator's directory while preparing a candidate release.
    output.mkdir(parents=True,mode=0o750,exist_ok=False)
    archive_base(repo,output)
    applied=[]
    for row in manifest["files"]:
        src=(repo/"deploy/v4-staged-overlay"/row["source"]).resolve()
        dst=safe_target(output,row["target"])
        dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(src,dst)
        applied.append(row["target"])
    evidence={"schema":"disdex-v4-staged-release/v1","candidateSha":candidate_sha,
      "economicBaselineSha":BASE_SHA,"overlayTargets":applied,"productionRelease":False}
    (output/".disdex-v4-staged-release.json").write_text(json.dumps(evidence,indent=2)+"\n",encoding="utf-8",newline="\n")
    return evidence

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--repo",default=".")
    ap.add_argument("--output",required=True)
    ap.add_argument("--candidate-sha",required=True)
    args=ap.parse_args()
    repo=Path(args.repo).resolve(); output=Path(args.output).resolve()
    if repo in output.parents or output==repo: raise SystemExit("V4_OUTPUT_MUST_BE_OUTSIDE_REPO")
    result=build(repo,output,args.candidate_sha.lower())
    print(json.dumps({"status":"V4_STAGED_OVERLAY_PREVIEW_READY_NOT_RELEASE",**result}))

if __name__=="__main__": main()
