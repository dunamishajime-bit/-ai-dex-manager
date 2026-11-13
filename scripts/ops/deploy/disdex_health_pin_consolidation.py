#!/usr/bin/env python3
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, time

MONITOR_SHA="c5e9da24faf960050a6bc0785b45f60fb8d3115d"
PINS=pathlib.Path("/etc/disdex/runner-pins.json")
PLAN=pathlib.Path("/var/lib/disdex/unified-deploy/current-plan.json")
HEALTH=pathlib.Path("/var/lib/disdex/runner-health/current.json")
ENV=pathlib.Path("/etc/disdex/current-runtime")/(MONITOR_SHA+"-consolidated-health.env")
DROPIN=pathlib.Path("/etc/systemd/system/disdex-runner-health-snapshot.service.d/~~~~disdex-consolidated-"+MONITOR_SHA[:12]+".conf")
RELEASE=pathlib.Path("/home/deploy/disdex-trading/releases")/MONITOR_SHA
SERVICE="disdex-runner-health-snapshot.service"
PREFIX={
 "V12_V4":"V12","PENGU_V8":"PENGU","QUALITY102_CAUSAL_V1":"Q102","V52":"V52",
 "FET_BRK48_RESIDUAL":"FET","HYPE_TREND_LONG":"HYPE","IDLE_PRIORITY_SHORT":"IDLE"
}
DEFAULT_STATE={
 "V12_V4":"/var/lib/disdex/v12-v4/heartbeat.json",
 "PENGU_V8":"/var/lib/disdex/pengu-dual-ls-v2/runner-live.json",
 "QUALITY102_CAUSAL_V1":"/var/lib/disdex/quality102-causal-v1/state.json",
 "V52":"/var/lib/disdex/v52-aster-only/runner-live.json",
 "FET_BRK48_RESIDUAL":"/var/lib/disdex/fet-brk48-residual/state.json",
 "HYPE_TREND_LONG":"/var/lib/disdex/hype-zec-long/runner.json",
 "IDLE_PRIORITY_SHORT":"/var/lib/disdex/idle-priority/state.json",
 "SHARED_CRYPTO_RISK":"/var/lib/disdex/shared/crypto-daily-risk.json",
 "MARGIN_GUARD":"/var/lib/disdex/shared/margin-risk/guard-live.json",
}
def die(x): raise RuntimeError(x)
def load(p): return json.loads(p.read_text())
def sh(*args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=60)
    if p.returncode: die("COMMAND_FAILED:"+":".join(args)+":"+p.stderr.strip()[-600:])
    return p.stdout
def valid_sha(x): return bool(re.fullmatch(r"[0-9a-f]{40}",str(x)))
def validate():
    pins=load(PINS); plan=load(PLAN)
    if pins.get("schema") not in ("disdex-runner-pin-manifest/v1","disdex-runner-pin-manifest/v2"): die("PIN_SCHEMA")
    if pins.get("target")!="professional-dismanager.net": die("PIN_TARGET")
    if plan.get("monitorSha")!=MONITOR_SHA: die("MONITOR_SHA_CHANGED")
    m={k:v["sha"] for k,v in pins["runners"].items()}
    if plan.get("runners")!=m: die("PLAN_PIN_MAP_MISMATCH")
    for k,v in pins["runners"].items():
        sha=v.get("sha"); root=v.get("releaseRoot"); unit=v.get("serviceUnit")
        if not valid_sha(sha) or root!="/home/deploy/disdex-trading/releases/"+sha or ("@"+sha+".service") not in unit:
            die("PIN_INVALID:"+k)
    marker=(RELEASE/".disdex-release-sha").read_text().strip()
    if marker!=MONITOR_SHA: die("MONITOR_RELEASE_MARKER")
    if not (RELEASE/"scripts/ops/root/disdex-runner-health-snapshot-current.mjs").is_file(): die("MONITOR_SCRIPT_MISSING")
    return pins,plan
def render(pins):
    r=pins["runners"]; v4=r["V12_V4"]
    rows=[
      "DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA="+v4["sha"],
      "DISDEX_HEALTH_SNAPSHOT_RELEASE_ROOT="+v4["releaseRoot"],
      "DISDEX_HEALTH_SNAPSHOT_V12_EXPECTED_SHA="+v4["sha"],
      "DISDEX_HEALTH_SNAPSHOT_V12_RELEASE_ROOT="+v4["releaseRoot"],
      "DISDEX_HEALTH_SNAPSHOT_V12_MODE=V4",
    ]
    for k,s in PREFIX.items():
        p=r[k]
        rows += [
          f"DISDEX_HEALTH_SNAPSHOT_{s}_EXPECTED_SHA={p['sha']}",
          f"DISDEX_HEALTH_SNAPSHOT_{s}_RELEASE_ROOT={p['releaseRoot']}",
        ]
    for k,s in PREFIX.items():
        rows.append(f"DISDEX_HEALTH_SNAPSHOT_{s}_STATE_PATH={r[k].get('statePath') or DEFAULT_STATE[k]}")
    sr=r["SHARED_CRYPTO_RISK"]; mg=r["MARGIN_GUARD"]
    rows += [
      "DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_STATE_PATH="+(sr.get("statePath") or DEFAULT_STATE["SHARED_CRYPTO_RISK"]),
      "DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_SERVICE_UNIT="+sr["serviceUnit"],
      "DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_RELEASE_ROOT="+sr["releaseRoot"],
      "DISDEX_HEALTH_SNAPSHOT_MARGIN_STATE_PATH="+(mg.get("statePath") or DEFAULT_STATE["MARGIN_GUARD"]),
      "DISDEX_HEALTH_SNAPSHOT_MARGIN_SERVICE_UNIT="+mg["serviceUnit"],
      "DISDEX_HEALTH_SNAPSHOT_MARGIN_RELEASE_ROOT="+mg["releaseRoot"],
      "DISDEX_HEALTH_SNAPSHOT_DEPLOYMENT_TARGET=professional-dismanager.net",
      "DISDEX_HEALTH_SNAPSHOT_OPERATOR_TARGET=DD1296_FINAL_ALLIN_10BPS",
      "DISDEX_HEALTH_SNAPSHOT_CANONICAL_PATH=/var/lib/disdex/runner-health/current.json",
    ]
    return ("\n".join(rows)+"\n").encode()
def dropin():
    root=str(RELEASE); script=root+"/scripts/ops/root/disdex-runner-health-snapshot-current.mjs"
    return (f"""[Service]
EnvironmentFile=
EnvironmentFile={ENV}
WorkingDirectory={root}
ExecStartPre=
ExecStartPre=/usr/bin/test -f {root}/.disdex-release-sha
ExecStartPre=/usr/bin/grep -Fxq {MONITOR_SHA} {root}/.disdex-release-sha
ExecStart=
ExecStart=/usr/bin/node {script}
ReadWritePaths=/var/lib/disdex/runner-health
ReadOnlyPaths=/var/lib/disdex/runner-health/ticks
""").encode()
def digest(b): return hashlib.sha256(b).hexdigest()
def atomic(p,b,mode):
    p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_name(p.name+".tmp-"+str(os.getpid()))
    with open(tmp,"wb") as f: f.write(b); f.flush(); os.fsync(f.fileno())
    os.chmod(tmp,mode); os.chown(tmp,0,0); os.replace(tmp,p)
def verify_health(pins):
    row=load(HEALTH)
    expected=pins["runners"]
    for k in PREFIX:
        got=row.get("runnerPins",{}).get(k) or {}
        p=expected[k]
        if got.get("expectedSha")!=p["sha"] or got.get("serviceUnit")!=p["serviceUnit"] or got.get("releaseRoot")!=p["releaseRoot"]:
            die("HEALTH_PIN_MISMATCH:"+k+":"+json.dumps(got,sort_keys=True))
    eff=row.get("tradingEffects",{})
    if any(int(eff.get(k,0))!=0 for k in ("ordersSent","cancelSent","positionChangesSent")): die("TRADING_EFFECT")
    return row
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--apply",action="store_true"); ap.add_argument("--verify",action="store_true"); a=ap.parse_args()
    pins,plan=validate(); eb=render(pins); db=dropin()
    out={"status":"HEALTH_PIN_CONSOLIDATION_PREFLIGHT_PASS","monitorSha":MONITOR_SHA,
         "envPath":str(ENV),"dropinPath":str(DROPIN),"envSha256":digest(eb),"dropinSha256":digest(db),
         "ordersSent":0,"cancelsSent":0,"positionChangesSent":0}
    if a.verify:
        row=verify_health(pins)
        print(json.dumps({"status":"HEALTH_PIN_CONSOLIDATION_VERIFY_PASS",
            "generatedAt":row.get("generatedAt"),"overallSafetyState":row.get("overallSafetyState"),
            "enabledRunnerBlocks":row.get("enabledRunnerBlocks"),"ordersSent":0,"cancelsSent":0,
            "positionChangesSent":0},sort_keys=True))
        return
    if not a.apply:
        print(json.dumps(out,sort_keys=True)); return
    stamp=str(int(time.time()))
    backup=pathlib.Path("/root/disdex-recovery-20261112")/("health-pin-consolidation-"+stamp)
    backup.mkdir(parents=True,mode=0o700,exist_ok=False)
    for p in (PINS,PLAN,HEALTH):
        if p.exists(): shutil.copy2(p,backup/p.name)
    props=sh("/usr/bin/systemctl","show",SERVICE,"--property=EnvironmentFiles,DropInPaths,ExecStart,WorkingDirectory","--no-pager")
    (backup/"systemd-before.txt").write_text(props)
    if ENV.exists(): shutil.copy2(ENV,backup/(ENV.name+".before"))
    if DROPIN.exists(): shutil.copy2(DROPIN,backup/(DROPIN.name+".before"))
    atomic(ENV,eb,0o600); atomic(DROPIN,db,0o644)
    sh("/usr/bin/systemctl","daemon-reload")
    sh("/usr/bin/systemctl","start",SERVICE)
    row=verify_health(pins)
    after=sh("/usr/bin/systemctl","show",SERVICE,"--property=EnvironmentFiles,DropInPaths,ExecStart,WorkingDirectory,Result","--no-pager")
    if ("EnvironmentFiles="+str(ENV)) not in after or "Result=success" not in after: die("SYSTEMD_POSTFLIGHT")
    out.update(status="HEALTH_PIN_CONSOLIDATION_APPLIED",backup=str(backup),generatedAt=row.get("generatedAt"),
               overallSafetyState=row.get("overallSafetyState"),enabledRunnerBlocks=row.get("enabledRunnerBlocks"))
    print(json.dumps(out,sort_keys=True))
if __name__=="__main__": main()
