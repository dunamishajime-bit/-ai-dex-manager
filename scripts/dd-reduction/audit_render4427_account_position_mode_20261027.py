#!/usr/bin/env python3
"""RENDER #4427: original TS account position-mode readback omission audit (research only)."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT = ROOT / "audit25-position-mode-pins"
REF = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
    "scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts": "70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
    "lib/idle-priority-short-state.ts": "4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
    "config/idlePriorityShortPolicy.ts": "6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
    "lib/aster-v3-client.ts": "4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf",
}
CASES = (
    "mode_false_both_short", "mode_true_short_short",
    "mode_false_short_inconsistent", "mode_true_both_inconsistent",
    "mode_false_short_positive", "mode_true_short_negative",
    "mode_missing_short", "mode_throw_short",
    "mode_true_long_reject", "mode_false_long_reject",
    "mode_false_both_positive_reject", "mode_true_both_positive_reject",
    "mode_true_wrong_stop_price", "mode_false_missing_stop",
    "mode_true_pending", "mode_false_unmanaged_order",
)
ACCEPT = set(CASES[:8])
NODE = r'''
"use strict";
const fs=require("node:fs"), fsp=require("node:fs/promises"), path=require("node:path"), vm=require("node:vm"), crypto=require("node:crypto");
const {stripTypeScriptTypes}=require("node:module");
const [caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit25-position-mode-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(raw).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=raw.toString("utf8");
}
const base={process,Date,Number,Promise,Error,Set,Map,Buffer,console,dirname:path.dirname,resolve:path.resolve,
 chmod:fsp.chmod,chown:fsp.chown,copyFile:fsp.copyFile,lstat:fsp.lstat,mkdir:fsp.mkdir,open:fsp.open,readFile:fsp.readFile,rename:fsp.rename,stat:fsp.stat,unlink:fsp.unlink,writeFile:fsp.writeFile};
function compile(src,context,exports){
 const clean=src.replace(/^import .*;\r?\n/gm,"").replace(/^export\s+/gm,"");
 const code=stripTypeScriptTypes(clean,{mode:"transform"});
 vm.runInContext(code+"\nglobalThis.__result={"+exports+"};",context,{timeout:5000});
 return context.__result;
}
const cfg=compile(sources["config/idlePriorityShortPolicy.ts"],vm.createContext({...base}),"IDLE_PRIORITY_SHORT_POLICY");
const state=compile(sources["lib/idle-priority-short-state.ts"],vm.createContext({...base,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY}),"normalizeIdleState");
const src=sources["scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts"].split("function numberEnv(")[0];
const recovery=compile(src,vm.createContext({...base,normalizeIdleState:state.normalizeIdleState}),"recoverIdleProtectedRateBudgetState");
const sha="a".repeat(40),statePath=path.join(caseDir,"state.json"),rule=cfg.IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT;
const saved={symbol:"RENDERUSDT",route:rule.route,side:"SHORT",signalTs:1000,entryTs:2000,exitTs:2000+rule.holdHours*3600000,entryPrice:100,quantity:1,holdHours:rule.holdHours,gross:rule.gross,stopPrice:110,takeProfitPrice:90,stopClientOrderId:"audit-stop",takeProfitClientOrderId:"audit-tp",protectionVerified:true};
const initial={schema:"disdex-idle-priority-state/v2",runtimeSha:sha,updatedAt:10000,positions:[saved],pending:null,manualReview:"IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:500",lastAcceptedBySymbol:{},failures:[]};
if(kind==="mode_true_pending")initial.pending={action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:rule.route,clientOrderId:"pending-audit",idempotencyKey:"pending-audit",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:rule.holdHours,createdAt:3000,updatedAt:4000,reason:"audit",gross:rule.gross};
fs.writeFileSync(statePath,JSON.stringify(initial));
const modeResponse=kind.includes("mode_false")?false:true;
const position={symbol:"RENDERUSDT",quantity:1,positionSide:"SHORT"};
if(kind==="mode_false_both_short"||kind==="mode_true_both_inconsistent"){position.quantity=-1;position.positionSide="BOTH";}
if(kind==="mode_true_short_negative")position.quantity=-1;
if(kind==="mode_true_long_reject"||kind==="mode_false_long_reject")position.positionSide="LONG";
if(kind==="mode_false_both_positive_reject"||kind==="mode_true_both_positive_reject")position.positionSide="BOTH";
const stop={symbol:"RENDERUSDT",orderId:1001,clientOrderId:"audit-stop",type:"STOP_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:110};
const tp={symbol:"RENDERUSDT",orderId:1002,clientOrderId:"audit-tp",type:"TAKE_PROFIT_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:90};
const orders=[stop,tp];
if(kind==="mode_true_wrong_stop_price")stop.stopPrice=111;
if(kind==="mode_false_missing_stop")orders.shift();
if(kind==="mode_false_unmanaged_order")orders.push({...stop,orderId:9999,clientOrderId:"foreign"});
let modeCalls=0,positionCalls=0,orderCalls=0;
const venue={
 async getPositions(symbol){positionCalls++;return [position];},
 async getOpenOrders(symbol){orderCalls++;return orders;},
 async getPositionMode(){modeCalls++;if(kind==="mode_throw_short")throw Error("SYNTHETIC_POSITION_MODE_UNAVAILABLE");return kind==="mode_missing_short"?undefined:{dualSidePosition:modeResponse};}
};
(async()=>{
 let status="pass",errorCode="";
 try{await recovery.recoverIdleProtectedRateBudgetState({statePath,expectedSha:sha,sourceSha:sha,backupPath:path.join(caseDir,"backup.json"),venue,now:()=>1700000000000});}
 catch(e){status="rejected";errorCode=String(e.message);}
 const after=JSON.parse(fs.readFileSync(statePath,"utf8"));
 process.stdout.write(JSON.stringify({kind,status,errorCode,manualReviewCleared:after.manualReview===null,modeCalls,positionCalls,orderCalls,positionSide:position.positionSide,positionQuantity:position.quantity,modeResponse:kind==="mode_missing_short"?"missing":kind==="mode_throw_short"?"throws":modeResponse,backupExists:fs.existsSync(path.join(caseDir,"backup.json"))}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
'''

def controlled_environment(work):
    env = os.environ.copy()
    for k in ("TMP", "TEMP", "TMPDIR"):
        env[k] = str(work)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env

def verify_pins():
    for name, expected in PINS.items():
        data = (PINROOT / pathlib.Path(name).name).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError("SOURCE_PIN_MISMATCH:" + name)
    rec = (PINROOT / "disdex-idle-priority-short-protected-rate-budget-recovery.ts").read_text(encoding="utf8")
    client = (PINROOT / "aster-v3-client.ts").read_text(encoding="utf8")
    if "getPositionMode()" not in client or "/fapi/v3/positionSide/dual" not in client:
        raise RuntimeError("ASTER_MODE_API_MISSING")
    if "getPositionMode" in rec:
        raise RuntimeError("RECOVERY_NOW_CALLS_POSITION_MODE")
    if "await assertProtectedVenueReadback(checked, input.venue)" not in rec:
        raise RuntimeError("RECOVERY_READBACK_CHANGED")
    if "async getPositions(symbol)" not in rec or "async getOpenOrders(symbol)" not in rec:
        raise RuntimeError("CLI_ADAPTER_CHANGED")
    if "return side === \"SHORT\" || (side === \"BOTH\" && position.quantity < 0)" not in rec:
        raise RuntimeError("SIDE_PREDICATE_CHANGED")

def fetch():
    if PINROOT.exists():
        raise RuntimeError("PIN_DIR_EXISTS")
    PINROOT.mkdir()
    for name, expected in PINS.items():
        endpoint = "repos/dunamishajime-bit/-ai-dex-manager/contents/" + name + "?ref=" + REF
        result = subprocess.run(["gh", "api", endpoint, "-H", "Accept: application/vnd.github.raw"],
                                capture_output=True, cwd=ROOT, env=controlled_environment(PINROOT), timeout=45)
        if result.returncode:
            raise RuntimeError("RAW_FETCH_FAILED:" + name + ":" + result.stderr.decode(errors="replace")[-400:])
        raw = result.stdout
        if hashlib.sha256(raw).hexdigest() != expected:
            raise RuntimeError("RAW_BYTES_SHA_MISMATCH:" + name)
        (PINROOT / pathlib.Path(name).name).write_bytes(raw)
    verify_pins()
    print(json.dumps({"status": "RAW_GITHUB_PINS_PASS", "sourceCommit": REF, "sourceRawSha256": PINS}, sort_keys=True))

def run(tag):
    if not tag.isalnum() or len(tag) > 32:
        raise RuntimeError("INVALID_TAG")
    verify_pins()
    work = ROOT / ("position-mode-audit-" + tag)
    if work.exists():
        raise RuntimeError("RUN_EXISTS")
    work.mkdir()
    (work / "pins.json").write_text(json.dumps(PINS, sort_keys=True), encoding="utf8")
    (work / "worker.cjs").write_text(NODE, encoding="utf8", newline="\n")
    rows = []
    for kind in CASES:
        directory = work / kind
        directory.mkdir()
        result = subprocess.run(["node", str(work / "worker.cjs"), str(directory), kind],
                                capture_output=True, text=True, cwd=directory, env=controlled_environment(work), timeout=30)
        if result.returncode:
            raise RuntimeError("NODE_CASE_FAILED:" + kind + ":" + result.stderr[-2000:])
        row = json.loads(result.stdout.strip())
        accepted = kind in ACCEPT
        if accepted and not (row["status"] == "pass" and row["manualReviewCleared"] and row["backupExists"]):
            raise RuntimeError("EXPECTED_PASS:" + str(row))
        if not accepted and not (row["status"] == "rejected" and not row["manualReviewCleared"]):
            raise RuntimeError("EXPECTED_REJECTION:" + str(row))
        if row["modeCalls"] != 0:
            raise RuntimeError("UNEXPECTED_POSITION_MODE_READ:" + str(row))
        if row["positionCalls"] != (0 if kind == "mode_true_pending" else 1):
            raise RuntimeError("UNEXPECTED_POSITION_READ:" + str(row))
        if row["orderCalls"] != (0 if kind == "mode_true_pending" else 1):
            raise RuntimeError("UNEXPECTED_ORDER_READ:" + str(row))
        rows.append(row)
    data = {"sourceSha256": PINS, "caseCount": len(rows), "results": rows}
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    print(json.dumps({"optimize": sys.flags.optimize, "caseCount": len(rows),
                      "canonicalSha256": hashlib.sha256(canonical.encode()).hexdigest(),
                      "results": rows}, sort_keys=True))

def six():
    launch = ROOT / "audit25-position-mode-launchers"
    if launch.exists():
        raise RuntimeError("LAUNCHER_DIR_EXISTS")
    launch.mkdir()
    script = ROOT / "audit_render4427_account_position_mode_20261027.py"
    a = """import os,sys,runpy,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
for k in ('TMP','TEMP','TMPDIR'):os.environ[k]=str(p)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
s=p/'audit_render4427_account_position_mode_20261027.py'
sys.argv=[str(s),'--tag',sys.argv[1]]
runpy.run_path(str(s),run_name='__main__')
"""
    b = """import os,sys,subprocess,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
env=os.environ.copy()
for k in ('TMP','TEMP','TMPDIR'):env[k]=str(p)
env['PYTHONDONTWRITEBYTECODE']='1'
flags=['-'+'O'*sys.flags.optimize] if sys.flags.optimize else []
s=p/'audit_render4427_account_position_mode_20261027.py'
r=subprocess.run([sys.executable,*flags,str(s),'--tag',sys.argv[1]],cwd=p,env=env,capture_output=True,text=True,timeout=180)
if r.returncode:raise RuntimeError('INNER_AUDIT_FAILED:'+r.stderr[-2000:])
print(r.stdout.strip())
"""
    (launch / "launcher_a.py").write_text(a, encoding="utf8", newline="\n")
    (launch / "launcher_b.py").write_text(b, encoding="utf8", newline="\n")
    runs = []
    for flag, mode in (([], "normal"), (["-O"], "O"), (["-OO"], "OO")):
        for launcher in ("a", "b"):
            tag = "pmode1545" + mode + launcher
            result = subprocess.run([sys.executable, *flag, str(launch / ("launcher_" + launcher + ".py")), tag],
                                    capture_output=True, text=True, cwd=ROOT, env=controlled_environment(ROOT), timeout=240)
            if result.returncode:
                raise RuntimeError("CHILD_FAILED:" + tag + ":" + result.stderr[-2000:])
            data = json.loads(result.stdout.strip())
            if data["optimize"] != {"normal": 0, "O": 1, "OO": 2}[mode] or data["caseCount"] != len(CASES):
                raise RuntimeError("OPTIMIZATION_OR_COUNT_MISMATCH:" + tag)
            item = {"launcher": launcher, "mode": mode, "exitCode": result.returncode,
                    "caseCount": data["caseCount"], "canonicalSha256": data["canonicalSha256"]}
            runs.append(item)
            print(json.dumps(item, sort_keys=True), flush=True)
    if len({x["canonicalSha256"] for x in runs}) != 1:
        raise RuntimeError("SIX_PROCESS_CANONICAL_MISMATCH")
    evidence = {"status": "PASS", "sourceCommit": REF, "sourceRawSha256": PINS,
                "sourceScriptSha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                "owner": "IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH",
                "route": "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT", "gross": 0.25,
                "nativeAllocator": "NEED_NATIVE_ALLOCATOR", "orderAuthorized": False,
                "caseCount": len(CASES), "totalCases": len(CASES)*6, "sixProcesses": runs,
                "canonicalSha256": runs[0]["canonicalSha256"],
                "modeReads": 0, "venueResponse": "synthetic", "productionModified": False,
                "limitations": "No real Aster mode response or receipt, no Production/Native8/13 GateProof."}
    target = ROOT / "audit25-position-mode-evidence.json"
    if target.exists():
        raise RuntimeError("EVIDENCE_EXISTS")
    target.write_text(json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                      encoding="utf8", newline="\n")
    print(json.dumps({"status": "PASS", "totalCases": evidence["totalCases"],
                      "canonicalSha256": evidence["canonicalSha256"], "evidenceFile": target.name}, sort_keys=True))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--tag")
    parser.add_argument("--six", action="store_true")
    args = parser.parse_args()
    if args.fetch:
        fetch()
    elif args.tag:
        run(args.tag)
    elif args.six:
        six()
    else:
        raise RuntimeError("FETCH_OR_TAG_OR_SIX_REQUIRED")

if __name__ == "__main__":
    main()
