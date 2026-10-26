#!/usr/bin/env python3
"""Read-only research audit: expired account lock recovery and RELEASED rows.
Only fetch pinned GitHub source bytes; execute extracted pure TS inspection logic
in an in-memory Node subprocess. No repo imports, file writes, venue or orders.
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

sys.dont_write_bytecode = True
SOURCE_REF = "939b59da49ce7960485a2004b0068dc63417ae82"
REPO = "dunamishajime-bit/-ai-dex-manager"
PINS = {
    "lib/disdex-expired-account-lock-recovery.ts": "a16dd16a0aeaaf7cd8c1873ad0c9dbe994560ebbf87f7933d29a9f7cf4a65395",
    "lib/disdex-account-order-lock.ts": "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b",
}
OWNER = "IDLE_PRIORITY_SHORT:1234"
NODE = r'''
const {stripTypeScriptTypes} = require('node:module');
const source = Buffer.from(process.argv[1], 'base64').toString('utf8');
const js = stripTypeScriptTypes(source).replace(
  'export function inspectExpiredAccountOrderLock(',
  'function inspectExpiredAccountOrderLock('
);
const inspect = Function(js + '\nreturn inspectExpiredAccountOrderLock;')();
const owner = 'IDLE_PRIORITY_SHORT:1234';
const base = {schema:'disdex-account-lock/v1', ownerId:owner, expiresAt:9000, reservations:[]};
const opt = {now:10000, expectedOwnerId:owner, ownerAlive:false};
const released = {reservationId:'r1',status:'RELEASED',strategyId:'IDLE_PRIORITY_SHORT',gross:0.25};
const reserved = {reservationId:'r2',status:'RESERVED',strategyId:'IDLE_PRIORITY_SHORT',gross:0.25};
const tests = [
  ['empty_expired',base,opt,'EXPIRED_ACCOUNT_LOCK_RECOVERY_ELIGIBLE'],
  ['released_only',{...base,reservations:[released]},opt,'ACCOUNT_LOCK_RESERVATIONS_PRESENT'],
  ['two_released',{...base,reservations:[released,{...released,reservationId:'r3'}]},opt,'ACCOUNT_LOCK_RESERVATIONS_PRESENT'],
  ['reserved_only',{...base,reservations:[reserved]},opt,'ACCOUNT_LOCK_RESERVATIONS_PRESENT'],
  ['mixed',{...base,reservations:[released,reserved]},opt,'ACCOUNT_LOCK_RESERVATIONS_PRESENT'],
  ['owner_alive',base,{...opt,ownerAlive:true},'ACCOUNT_LOCK_OWNER_STILL_ALIVE'],
  ['not_expired',{...base,expiresAt:10001},opt,'ACCOUNT_LOCK_NOT_EXPIRED'],
  ['expiry_equal_now',{...base,expiresAt:10000},opt,'EXPIRED_ACCOUNT_LOCK_RECOVERY_ELIGIBLE'],
  ['owner_mismatch',base,{...opt,expectedOwnerId:'OTHER:1234'},'ACCOUNT_LOCK_OWNER_MISMATCH'],
  ['no_pid_no_proof',{...base,ownerId:'NO_PID'},{...opt,expectedOwnerId:'NO_PID'},'ACCOUNT_LOCK_OWNER_PID_MISSING'],
  ['no_pid_allow_without_absence',{...base,ownerId:'NO_PID'},{...opt,expectedOwnerId:'NO_PID',allowMissingOwnerPid:true},'ACCOUNT_LOCK_OWNER_ABSENCE_PROOF_REQUIRED'],
  ['no_pid_with_absence',{...base,ownerId:'NO_PID'},{...opt,expectedOwnerId:'NO_PID',allowMissingOwnerPid:true,ownerProcessAbsent:true},'EXPIRED_ACCOUNT_LOCK_RECOVERY_ELIGIBLE'],
  ['reservations_not_array',{...base,reservations:null},opt,'ACCOUNT_LOCK_RESERVATIONS_INVALID'],
  ['released_null_entry',{...base,reservations:[null]},opt,'ACCOUNT_LOCK_RESERVATIONS_PRESENT'],
  ['released_empty_object',{...base,reservations:[{}]},opt,'ACCOUNT_LOCK_RESERVATIONS_PRESENT']
];
const results = tests.map(([name,raw,options,expected])=>{
  let actual;
  try { actual=inspect(raw,options).status; } catch(e) { actual=e.message; }
  return {name,actual,expected,pass:actual===expected};
});
process.stdout.write(JSON.stringify({results}));
if(results.some(x=>!x.pass))process.exitCode=2;
'''
def fetch(path):
    url = "https://raw.githubusercontent.com/" + REPO + "/" + SOURCE_REF + "/" + path
    request = urllib.request.Request(url, headers={"User-Agent": "render4427-research-readonly"})
    with urllib.request.urlopen(request, timeout=25) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != PINS[path]:
        raise RuntimeError("SOURCE_PIN_MISMATCH:" + path + ":" + digest)
    return data.decode("utf-8")
def main():
    cwd = os.path.normcase(os.path.realpath(os.getcwd()))
    allowed = os.path.normcase(os.path.realpath("C:/Users/dis/render4427-research-only/"))
    if not (cwd == allowed or cwd.startswith(allowed + os.sep)):
        raise RuntimeError("UNAUTHORIZED_PC_CWD")
    recovery = fetch("lib/disdex-expired-account-lock-recovery.ts")
    lock = fetch("lib/disdex-account-order-lock.ts")
    assert "if (reservations.length > 0) throw new Error(\"ACCOUNT_LOCK_RESERVATIONS_PRESENT\")" in recovery
    assert "status: \"RELEASED\" as const" in lock
    assert "await unlink(this.path)" in lock
    start = recovery.index("function object(")
    end = recovery.index("function safeRequestId(")
    pure = recovery[start:end]
    if pure.count("export function inspectExpiredAccountOrderLock(") != 1:
        raise RuntimeError("INSPECTION_EXTRACTION_FAILED")
    proc = subprocess.run(
        ["node", "-e", NODE, base64.b64encode(pure.encode()).decode()],
        text=True, capture_output=True, timeout=30, check=False,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if proc.returncode:
        raise RuntimeError("NODE_AUDIT_FAILED:" + proc.stderr[:1200] + proc.stdout[:1200])
    results = json.loads(proc.stdout)["results"]
    if len(results) != 15 or any(not item["pass"] for item in results):
        raise RuntimeError("AUDIT_CASE_FAILURE")
    report = {
        "audit": "RENDER_4427_EXPIRED_LOCK_RELEASED_ROW",
        "source_ref": SOURCE_REF,
        "source_pins_sha256": PINS,
        "cases": results,
        "all_pass": True,
        "order_authorized": False,
        "adoption": "NEED_NATIVE_ALLOCATOR",
        "scope": "synthetic in-memory pure TS inspection, not Production or Native8 evidence",
    }
    canonical = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    print(json.dumps({"canonical_sha256":hashlib.sha256(canonical.encode()).hexdigest(),"case_count":len(results),"result":report},ensure_ascii=False,sort_keys=True,separators=(",",":")))
if __name__ == "__main__":
    main()
