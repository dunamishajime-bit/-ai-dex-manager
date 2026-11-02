#!/usr/bin/env python3
"""Fail-closed FULL_PROJECT order-enable executor.

Only root-owned operator-activation JSON artifacts are mutated. This helper
never sends/cancels/replaces/closes/tests orders, changes STOPs or Kill Switch,
or restarts runners. The global artifact is the final commit point.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
SCRIPT_DIR=Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0,str(SCRIPT_DIR))
from disdex_owner_approval import verify

REPO="dunamishajime-bit/-ai-dex-manager"
DEPLOYMENT_TARGET="professional-dismanager.net"
OPERATOR_TARGET="DD1296_FINAL_ALLIN_10BPS"
OPERATION="ALL_RUNNERS_ORDER_ENABLE"
SCOPE="FULL_PROJECT"
ACK="I_ACK_REAL_MONEY_LIVE_ACTIVATION"
MAIN="7688ed7c93a1918d8b44837339b7da5584a868f5"
PLAN_DEFAULT=Path("/usr/local/lib/disdex-allrunner-order-enable/order-enable-plan.json")
SOURCE_SHA_FILE=Path("/usr/local/lib/disdex-allrunner-order-enable/source-sha")
PUBLIC_KEY=Path("/var/lib/unified-deploy/owner-approval-public.pem")
NONCE_DIR=Path("/var/lib/unified-deploy/nonces")
PINS=Path("/etc/disdex/runner-pins.json")
CURRENT=Path("/home/deploy/disdex-trading/current")
RELEASES=Path("/home/deploy/disdex-trading/releases")
RUNTIME_ENV_ROOT=Path("/etc/disdex/current-runtime")
KILL=Path("/var/lib/disdex/shared/kill-switch.json")
RISK=Path("/var/lib/disdex/shared/crypto-daily-risk.json")
MARGIN=Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING=Path("/var/lib/disdex/shared/pending-exposure.json")
FINAL_VERIFY=Path("/usr/local/lib/disdex-allrunner-order-enable/disdex_allrunner_final_verify.py")
WRAPPER=Path("/usr/local/sbin/disdex-allrunner-order-enable")
SHA_RE=re.compile(r"^[0-9a-f]{40}$")
PLAN_RE=re.compile(r"^[0-9a-f]{64}$")
RUNNER_KEYS=("V12_V4","PENGU_V8","QUALITY102_CAUSAL_V1","V52","FET_BRK48_RESIDUAL","HYPE_TREND_LONG","IDLE_PRIORITY_SHORT")
ARTIFACT_ORDER=("v4","q102","v52","global")

def require(ok, reason):
    if not ok: raise ValueError(reason)

def plan_sha256(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load_plan(path: Path):
    value=json.loads(path.read_text(encoding="utf-8"))
    required={"schema","repository","deploymentTarget","operatorTarget","operation","scope","ordersEnabled",
              "runnerShaByRunner","runtimeTargets","activationPaths","activationPathsByRunner","grossCaps","acknowledgement"}
    require(isinstance(value,dict) and set(value)==required,"PLAN_FIELDS_INVALID")
    require(value["schema"]=="disdex-allrunner-order-enable-plan/v1","PLAN_SCHEMA_INVALID")
    require(value["repository"]==REPO and value["deploymentTarget"]==DEPLOYMENT_TARGET,"PLAN_TARGET_INVALID")
    require(value["operatorTarget"]==OPERATOR_TARGET and value["operation"]==OPERATION,"PLAN_OPERATION_INVALID")
    require(value["scope"]==SCOPE and value["ordersEnabled"] is True,"PLAN_PERMISSION_INVALID")
    require(value["acknowledgement"]==ACK,"PLAN_ACK_INVALID")
    mapping=value["runnerShaByRunner"]
    require(isinstance(mapping,dict) and tuple(mapping.keys())==RUNNER_KEYS,"PLAN_RUNNER_MAP_INVALID")
    require(all(isinstance(v,str) and SHA_RE.fullmatch(v) for v in mapping.values()),"PLAN_RUNNER_SHA_INVALID")
    targets=value["runtimeTargets"]
    require(isinstance(targets,dict) and set(targets)==set(RUNNER_KEYS),"PLAN_RUNTIME_TARGETS_INVALID")
    require(targets["V12_V4"]=="V12_V4_V2_M150_D05_CORE_NATIVE","PLAN_V4_TARGET_INVALID")
    for runner in RUNNER_KEYS[1:]:
        require(targets[runner]==OPERATOR_TARGET,"PLAN_RUNTIME_TARGET_INVALID:"+runner)
    require(value["grossCaps"]=={"crypto":3.0,"stock":1.5,"total":3.5,"sharedCryptoDailyLossPct":7.5},
            "PLAN_GROSS_CAPS_INVALID")
    paths=value["activationPaths"]; by=value["activationPathsByRunner"]
    require(set(paths)=={"global","v4","q102","v52"},"PLAN_ACTIVATION_PATHS_INVALID")
    require(isinstance(by,dict) and set(by)==set(RUNNER_KEYS),"PLAN_RUNNER_PATHS_INVALID")
    require(by["V12_V4"]==paths["v4"],"PLAN_V4_PATH_INVALID")
    require(by["QUALITY102_CAUSAL_V1"]==paths["q102"],"PLAN_Q102_PATH_INVALID")
    require(by["V52"]==paths["v52"],"PLAN_V52_PATH_INVALID")
    for runner in ("PENGU_V8","FET_BRK48_RESIDUAL","HYPE_TREND_LONG","IDLE_PRIORITY_SHORT"):
        require(by[runner]==paths["global"],"PLAN_GLOBAL_PATH_INVALID:"+runner)
    return value

def read_json(path: Path):
    require(path.is_file() and not path.is_symlink(),"STATE_INVALID:"+str(path))
    value=json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value,dict),"STATE_NOT_OBJECT:"+str(path))
    return value

def validate_pin_manifest(manifest, plan):
    require(manifest.get("schema")=="disdex-runner-pin-manifest/v2","PIN_SCHEMA_INVALID")
    require(manifest.get("target")==OPERATOR_TARGET,"PIN_TARGET_INVALID")
    runners=manifest.get("runners"); require(isinstance(runners,dict),"PIN_RUNNERS_INVALID")
    for runner,sha in plan["runnerShaByRunner"].items():
        entry=runners.get(runner); require(isinstance(entry,dict),"PIN_MISSING:"+runner)
        require(entry.get("sha")==sha,"PIN_SHA_MISMATCH:"+runner)
        require(entry.get("releaseRoot")=="/home/deploy/disdex-trading/releases/"+sha,"PIN_RELEASE_ROOT_MISMATCH:"+runner)
        unit=entry.get("serviceUnit")
        require(isinstance(unit,str) and sha in unit,"PIN_SERVICE_UNIT_MISMATCH:"+runner)
    return runners

def parse_env(path: Path):
    require(path.is_file() and not path.is_symlink(),"RUNTIME_ENV_INVALID")
    result={}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line=raw.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        key,value=line.split("=",1); result[key.strip()]=value.strip().strip('"').strip("'")
    return result

def validate_gross_and_daily_loss(plan):
    env=parse_env(RUNTIME_ENV_ROOT/(MAIN+".env"))
    expected={"CRYPTO_GROSS_CAP":plan["grossCaps"]["crypto"],"STOCK_GROSS_CAP":plan["grossCaps"]["stock"],
              "TOTAL_GROSS_CAP":plan["grossCaps"]["total"],
              "DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT":plan["grossCaps"]["sharedCryptoDailyLossPct"]}
    for key,want in expected.items():
        try: got=float(env[key])
        except (KeyError,ValueError): raise ValueError("GROSS_ENV_INVALID:"+key) from None
        require(abs(got-float(want))<1e-9,"GROSS_ENV_MISMATCH:"+key)

def validate_shared_safety():
    require(os.path.realpath(CURRENT)==str(RELEASES/MAIN),"CURRENT_SHA_MISMATCH")
    require(read_json(KILL).get("active") is False,"KILL_SWITCH_ACTIVE")
    risk=read_json(RISK)
    require(risk.get("sourceComplete") is True and risk.get("tripped") is not True,"SHARED_RISK_BAD")
    limit=risk.get("dailyLossLimit",risk.get("maxDailyLossPct",risk.get("dailyLossLimitPct")))
    if limit is not None:
        x=float(limit); require(abs(x-0.075)<1e-9 or abs(x-7.5)<1e-9,"SHARED_RISK_LIMIT_MISMATCH")
    margin=read_json(MARGIN)
    require(margin.get("stage")=="HEALTHY" and margin.get("ordersAllowed") is True,"MARGIN_BAD")
    entries=read_json(PENDING).get("entries"); require(isinstance(entries,list),"PENDING_INVALID")
    require(not any(isinstance(e,dict) and str(e.get("status","")).upper()!="RELEASED" for e in entries),"PENDING_ACTIVE")

def systemctl(*args):
    p=subprocess.run(["systemctl",*args],capture_output=True,text=True,timeout=30)
    require(p.returncode==0,"SYSTEMD_FAILED:"+":".join(args)); return p.stdout

def service_wiring(runners):
    # systemctl show returns the effective ExecStartPre after drop-in resets,
    # unlike systemctl cat which also includes superseded base-unit commands.
    return {r:systemctl("show",runners[r]["serviceUnit"],"--property=ExecStartPre","--value") for r in RUNNER_KEYS}

def validate_activation_wiring(unit_text_by_runner, plan):
    expected=plan["activationPathsByRunner"]; global_path=plan["activationPaths"]["global"]
    for runner in RUNNER_KEYS:
        text=unit_text_by_runner.get(runner,"")
        require(expected[runner] in text,"ACTIVATION_PATH_MISMATCH:"+runner)
        if runner in ("QUALITY102_CAUSAL_V1","V52","V12_V4") and expected[runner]!=global_path:
            require(global_path not in text,"ACTIVATION_PATH_NOT_SCOPED:"+runner)

def validate_services(runners):
    for runner in RUNNER_KEYS:
        unit=runners[runner]["serviceUnit"]
        require(systemctl("show",unit,"--property=ActiveState","--value").strip()=="active","RUNNER_NOT_ACTIVE:"+runner)
        require(systemctl("show",unit,"--property=SubState","--value").strip()=="running","RUNNER_NOT_RUNNING:"+runner)
        pid=int(systemctl("show",unit,"--property=MainPID","--value").strip() or "0")
        require(pid>100,"RUNNER_PID_INVALID:"+runner)
        require(os.path.realpath("/proc/"+str(pid)+"/cwd")==runners[runner]["releaseRoot"],"RUNNER_CWD_MISMATCH:"+runner)

def validate_release_markers(plan):
    for sha in set(plan["runnerShaByRunner"].values()):
        marker=RELEASES/sha/".disdex-release-sha"
        require(marker.is_file() and not marker.is_symlink(),"RELEASE_MISSING:"+sha)
        require(marker.read_text(encoding="utf-8").strip()==sha,"RELEASE_MARKER_MISMATCH:"+sha)

def base_artifact(plan,approved_at,approved_sha,target,approved_runners):
    return {"schema":"disdex-live-operator-activation/v1","activationClass":"FULL_LIVE","target":target,
            "approvedSha":approved_sha,"approvedShaByRunner":dict(plan["runnerShaByRunner"]),
            "approvedRunners":approved_runners,"ordersEnabled":True,
            "operatorAcknowledgement":ACK,"approvedAt":approved_at}

def build_activation_artifacts(plan, approved_at):
    m=plan["runnerShaByRunner"]; t=plan["runtimeTargets"]
    g=base_artifact(plan,approved_at,m["PENGU_V8"],OPERATOR_TARGET,
                    ["PENGU_V8","QUALITY102_CAUSAL_V1","V52","FET_BRK48_RESIDUAL","HYPE_TREND_LONG","IDLE_PRIORITY_SHORT"])
    g["fetCorePreemptionReady"]=True
    v4=base_artifact(plan,approved_at,m["V12_V4"],t["V12_V4"],["V12_V4"])
    q=base_artifact(plan,approved_at,m["QUALITY102_CAUSAL_V1"],t["QUALITY102_CAUSAL_V1"],["QUALITY102_CAUSAL_V1"])
    v52=base_artifact(plan,approved_at,m["V52"],t["V52"],["V52","FET_BRK48_RESIDUAL"]); v52["fetCorePreemptionReady"]=True
    return {"global":g,"v4":v4,"q102":q,"v52":v52}

def atomic_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    require(not path.is_symlink(),"ACTIVATION_SYMLINK:"+str(path))
    fd,tmp=tempfile.mkstemp(prefix=path.name+".",dir=str(path.parent))
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            json.dump(value,f,sort_keys=True,separators=(",",":")); f.write("\n"); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp,0o600); os.replace(tmp,path)
    finally:
        try: os.unlink(tmp)
        except FileNotFoundError: pass

def publish_activation_transaction(paths, artifacts, writer=atomic_json, post_validate=None):
    existed={n:p.exists() for n,p in paths.items()}
    backups={n:(p.read_bytes() if p.exists() else b"") for n,p in paths.items()}
    try:
        for name in ARTIFACT_ORDER:
            writer(paths[name],artifacts[name])
        if post_validate is not None:
            post_validate()
    except Exception:
        for name,path in paths.items():
            if existed[name]:
                path.parent.mkdir(parents=True,exist_ok=True)
                fd,tmp=tempfile.mkstemp(prefix=path.name+".rollback.",dir=str(path.parent))
                try:
                    with os.fdopen(fd,"wb") as f:
                        f.write(backups[name]); f.flush(); os.fsync(f.fileno())
                    os.chmod(tmp,0o600); os.replace(tmp,path)
                finally:
                    try: os.unlink(tmp)
                    except FileNotFoundError: pass
            else:
                try: path.unlink()
                except FileNotFoundError: pass
        raise

def validate_with_release_gates(plan, paths):
    mapping={"V12_V4":"v4","PENGU_V8":"global","QUALITY102_CAUSAL_V1":"q102","V52":"v52",
             "FET_BRK48_RESIDUAL":"global","HYPE_TREND_LONG":"global","IDLE_PRIORITY_SHORT":"global"}
    for runner,name in mapping.items():
        sha=plan["runnerShaByRunner"][runner]
        gate=RELEASES/sha/"scripts/ops/root/disdex-live-operator-activation-gate.mjs"
        require(gate.is_file(),"RELEASE_GATE_MISSING:"+runner)
        p=subprocess.run(["/usr/bin/node",str(gate),"--release-root",str(RELEASES/sha),"--sha",sha,
                          "--runner",runner,"--activation-path",str(paths[name])],
                         capture_output=True,text=True,timeout=30)
        require(p.returncode==0,"ACTIVATION_GATE_REJECTED:"+runner+":"+p.stderr[-160:])

def run_final_readonly_audit():
    require(FINAL_VERIFY.is_file() and not FINAL_VERIFY.is_symlink(),"FINAL_VERIFY_MISSING")
    p=subprocess.run(["/usr/bin/python3",str(FINAL_VERIFY),"--step","FINAL_ALL_RUNNERS_AUDIT"],
                     capture_output=True,text=True,timeout=180)
    require(p.returncode==0 and "READ_ONLY_FINAL_AUDIT=PASS" in p.stdout,"FINAL_ALL_RUNNERS_AUDIT_FAILED")

def assert_root_private(path, directory=False):
    st=path.lstat()
    require((path.is_dir() if directory else path.is_file()) and not path.is_symlink(),"ROOT_PATH_INVALID:"+str(path))
    require(st.st_uid==0 and st.st_mode & 0o022==0,"ROOT_PATH_PERMISSIONS_INVALID:"+str(path))

def validate_root_owned_executor_installation(plan_path):
    for path in (
        Path(__file__).resolve(),
        SCRIPT_DIR/"disdex_owner_approval.py",
        SCRIPT_DIR/"disdex_deployment_contract.py",
        FINAL_VERIFY,
        WRAPPER,
        plan_path,
        SOURCE_SHA_FILE,
    ):
        assert_root_private(path)

def consume_owner_approval(token,source_sha,plan_hash,owner,consume):
    require(SHA_RE.fullmatch(source_sha) is not None,"SOURCE_SHA_INVALID")
    require(PLAN_RE.fullmatch(plan_hash) is not None,"PLAN_SHA_INVALID")
    assert_root_private(PUBLIC_KEY); assert_root_private(NONCE_DIR,directory=True)
    return verify(token,PUBLIC_KEY,REPO,source_sha,SCOPE,owner,plan_hash,
                  nonce_dir=NONCE_DIR if consume else None,route="GITHUB_ACTIONS",
                  deployment_target=DEPLOYMENT_TARGET,operator_target=OPERATOR_TARGET,orders_enabled=True)

def preflight(plan_path,source_sha,plan_hash,owner,token):
    require(os.geteuid()==0,"ROOT_REQUIRED")
    validate_root_owned_executor_installation(plan_path)
    require(SOURCE_SHA_FILE.read_text(encoding="ascii").strip()==source_sha,"INSTALLED_SOURCE_SHA_MISMATCH")
    require(plan_sha256(plan_path)==plan_hash,"PLAN_SHA_MISMATCH")
    plan=load_plan(plan_path); runners=validate_pin_manifest(read_json(PINS),plan)
    validate_release_markers(plan); validate_gross_and_daily_loss(plan); validate_shared_safety()
    validate_services(runners); validate_activation_wiring(service_wiring(runners),plan)
    run_final_readonly_audit(); consume_owner_approval(token,source_sha,plan_hash,owner,False)
    return plan

def execute(plan_path,source_sha,plan_hash,owner,token):
    plan=preflight(plan_path,source_sha,plan_hash,owner,token)
    stamp=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")
    artifacts=build_activation_artifacts(plan,stamp)
    live={n:Path(v) for n,v in plan["activationPaths"].items()}
    stage=Path("/var/lib/unified-deploy/order-enable-stage")/source_sha
    stage.mkdir(parents=True,exist_ok=True,mode=0o700)
    staged={n:stage/(n+".json") for n in ARTIFACT_ORDER}
    for n in ARTIFACT_ORDER: atomic_json(staged[n],artifacts[n])
    validate_with_release_gates(plan,staged)
    consume_owner_approval(token,source_sha,plan_hash,owner,True)
    publish_activation_transaction(
        live, artifacts,
        post_validate=lambda: validate_with_release_gates(plan,live),
    )
    return {"status":"ORDER_ENABLE_ACTIVATION_PUBLISHED","sourceSha":source_sha,"planSha256":plan_hash,
            "ordersEnabled":True,"ordersSent":0,"cancelsSent":0,"positionChangesSent":0}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source-sha",required=True); p.add_argument("--plan-sha256",required=True)
    p.add_argument("--owner",required=True); p.add_argument("--plan",default=str(PLAN_DEFAULT))
    p.add_argument("--read-approval-stdin",action="store_true",required=True)
    mode=p.add_mutually_exclusive_group(required=True); mode.add_argument("--preflight-readonly",action="store_true"); mode.add_argument("--execute",action="store_true")
    a=p.parse_args(); token=sys.stdin.read().strip()
    require(token and len(token)<=16384,"APPROVAL_TOKEN_INVALID")
    try:
        result=execute(Path(a.plan),a.source_sha,a.plan_sha256,a.owner,token) if a.execute else (
            preflight(Path(a.plan),a.source_sha,a.plan_sha256,a.owner,token) and
            {"status":"ORDER_ENABLE_PREFLIGHT_PASS_NOT_LIVE","ordersEnabled":False})
        print(json.dumps(result,sort_keys=True)); return 0
    except Exception as e:
        print("ALLRUNNER_ORDER_ENABLE_BLOCKED:"+type(e).__name__+":"+str(e)[:300],file=sys.stderr); return 1

if __name__=="__main__": raise SystemExit(main())
