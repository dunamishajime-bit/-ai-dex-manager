#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, tempfile, time

OPERATION="V4_DOGE_MISSED_TIME_EXIT"
SCOPE="V12_V4"
V4_SHA="53a0be396719f0284af4e11b35c66a4ac7d58f79"
LEG_ID="DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000"
STOP_ID="v12-v4-98ded39746ed3502a4d7b0e26ef9"
PLAN_SCHEMA="disdex-v4-exact-one-shot-operator-exit/v1"
REQUEST_SCHEMA="disdex-v4-operator-request/v1"

def req(ok,msg):
    if not ok: raise SystemExit(msg)

def load_json(path:pathlib.Path):
    req(path.is_file() and not path.is_symlink(),"UNTRUSTED_FILE:"+str(path))
    data=json.loads(path.read_text(encoding="utf-8"))
    req(isinstance(data,(dict,list)),"INVALID_JSON_ROOT:"+str(path))
    return data

def sha256(path:pathlib.Path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1<<20),b""): h.update(chunk)
    return h.hexdigest()

def validate_plan(plan):
    req(plan.get("schema")==PLAN_SCHEMA,"PLAN_SCHEMA_CHANGED")
    req(plan.get("operation")==OPERATION and plan.get("scope")==SCOPE,"PLAN_IDENTITY_CHANGED")
    req(plan.get("sourceSha")==V4_SHA,"PLAN_V4_SHA_CHANGED")
    req(plan.get("legId")==LEG_ID,"PLAN_LEG_CHANGED")
    req(plan.get("symbol")=="DOGEUSDT" and plan.get("route")=="REC_Y06_REV_D0_T72","PLAN_ROUTE_CHANGED")
    req(plan.get("side")=="SHORT" and int(plan.get("qty",0))==226,"PLAN_SIDE_OR_QTY_CHANGED")
    req(abs(float(plan.get("entryPrice",0))-0.08052)<1e-12,"PLAN_ENTRY_CHANGED")
    exitp=plan.get("plannedExit") or {}
    req(exitp.get("reason")=="TIME" and exitp.get("priceModelOnly") is True,"PLAN_EXIT_REASON_CHANGED")
    req(int(exitp.get("exitTs",0))==1793440800000 and abs(float(exitp.get("price",0))-0.07505)<1e-12,
        "PLAN_EXIT_TUPLE_CHANGED")
    req(plan.get("residentStopClientOrderId")==STOP_ID,"PLAN_STOP_CHANGED")
    req(plan.get("ordersEnabled") is True and plan.get("entryAuthority") is False,"PLAN_AUTHORITY_CHANGED")
    req(plan.get("allowedAction")=="ONE_SHOT_REDUCE_ONLY_EXIT","PLAN_ACTION_CHANGED")
    req(plan.get("noTestOrders") is True and plan.get("noUnrelatedMutation") is True,"PLAN_SAFETY_CHANGED")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--approval-id",required=True)
    ap.add_argument("--approval-store",default="/home/deploy/disdex-ui/shared/data/deploy-approvals.json")
    ap.add_argument("--plan",required=True)
    ap.add_argument("--guard",required=True)
    ap.add_argument("--output-dir",default="/var/lib/disdex/operator-requests")
    args=ap.parse_args()

    approval_store=pathlib.Path(args.approval_store)
    plan_path=pathlib.Path(args.plan)
    guard_path=pathlib.Path(args.guard)
    out_dir=pathlib.Path(args.output_dir)

    approvals=load_json(approval_store)
    req(isinstance(approvals,list),"APPROVAL_STORE_NOT_LIST")
    row=next((x for x in approvals if isinstance(x,dict) and x.get("id")==args.approval_id),None)
    req(row is not None,"APPROVAL_NOT_FOUND")
    req(row.get("status")=="APPROVED","APPROVAL_NOT_APPROVED")
    req(row.get("operation")==OPERATION and row.get("scope")==SCOPE,"APPROVAL_IDENTITY_MISMATCH")
    req(row.get("ordersEnabled") is True,"APPROVAL_ORDER_PERMISSION_MISSING")
    req(row.get("targetSha")==V4_SHA,"APPROVAL_SHA_MISMATCH")
    req(not row.get("redeemedByRunId"),"APPROVAL_ALREADY_REDEEMED")

    now=int(time.time())
    expiry_raw=int(row.get("approvalTokenExpiresAt") or 0)
    req(expiry_raw>0,"APPROVAL_EXPIRY_MISSING")
    expiry=expiry_raw//1000 if expiry_raw>10**12 else expiry_raw
    req(expiry>=now,"APPROVAL_TOKEN_EXPIRED")

    plan=load_json(plan_path)
    req(isinstance(plan,dict),"PLAN_NOT_OBJECT")
    validate_plan(plan)
    plan_hash=sha256(plan_path)
    req(row.get("planSha256")==plan_hash,"APPROVAL_PLAN_HASH_MISMATCH")

    req(guard_path.is_file() and not guard_path.is_symlink(),"GUARD_UNTRUSTED")
    guard_hash=sha256(guard_path)

    out_dir.mkdir(parents=True,exist_ok=True)
    os.chmod(out_dir,0o700)
    request_path=out_dir/f"{OPERATION}-{args.approval_id}.json"
    req(not request_path.exists(),"REQUEST_ALREADY_EXISTS")

    payload={
      "schema":REQUEST_SCHEMA,
      "state":"READY_FOR_EXTERNAL_EXECUTOR",
      "approvalId":args.approval_id,
      "operation":OPERATION,
      "scope":SCOPE,
      "sourceSha":V4_SHA,
      "planSha256":plan_hash,
      "guardSha256":guard_hash,
      "legId":LEG_ID,
      "symbol":"DOGEUSDT",
      "route":"REC_Y06_REV_D0_T72",
      "side":"SHORT",
      "qty":226,
      "entryPrice":0.08052,
      "plannedExit":{"reason":"TIME","exitTs":1793440800000,"price":0.07505,"priceModelOnly":True},
      "residentStopClientOrderId":STOP_ID,
      "allowedAction":"ONE_SHOT_REDUCE_ONLY_EXIT",
      "entryAuthority":False,
      "noTestOrders":True,
      "noUnrelatedMutation":True,
      "createdAt":now,
      "expiresAt":expiry,
      "ordersSent":0,
      "cancelsSent":0,
      "positionChangesSent":0,
    }

    fd,tmp=tempfile.mkstemp(prefix=".doge-operator-request-",dir=str(out_dir))
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            json.dump(payload,f,separators=(",",":"))
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp,0o600)
        os.replace(tmp,request_path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

    print(json.dumps({
      "status":"DOGE_OPERATOR_REQUEST_STAGED",
      "requestPath":str(request_path),
      "approvalId":args.approval_id,
      "expiresAt":expiry,
      "planSha256":plan_hash,
      "guardSha256":guard_hash,
      "ordersSent":0,
      "cancelsSent":0,
      "positionChangesSent":0,
    },separators=(",",":")))

if __name__=="__main__":
    main()
