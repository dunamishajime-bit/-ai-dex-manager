"""H48 STOP8 exact-plan Root certificate issuer, deliberately NOT dispatched.

This is source for a future reviewed Production workflow. No approval is
generated here. All mutations require a *redeemed*, single-run exact
HP Owner approval, the official Ed25519 verifier, an immutable release,
and a signed owner token bound to the NEW SHA and NEW STOP8 plan hash.

The existing H48_TIME_ONLY certificate / approval can never authorize
H48_R4_RESIDENT_STOP8. This script NEVER enables orders, changes a symlink,
removes GLOBAL HOLD, restarts a Runner, or writes a scoped order permit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

REPO = "dunamishajime-bit/-ai-dex-manager"
DEPLOYMENT_TARGET = "professional-dismanager.net"
OWNER = "dunamishajime-bit"
SCOPE = "HYPE_TREND_LONG"
OPERATION = "HYPE_STABLE4_H48_STOP8_LIVE"
POLICY = "H48_R4_RESIDENT_STOP8"
SCHEMA = "disdex-h48-stop8-root-owner-bundle/v1"
PLAN_SCHEMA = "disdex-stable4-h48-stop8-final-order-plan/v1"
RELEASE_ROOT = Path("/home/deploy/disdex-trading/releases")
PUBLIC = Path("/var/lib/disdex/unified-deploy/owner-approval-public.pem")
APPROVAL_STORE = Path("/home/deploy/disdex-ui/shared/data/deploy-approvals.json")
CERT_ROOT = Path("/etc/disdex/stable4/h48-stop8")
RECEIPT_ROOT = Path("/var/lib/disdex/unified-deploy/h48-stop8-issuance")
OWNER_VERIFIER = Path("/usr/local/libexec/disdex-unified/disdex_owner_approval.py")

SHA = re.compile(r"[a-f0-9]{40}\Z")
HEX64 = re.compile(r"[a-f0-9]{64}\Z")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\Z")
GROSS = {"crypto": 3, "stock": 4, "total": 4.25, "hype": 1.5}


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError("H48_STOP8_ROOT_ISSUE_" + reason)


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=True) + "\n").encode("ascii")


def regular(path: Path, *, immutable: bool = False, root: bool = False) -> bytes:
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink(), "REGULAR_FILE")
    if root:
        require(st.st_uid == 0 and st.st_gid == 0, "ROOT_OWNER")
    if immutable:
        require(st.st_mode & 0o222 == 0, "IMMUTABLE_FILE")
    raw = path.read_bytes()
    after = path.lstat()
    require(st.st_ino == after.st_ino and st.st_dev == after.st_dev and st.st_size == after.st_size
            and st.st_mtime_ns == after.st_mtime_ns, "CHANGED_FILE")
    require(0 < len(raw) <= 262144, "FILE_SIZE")
    return raw


def trusted_root_dir(path: Path) -> None:
    p = path.lstat()
    require(stat.S_ISDIR(p.st_mode) and not path.is_symlink()
            and p.st_uid == 0 and p.st_gid == 0
            and not p.st_mode & 0o022, "ROOT_DIRECTORY_UNTRUSTED")


def load_json(raw: bytes) -> object:
    def unique(pairs):
        out = {}
        for key, value in pairs:
            require(key not in out, "DUPLICATE_JSON_FIELD")
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=unique)


def expected_plan(plan: object, sha: str) -> dict:
    require(isinstance(plan, dict) and SHA.fullmatch(sha) is not None, "PLAN_OR_SHA_INVALID")
    fields = {
        "schema", "approvedSha", "status", "deploymentTarget", "scope",
        "operation", "ordersEnabled", "policy", "residentStopRequired",
        "residentTakeProfitRequired", "stopTriggerPct", "stopOrderType",
        "stopReduceOnly", "gross", "maxEntryNotionalUsd", "maxSlippageBps",
    }
    require(set(plan) == fields
            and plan["schema"] == PLAN_SCHEMA
            and plan["approvedSha"] == sha
            and plan["status"] == "FINAL_OWNER_HP_SIGNED"
            and plan["deploymentTarget"] == DEPLOYMENT_TARGET
            and plan["scope"] == SCOPE
            and plan["operation"] == OPERATION
            and plan["ordersEnabled"] is True
            and plan["policy"] == POLICY
            and plan["residentStopRequired"] is True
            and plan["residentTakeProfitRequired"] is False
            and type(plan["stopTriggerPct"]) is int and plan["stopTriggerPct"] == 8
            and plan["stopOrderType"] == "STOP_MARKET"
            and plan["stopReduceOnly"] is True
            and type(plan["gross"]) is dict and plan["gross"] == GROSS
            and isinstance(plan["maxEntryNotionalUsd"], (int, float))
            and type(plan["maxEntryNotionalUsd"]) is not bool
            and 0 < plan["maxEntryNotionalUsd"] < 1_000_000
            and isinstance(plan["maxSlippageBps"], (int, float))
            and type(plan["maxSlippageBps"]) is not bool
            and 0 < plan["maxSlippageBps"] <= 30,
            "FINAL_SIGNED_STOP8_PLAN_INVALID")
    return plan


def approved_record(records: object, *, approval_id: str, sha: str,
                    plan_hash: str, run_id: str, now_ms: int) -> dict:
    require(isinstance(records, list) and len(records) <= 10000,
            "APPROVAL_RECORDS_INVALID")
    require(UUID.fullmatch(approval_id) is not None
            and SHA.fullmatch(sha) is not None
            and HEX64.fullmatch(plan_hash) is not None
            and re.fullmatch(r"[0-9]{1,20}", run_id) is not None,
            "APPROVAL_IDENTITY_INVALID")
    matches = [r for r in records if isinstance(r, dict) and r.get("id") == approval_id]
    require(len(matches) == 1, "APPROVAL_NOT_EXACT_ONE")
    row = matches[0]
    expected = {
        "operation": OPERATION, "scope": SCOPE, "targetSha": sha,
        "planSha256": plan_hash, "requestActor": OWNER,
        "ordersEnabled": True, "status": "REDEEMED",
        "redeemedByRunId": run_id,
    }
    for k, v in expected.items():
        require(type(row.get(k)) is type(v) and row[k] == v,
                "APPROVAL_" + k.upper() + "_MISMATCH")
    stamps = [row.get(k) for k in ("createdAt", "approvedAt", "redeemedAt", "requestExpiresAt")]
    require(all(type(v) is int and v > 0 for v in stamps)
            and stamps[0] <= stamps[1] <= stamps[2] <= now_ms + 30000
            and stamps[1] <= stamps[3]
            and now_ms - stamps[2] <= 300000,
            "APPROVAL_EXPIRED_OR_OUT_OF_ORDER")
    return row


def bundle(*, sha: str, plan_hash: str, plan: dict,
           approval_id: str, owner_signed_token: str, now_ms: int) -> dict:
    expected_plan(plan, sha)
    require(HEX64.fullmatch(plan_hash) is not None and UUID.fullmatch(approval_id) is not None
            and isinstance(owner_signed_token, str) and 0 < len(owner_signed_token) <= 16384
            and type(now_ms) is int and now_ms > 0,
            "CERTIFICATE_INPUT_INVALID")
    return {
        "schema": SCHEMA, "approvedSha": sha,
        "planSha256": plan_hash, "deploymentTarget": DEPLOYMENT_TARGET,
        "scope": SCOPE, "operation": OPERATION, "policy": POLICY,
        "residentStopRequired": True,
        "residentTakeProfitRequired": False,
        "stopTriggerPct": 8, "stopOrderType": "STOP_MARKET",
        "stopReduceOnly": True, "gross": GROSS.copy(),
        "approvalId": approval_id, "ownerSignedToken": owner_signed_token,
        "issuedAt": now_ms, "expiresAt": now_ms + 30 * 86400000,
        "maxEntryNotionalUsd": plan["maxEntryNotionalUsd"],
        "maxSlippageBps": plan["maxSlippageBps"],
    }


def load_required_source(sha: str, plan_hash: str) -> dict:
    require(SHA.fullmatch(sha) is not None and HEX64.fullmatch(plan_hash) is not None,
            "SOURCE_IDENTITY_INVALID")
    release = RELEASE_ROOT / sha
    st = release.lstat()
    require(stat.S_ISDIR(st.st_mode) and not release.is_symlink()
            and st.st_uid == 0 and not st.st_mode & 0o022,
            "IMMUTABLE_RELEASE_REQUIRED")
    raw = regular(release / "config/disdex-stable4-h48-stop8-final-order-plan.json",
                  immutable=True, root=True)
    require(hashlib.sha256(raw).hexdigest() == plan_hash,
            "PLAN_HASH_MISMATCH")
    return expected_plan(load_json(raw), sha)


def exact_owner_verification(token: str, sha: str, plan_hash: str, now_ms: int) -> None:
    regular(PUBLIC, root=True)
    regular(OWNER_VERIFIER, root=True, immutable=True)
    sys.path.insert(0, str(OWNER_VERIFIER.parent))
    from disdex_owner_approval import verify
    verify(token, PUBLIC, REPO, sha, SCOPE, OWNER, plan_hash,
           now=now_ms // 1000, nonce_dir=None, route="GITHUB_ACTIONS",
           deployment_target=DEPLOYMENT_TARGET,
           operator_target="DD1296_FINAL_ALLIN_10BPS", orders_enabled=True)


def exclusive_immutable(path: Path, data: bytes) -> None:
    trusted_root_dir(path.parent)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.fchmod(fd, 0o444)
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def formal_issue(*, sha: str, plan_hash: str, approval_id: str,
                 run_id: str, owner_token: str, now_ms: int) -> dict:
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    plan = load_required_source(sha, plan_hash)
    record = load_json(regular(APPROVAL_STORE))
    approved_record(record, approval_id=approval_id, sha=sha,
                    plan_hash=plan_hash, run_id=run_id, now_ms=now_ms)
    exact_owner_verification(owner_token, sha, plan_hash, now_ms)
    for directory in (CERT_ROOT, RECEIPT_ROOT):
        trusted_root_dir(directory)
    cert = CERT_ROOT / (sha + ".json")
    receipt = RECEIPT_ROOT / (sha + ".json")
    require(not cert.exists() and not receipt.exists(), "CERTIFICATE_ALREADY_EXISTS")
    policy = bundle(sha=sha, plan_hash=plan_hash, plan=plan,
                    approval_id=approval_id, owner_signed_token=owner_token, now_ms=now_ms)
    raw = canonical(policy)
    certificate_sha256 = hashlib.sha256(raw).hexdigest()
    # The issuer only records a signed STOP8 policy, not an order permit.
    # If a crash occurs between writes, preflight remains blocked until the
    # missing receipt is independently reconciled; never overwrite.
    exclusive_immutable(cert, raw)
    receipt_row = {
        "schema": "disdex-h48-stop8-issuance-receipt/v1",
        "approvedSha": sha, "planSha256": plan_hash,
        "certificateSha256": certificate_sha256,
        "approvalId": approval_id, "runId": run_id,
        "policy": POLICY, "issuedAt": now_ms,
        "ordersEnabled": False, "orderPermitIssued": False,
    }
    exclusive_immutable(receipt, canonical(receipt_row))
    return {"status": "H48_STOP8_CERTIFICATE_ISSUED_NO_ORDER_PERMIT",
            "approvedSha": sha, "certificateSha256": certificate_sha256,
            "tradingMutations": 0}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--plan-sha256", required=True)
    parser.add_argument("--issue", action="store_true")
    parser.add_argument("--approval-id")
    parser.add_argument("--run-id")
    parser.add_argument("--owner-token-file")
    args = parser.parse_args()
    plan = load_required_source(args.source_sha, args.plan_sha256)
    if not args.issue:
        print(json.dumps({"status": "H48_STOP8_ROOT_PREFLIGHT_READ_ONLY",
                          "approvedSha": args.source_sha,
                          "policy": plan["policy"],
                          "ordersEnabled": False, "tradingMutations": 0}, sort_keys=True))
        return
    require(args.approval_id and args.run_id and args.owner_token_file,
            "EXPLICIT_SIGNED_HP_APPROVAL_REQUIRED")
    token = regular(Path(args.owner_token_file), root=True).decode("ascii").strip()
    print(json.dumps(formal_issue(sha=args.source_sha, plan_hash=args.plan_sha256,
        approval_id=args.approval_id, run_id=args.run_id,
        owner_token=token, now_ms=int(time.time() * 1000)), sort_keys=True))


if __name__ == "__main__":
    main()
