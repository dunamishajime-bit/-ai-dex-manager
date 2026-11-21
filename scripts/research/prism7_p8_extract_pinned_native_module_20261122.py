#!/usr/bin/env python3
"""Read immutable pinned git blobs into isolated research adapter (not repo worktree).

Transforms ONLY TS module import specifiers to relative extensionful paths and
JSON import assertions for Node24 native type stripping. Records original
pinned source blob SHA and raw/adapter SHA256. Never writes to production repo.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import posixpath
import re
import subprocess
from pathlib import Path

PIN="1657e173d250ad58f53e62f7bb0a3428fb405496"
ALLOW=(
"lib/pengu-dual-ls-v2.ts",
"lib/pengu-short-v20.ts",
"lib/pengu-recovery-v8.ts",
"lib/disdex-v35-signal-engine.ts",
"lib/disdex-resilient-profit-main-v35.ts",
"config/penguDualLsV2Runtime.ts",
"config/penguRecoveryV8.ts",
"config/sharedCryptoRiskPolicy.ts",
"config/integratedProductionRiskPolicy.ts",
"config/q102FamilySideGross.json",
"config/v52V50Runtime.json",
)
IMPORT_RE=re.compile(r'(\bfrom\s+)(["\'])([^"\']+)\2')

def git(repo,*args):
    result=subprocess.run(["git","-C",str(repo),*args],capture_output=True)
    if result.returncode:
        raise RuntimeError(f"PINNED_GIT_FAILED:{args}:{result.stderr[:170]!r}")
    return result.stdout


def adapter(path,source):
    """Rewrites specifier only, preserves all non-import business text."""
    edits=[]
    def substitute(m):
        old=m.group(3)
        if old.startswith("@/"):
            dest=old[2:]
            if not dest.endswith((".ts",".json")):dest+=".ts"
            relative=posixpath.relpath(dest,posixpath.dirname(path))
            if not relative.startswith("."):relative="./"+relative
        elif old.startswith("."):
            dest=posixpath.normpath(posixpath.join(posixpath.dirname(path),old))
            if not dest.endswith((".ts",".json")):dest+=".ts"
            relative=posixpath.relpath(dest,posixpath.dirname(path))
            if not relative.startswith("."):relative="./"+relative
        else:
            raise ValueError(f"UNAPPROVED_EXTERNAL_IMPORT:{path}:{old}")
        if dest not in ALLOW:
            raise ValueError(f"IMPORT_OUTSIDE_PIN_ALLOWLIST:{path}:{dest}")
        edits.append({"original":old,"converted":relative})
        return m.group(1)+m.group(2)+relative+m.group(2)
    out=IMPORT_RE.sub(substitute,source)
    # JSON only in production config. Required by Node24 ESM.
    out=re.sub(r'(import\s+\w+\s+from\s+["\'][^"\']+\.json["\'])\s*;',r'\1 with { type: "json" };',out)
    if IMPORT_RE.sub(lambda m:m.group(0),source)=="":
        raise ValueError("IMPOSSIBLE_EMPTY_SOURCE")
    return out,edits


def run(repo,output):
    if output.exists() and (output/"adapter"/"manifest.json").exists():
        raise ValueError("PIN_ADAPTER_ALREADY_EXISTS_REQUIRES_EXPLICIT_NEW_DEST")
    original=output/"original"
    target=output/"adapter"
    result={}
    for path in ALLOW:
        raw=git(repo,"show",PIN+":"+path)
        sha256=hashlib.sha256(raw).hexdigest()
        blob=git(repo,"rev-parse",PIN+":"+path).decode().strip()
        # git hash-object with standard Git blob framing for independent source blob identity.
        actual_blob=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
        if actual_blob!=blob:
            raise ValueError("PINNED_BLOB_SHA_NOT_EQUAL:"+path)
        name=Path(path)
        original_file=original/name
        actual_file=target/name
        original_file.parent.mkdir(parents=True,exist_ok=True)
        actual_file.parent.mkdir(parents=True,exist_ok=True)
        original_file.write_bytes(raw)
        if path.endswith(".ts"):
            decoded=raw.decode("utf-8")
            transformed,edits=adapter(path,decoded)
            encoded=transformed.encode("utf-8")
        else:
            encoded=raw
            edits=[]
        actual_file.write_bytes(encoded)
        result[path]={
            "pinned_git_blob_sha1":blob,
            "original_sha256":sha256,
            "adapted_sha256":hashlib.sha256(encoded).hexdigest(),
            "raw_bytes":len(raw),
            "adapter_bytes":len(encoded),
            "module_specifier_changes":edits,
            "economic_logic_changes":"NONE_IMPORT_PATHS_ONLY",
        }
    (target/"package.json").write_text('{"type":"module","private":true}\n',encoding="utf-8")
    report={
        "schema":"prism7-p8-pinned-source-import-only-adapter/v1",
        "pinned_commit":PIN,
        "source_repository_identity":"dunamishajime-bit/-ai-dex-manager",
        "files":result,
        "node_adapter_only":True,
        "limitations":[
          "Native TypeScript source was copied from immutable Git; current worktree not modified.",
          "Adapter import rewriting changes bytes but not economic logic.",
          "The adapter has to PASS source-native parity before any synthetic native claim.",
          "Source blob Git SHA-1 verified against Git object database independently.",
          "No actual venue fills or signed STOP reconstruction.",
        ],
    }
    (target/"manifest.json").write_text(
        json.dumps(report,indent=2,ensure_ascii=False,sort_keys=True)+"\n",encoding="utf-8")
    print("PINNED_NATIVE_EXTRACT_PASS",len(result),"files")
    print("PINNED_COMMIT",PIN)
    print("MANIFEST",target/"manifest.json")
    for path,value in result.items():
        print(path,value["pinned_git_blob_sha1"],
              "imports",len(value["module_specifier_changes"]))


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--repo",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    a=p.parse_args()
    if a.out.resolve()==a.repo.resolve() or str(a.out.resolve()).startswith(str(a.repo.resolve())):
        raise ValueError("REFUSE_WRITE_UNDER_PRODUCTION_WORKTREE")
    run(a.repo,a.out)

if __name__=="__main__":
    main()
