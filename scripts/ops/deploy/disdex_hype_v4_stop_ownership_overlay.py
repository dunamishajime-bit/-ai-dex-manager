#!/usr/bin/env python3
"""Apply a reversible HYPE-only source overlay for V12 V4 resident STOP ownership.

The immutable 7688 release is never edited. systemd BindReadOnlyPaths exposes
one patched TypeScript source only inside the HYPE service mount namespace.
Every other runner sees the original bytes. The patch adds the already-existing
findManagedV12V4ProtectiveOrders classifier to HYPE's managed-order set.

No test order, cancellation, position change, STOP change, Kill Switch update,
risk-limit change or strategy-parameter change is performed by this helper.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time

MAIN="7688ed7c93a1918d8b44837339b7da5584a868f5"
V4="53a0be396719f0284af4e11b35c66a4ac7d58f79"
V52="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
SOURCE_SHA256="e8639343f0d9314b9bb29f05dd4bd3cf6a35a66c3d90b6a9f2e1df95edb54e75"
STOP_ID="v12-v4-98ded39746ed3502a4d7b0e26ef9"

RELEASE=Path("/home/deploy/disdex-trading/releases")/MAIN
SOURCE=RELEASE/"lib/hype-zec-long-runner.ts"
OVERLAY_DIR=Path("/var/lib/disdex/hype-zec-long/runtime-overlays/v4-stop-ownership-v1")
OVERLAY=OVERLAY_DIR/"hype-zec-long-runner.ts"
SELFTEST=OVERLAY_DIR/"selftest.ts"
DROPIN_DIR=Path(f"/etc/systemd/system/disdex-hype-long@{MAIN}.service.d")
DROPIN=DROPIN_DIR/"zzzzzzzzzz-v4-stop-ownership-hotfix.conf"
BACKUP=Path("/var/backups/disdex-hype-v4-stop-overlay")
HYPE_UNIT=f"disdex-hype-long@{MAIN}.service"
V4_UNIT=f"disdex-v12-v4@{V4}.service"
IDLE_UNIT=f"disdex-idle-priority-short@{MAIN}.service"
V52_UNIT=f"disdex-v52-aster-only@{V52}.service"
MARGIN_UNIT=f"disdex-v12-v52-margin-guard@{MAIN}.service"
RISK_UNIT=f"disdex-shared-crypto-risk@{MAIN}.service"
PENGU_UNIT=f"disdex-pengu-dual-ls-v2@{MAIN}.service"
FET_UNIT=f"disdex-fet-brk48@{MAIN}.service"
Q102_UNIT="disdex-quality102-causal-v1@ef1ab178e26a7bf5bddb6473467765edba242e1d.service"
KILL=Path("/var/lib/disdex/shared/kill-switch.json")
RISK=Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN=Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING=Path("/var/lib/disdex/shared/pending-exposure.json")
ACTIVATION=Path("/var/lib/disdex/shared/operator-activation/current.json")

OLD_IMPORT='import { findManagedIdlePriorityShortProtectiveOrders, findManagedOrdinaryResidentStops, findManagedFetBrk48ProtectiveOrders, findManagedHypeZecProtectiveOrders, findManagedPenguRecoveryV8ProtectiveOrders, findManagedV12ProtectiveOrders } from "./disdex-managed-protective-orders";'
NEW_IMPORT='import { findManagedIdlePriorityShortProtectiveOrders, findManagedOrdinaryResidentStops, findManagedFetBrk48ProtectiveOrders, findManagedHypeZecProtectiveOrders, findManagedPenguRecoveryV8ProtectiveOrders, findManagedV12ProtectiveOrders, findManagedV12V4ProtectiveOrders } from "./disdex-managed-protective-orders";'
OLD_MANAGED='    ...findManagedV12ProtectiveOrders(openOrders, positions),'
NEW_MANAGED='    ...findManagedV12V4ProtectiveOrders(openOrders, positions),'
DROPIN_TEXT=f"""[Service]
# HYPE-only reversible source overlay; immutable release bytes stay unchanged.
BindReadOnlyPaths={OVERLAY}:{SOURCE}
"""
SELFTEST_TEXT=f'''import {{ unmanagedHypeZecOrders }} from "{SOURCE}";
const order:any={{symbol:"DOGEUSDT",clientOrderId:"{STOP_ID}",status:"NEW",
  side:"BUY",type:"STOP_MARKET",reduceOnly:true,quantity:226,executedQuantity:0,
  stopPrice:0.08000}};
const position:any={{symbol:"DOGEUSDT",quantity:-226,positionSide:"BOTH",
  entryPrice:0.08052,markPrice:0.07552,notionalUsd:-17.0,updatedAt:Date.now()}};
const unmanaged=unmanagedHypeZecOrders([order],[position]);
if(unmanaged.length!==0) throw new Error("HYPE_V4_STOP_STILL_UNMANAGED");
console.log("HYPE_V4_STOP_OWNERSHIP_SELFTEST=PASS");
'''


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise RuntimeError(reason)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    require(path.is_file() and not path.is_symlink(),"STATE_INVALID:"+str(path))
    value=json.loads(path.read_text())
    require(isinstance(value,dict),"STATE_NOT_OBJECT:"+str(path))
    return value


def prop(unit: str,key: str) -> str:
    p=subprocess.run(["systemctl","show",unit,f"--property={key}","--value"],
                     capture_output=True,text=True,timeout=15)
    require(p.returncode==0,"SYSTEMD_SHOW_FAILED:"+unit)
    return p.stdout.strip()


def active(unit: str) -> bool:
    return prop(unit,"ActiveState")=="active"


def shared_health() -> None:
    require(read_json(KILL).get("active") is False,"SHARED_KILL_SWITCH_ACTIVE")
    risk=read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is not True,
            "SHARED_RISK_NOT_HEALTHY")
    margin=read_json(MARGIN)
    require(margin.get("stage")=="HEALTHY" and margin.get("ordersAllowed") is True,
            "MARGIN_GUARD_NOT_HEALTHY")
    checked=margin.get("checkedAt")
    now=int(time.time()*1000)
    require(type(checked) in (int,float) and -1000 <= now-checked <= 15*60_000,
            "MARGIN_GUARD_STALE")
    pending=read_json(PENDING)
    entries=pending.get("entries")
    require(isinstance(entries,list),"PENDING_EXPOSURE_INVALID")
    require(not any(isinstance(e,dict) and str(e.get("status","")).upper()!="RELEASED"
                    for e in entries),"PENDING_EXPOSURE_ACTIVE")
    for unit in (V4_UNIT,IDLE_UNIT,V52_UNIT,MARGIN_UNIT,RISK_UNIT,PENGU_UNIT,FET_UNIT,Q102_UNIT,HYPE_UNIT):
        require(active(unit),"REQUIRED_LIVE_UNIT_NOT_ACTIVE:"+unit)
    activation=read_json(ACTIVATION)
    require(activation.get("approvedSha")==MAIN
            and activation.get("ordersEnabled") is True
            and "HYPE_TREND_LONG" in (activation.get("approvedRunners") or [])
            and activation.get("operatorAcknowledgement")=="I_ACK_REAL_MONEY_LIVE_ACTIVATION",
            "HYPE_OPERATOR_ACTIVATION_NOT_READY")


def signed_get() -> dict:
    release=Path("/home/deploy/disdex-trading/releases")/V4
    command=(
      "set -ae; for f in "
      "/etc/disdex/disdex-v13d-v11eq-v96.env "
      "/etc/disdex/disdex-v12-pengu-v2-v52.env "
      "/etc/disdex/disdex-v12-v4.env; do . \"$f\"; done; set +a; "
      f"exec /usr/bin/node {release}/node_modules/tsx/dist/cli.mjs "
      "scripts/disdex-aster-readonly-account-diagnostic.ts"
    )
    p=subprocess.run(["/bin/bash","-c",command],cwd=release,
                     capture_output=True,text=True,timeout=55)
    require(p.returncode==0,"ASTER_SIGNED_GET_FAILED")
    rows=[line for line in p.stdout.splitlines() if line.startswith("{")]
    require(rows,"ASTER_SIGNED_GET_EMPTY")
    value=json.loads(rows[-1])
    require(value.get("status")=="ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
            "ASTER_SIGNED_GET_NOT_PASS")
    require(all(value.get(k)==0 for k in ("ordersSent","cancelsSent","positionChangesSent")),
            "DIAGNOSTIC_NOT_READ_ONLY")
    positions=value.get("positions") or []
    orders=value.get("openOrders") or []
    doge=[p for p in positions if p.get("symbol")=="DOGEUSDT"
          and float(p.get("positionAmt",0))==-226.0
          and float(p.get("entryPrice",0))==0.08052]
    stops=[o for o in orders if o.get("symbol")=="DOGEUSDT"
           and o.get("clientOrderId")==STOP_ID
           and o.get("side")=="BUY" and o.get("type")=="STOP_MARKET"
           and float(o.get("origQty",0))==226.0
           and float(o.get("executedQty",0))==0.0
           and o.get("reduceOnly") is True and o.get("status")=="NEW"]
    require(len(doge)==1 and len(stops)==1,"RESIDENT_DOGE_PROTECTION_MISSING")
    return {"observedAt":value.get("observedAt"),"positions":len(positions),"orders":len(orders)}


def patched_source() -> bytes:
    st=SOURCE.lstat()
    require(stat.S_ISREG(st.st_mode) and not SOURCE.is_symlink(),"HYPE_SOURCE_NOT_REGULAR")
    raw=SOURCE.read_bytes()
    require(sha256(raw)==SOURCE_SHA256,"HYPE_BASELINE_SOURCE_HASH_CHANGED")
    text=raw.decode("utf-8")
    require(text.count(OLD_IMPORT)==1,"HYPE_IMPORT_PATCH_ANCHOR_NOT_UNIQUE")
    require(text.count(OLD_MANAGED)==1,"HYPE_MANAGED_PATCH_ANCHOR_NOT_UNIQUE")
    require("findManagedV12V4ProtectiveOrders(openOrders, positions)" not in text,
            "HYPE_BASELINE_ALREADY_HAS_V4_CLASSIFIER")
    newline="\r\n" if "\r\n" in text else "\n"
    text=text.replace(OLD_IMPORT,NEW_IMPORT,1)
    text=text.replace(OLD_MANAGED,OLD_MANAGED+newline+NEW_MANAGED,1)
    require(text.count("findManagedV12V4ProtectiveOrders(openOrders, positions)")==1,
            "HYPE_PATCHED_CLASSIFIER_COUNT_INVALID")
    return text.encode("utf-8")


def atomic_file(path: Path,data: bytes,mode: int) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=str(path.parent),prefix="."+path.name+".")
    try:
        with os.fdopen(fd,"wb") as f:
            os.fchmod(f.fileno(),mode)
            f.write(data);f.flush();os.fsync(f.fileno())
        os.chown(tmp,0,0)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def wait_active(unit: str,seconds: int=75) -> int:
    deadline=time.monotonic()+seconds
    pid=0;stable=None
    while time.monotonic()<deadline:
        state=prop(unit,"ActiveState");current=int(prop(unit,"MainPID") or "0")
        if state=="active" and current>100:
            if current!=pid:
                pid=current;stable=time.monotonic()
            if stable is not None and time.monotonic()-stable>=25:
                return pid
        else:
            stable=None
        time.sleep(2)
    raise RuntimeError("HYPE_NOT_STABLE_25_SECONDS")


def namespace_hash(pid: int) -> str:
    p=subprocess.run(["nsenter","-t",str(pid),"-m","--","sha256sum",str(SOURCE)],
                     capture_output=True,text=True,timeout=20)
    require(p.returncode==0,"HYPE_NAMESPACE_HASH_FAILED")
    return p.stdout.split()[0]


def namespace_selftest(pid: int) -> None:
    p=subprocess.run(["nsenter","-t",str(pid),"-m","--",
                      str(RELEASE/"node_modules/.bin/tsx"),str(SELFTEST)],
                     capture_output=True,text=True,timeout=45)
    require(p.returncode==0 and "HYPE_V4_STOP_OWNERSHIP_SELFTEST=PASS" in p.stdout,
            "HYPE_NAMESPACE_CLASSIFIER_SELFTEST_FAILED:"+p.stderr[-160:])


def main(run_id: str) -> None:
    require(os.geteuid()==0,"ROOT_REQUIRED")
    require(run_id.isdecimal() and len(run_id)<21,"RUN_ID_INVALID")
    require((RELEASE/".disdex-release-sha").read_text().strip()==MAIN,
            "HYPE_RELEASE_SHA_INVALID")
    shared_health()
    before=signed_get()
    patch=patched_source()
    patch_hash=sha256(patch)
    overlay_preexisting=OVERLAY.exists()
    dropin_preexisting=DROPIN.exists()
    if overlay_preexisting:
        require(OVERLAY.is_file() and not OVERLAY.is_symlink()
                and OVERLAY.read_bytes()==patch,"EXISTING_HYPE_OVERLAY_MISMATCH")
    if dropin_preexisting:
        require(DROPIN.is_file() and not DROPIN.is_symlink()
                and DROPIN.read_text()==DROPIN_TEXT,"EXISTING_HYPE_DROPIN_MISMATCH")
    BACKUP.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chown(BACKUP,0,0);os.chmod(BACKUP,0o700)
    marker=BACKUP/f"before-{run_id}.json"
    require(not marker.exists(),"BACKUP_MARKER_EXISTS")
    marker.write_text(json.dumps({
        "overlayPreexisting":overlay_preexisting,
        "dropinPreexisting":dropin_preexisting,
        "baselineSha256":SOURCE_SHA256,
        "patchedSha256":patch_hash,
    },sort_keys=True)+"\n")
    os.chown(marker,0,0);os.chmod(marker,0o600)
    created_overlay=False;created_dropin=False
    try:
        if not overlay_preexisting:
            OVERLAY_DIR.mkdir(parents=True,exist_ok=True)
            os.chown(OVERLAY_DIR,0,0);os.chmod(OVERLAY_DIR,0o700)
            atomic_file(OVERLAY,patch,0o444)
            atomic_file(SELFTEST,SELFTEST_TEXT.encode(),0o444)
            created_overlay=True
        elif not SELFTEST.exists():
            atomic_file(SELFTEST,SELFTEST_TEXT.encode(),0o444)
        require(OVERLAY.read_bytes()==patch,"HYPE_OVERLAY_READBACK_MISMATCH")
        if not dropin_preexisting:
            DROPIN_DIR.mkdir(parents=True,exist_ok=True)
            os.chown(DROPIN_DIR,0,0);os.chmod(DROPIN_DIR,0o755)
            atomic_file(DROPIN,DROPIN_TEXT.encode(),0o644)
            created_dropin=True
        subprocess.run(["systemctl","daemon-reload"],check=True,timeout=30)
        subprocess.run(["systemctl","restart",HYPE_UNIT],check=True,timeout=120)
        pid=wait_active(HYPE_UNIT)
        require(namespace_hash(pid)==patch_hash,"HYPE_NAMESPACE_OVERLAY_HASH_MISMATCH")
        namespace_selftest(pid)
        shared_health()
        after=signed_get()
        require(active(HYPE_UNIT) and int(prop(HYPE_UNIT,"MainPID"))==pid,
                "HYPE_CHANGED_AFTER_POST_PROOF")
        print("HYPE_V4_STOP_OWNERSHIP_OVERLAY=ALREADY_APPLIED_VERIFIED" if dropin_preexisting
              else "HYPE_V4_STOP_OWNERSHIP_OVERLAY=SUCCESS")
        print("HYPE_OVERLAY_SHA256="+patch_hash)
        print("HYPE_NAMESPACE_CLASSIFIER_SELFTEST=PASS")
        print("ASTER_PRE_OBSERVED="+str(before["observedAt"]))
        print("ASTER_POST_OBSERVED="+str(after["observedAt"]))
        print("RESIDENT_DOGE_STOP_PRESERVED=TRUE")
        print("HELPER_ORDERS_SENT=0 HELPER_CANCELS_SENT=0 HELPER_STOP_CHANGES=0")
    except Exception:
        subprocess.run(["systemctl","stop",HYPE_UNIT],check=False,timeout=90)
        if created_dropin and DROPIN.exists() and not DROPIN.is_symlink():
            DROPIN.unlink()
        subprocess.run(["systemctl","daemon-reload"],check=False,timeout=30)
        subprocess.run(["systemctl","start",HYPE_UNIT],check=False,timeout=120)
        try: wait_active(HYPE_UNIT,55)
        except Exception: pass
        if created_overlay:
            try:
                if OVERLAY.exists():OVERLAY.unlink()
                if SELFTEST.exists():SELFTEST.unlink()
                OVERLAY_DIR.rmdir()
            except Exception:
                pass
        print("HYPE_V4_STOP_OWNERSHIP_OVERLAY=ROLLBACK",file=sys.stderr)
        raise


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--run-id",required=True)
    a=p.parse_args()
    try:
        main(a.run_id)
    except Exception as e:
        print("HYPE_OVERLAY_BLOCKED:"+type(e).__name__+":"+str(e)[:240],file=sys.stderr)
        raise
