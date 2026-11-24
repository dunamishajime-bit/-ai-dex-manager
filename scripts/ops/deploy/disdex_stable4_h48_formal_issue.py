"""STABLE4 H48 certificate issuer driven only by a redeemed HP Owner grant.

This script does not issue grants, send orders, clear holds, switch runners or
write certificates in preflight. The --issue path is intentionally bound to one
immutable candidate and a fresh cryptographically verified HP token.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

SOURCE = "74331d74f400acda21a2c1edb5f7b166e197a93f"
PLAN = "684b1b49d51cad53835d5e66ff1db3ca1692e4198d5a61ba5598bd73303a632f"
RESEARCH = "9e1142f5ec6d4bc285deef023572623bb1c37a34"
OPERATION = "HYPE_STABLE4_H48_TIME_ONLY_LIVE"
POLICY_SHA256 = "0a97e977e83acbe2bc77d8ba6b60fbbac12121a103ea544ba632d8daab67ea24"
ROOT = Path("/var/lib/disdex/unified-deploy")
RELEASE = Path("/home/deploy/disdex-trading/releases") / SOURCE
STORE = Path("/home/deploy/disdex-ui/shared/data/deploy-approvals.json")
CERT_DIR = Path("/etc/disdex/stable4/h48-time-only")
CERT = CERT_DIR / (SOURCE + ".json")
AUDIT_DIR = ROOT / "h48-owner-policy-issuance"
PUBKEY = ROOT / "owner-approval-public.pem"
# The H48 policy's independent V4 inventory verifier is a root-owned runtime
# dependency. Pin its deployed bytes so a missing or replaced verifier fails
# closed instead of silently falling back to an untrusted import path.
RUNTIME_OWNERSHIP_MODULE = Path("/usr/local/libexec/disdex-unified/disdex_v4_nonflat_ownership.py")
RUNTIME_OWNERSHIP_MODULE_SHA256 = "832ac8086277bace1bf5312863f3d9e7a741207c8726032ef44858385b1df365"


def require(value, code):
    if not value:
        raise ValueError("STABLE4_H48_FORMAL_" + code)


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False) + "\n").encode("ascii")


def regular(path, *, owner=None, no_write=False):
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink(), "REGULAR_FILE_REQUIRED")
    if owner is not None:
        require(st.st_uid == owner, "FILE_OWNER_INVALID")
    if no_write:
        require(st.st_mode & 0o222 == 0, "IMMUTABLE_SOURCE_REQUIRED")
    return st


def trusted_dir(path, *, mode=None):
    st = path.lstat()
    require(stat.S_ISDIR(st.st_mode) and not path.is_symlink() and st.st_uid == 0 and st.st_gid == 0 and not st.st_mode & 0o022, "DIRECTORY_NOT_ROOT_TRUSTED")
    if mode is not None:
        require(stat.S_IMODE(st.st_mode) == mode, "DIRECTORY_MODE_INVALID")
    return st


def approved_record(records, *, approval_id, run_id, now_ms):
    require(isinstance(records, list) and len(records) <= 10000, "APPROVAL_STORE_INVALID")
    require(isinstance(approval_id, str) and re.fullmatch(r"[0-9a-f-]{36}", approval_id) is not None, "APPROVAL_ID_INVALID")
    require(isinstance(run_id, str) and re.fullmatch(r"[0-9]{1,20}", run_id) is not None, "RUN_ID_INVALID")
    matches = [r for r in records if isinstance(r, dict) and r.get("id") == approval_id]
    require(len(matches) == 1, "APPROVAL_NOT_UNIQUE")
    r = matches[0]
    for k, v in (
        ("operation", OPERATION),
        ("scope", "HYPE_TREND_LONG"),
        ("targetSha", SOURCE),
        ("planSha256", PLAN),
        ("requestActor", "dunamishajime-bit"),
        ("ordersEnabled", True),
        ("status", "REDEEMED"),
        ("redeemedByRunId", run_id),
    ):
        require(type(r.get(k)) is type(v) and r[k] == v, "APPROVAL_" + k.upper() + "_MISMATCH")
    issued = r.get("createdAt")
    approved = r.get("approvedAt")
    redeemed = r.get("redeemedAt")
    expires = r.get("requestExpiresAt")
    require(all(type(x) is int and x > 0 for x in (issued, approved, redeemed, expires, now_ms))
            and issued <= approved <= redeemed <= now_ms + 30000
            and approved <= expires, "APPROVAL_TIMELINE_INVALID")
    return r


def certificate(now_ms):
    require(type(now_ms) is int and now_ms > 0, "TIME_INVALID")
    return {
        "schema": "disdex-stable4-h48-time-only-policy/v1",
        "approvedSha": SOURCE,
        "researchSha": RESEARCH,
        "planSha256": PLAN,
        "deploymentTarget": "professional-dismanager.net",
        "policy": "H48_TIME_ONLY",
        "route": "HYPE_REDESIGN_CAUSAL_H48R4_WSIG",
        "symbol": "HYPEUSDT",
        "side": "LONG",
        "holdHours": 48,
        "entryGridHours": 6,
        "residentStopRequired": False,
        "residentTakeProfitRequired": False,
        "approvedGross": {"crypto": 3, "stock": 1.5, "total": 3.5, "hype": 1},
        "issuedAt": now_ms,
        "expiresAt": now_ms + 30 * 86400000,
        "operatorAcknowledgement": "H48_TIME_ONLY",
        "authorizesOtherPolicies": False,
    }


def validate_pinned_policy(row, now_ms):
    source = RELEASE / "scripts/ops/root/disdex_stable4_h48_policy.py"
    regular(source, no_write=True)
    require(hashlib.sha256(source.read_bytes()).hexdigest() == POLICY_SHA256, "PINNED_POLICY_SOURCE_MISMATCH")
    regular(RUNTIME_OWNERSHIP_MODULE, owner=0, no_write=True)
    require(
        hashlib.sha256(RUNTIME_OWNERSHIP_MODULE.read_bytes()).hexdigest()
        == RUNTIME_OWNERSHIP_MODULE_SHA256,
        "PINNED_OWNERSHIP_RUNTIME_MISMATCH",
    )
    # Import only the exact Git pin plus the separately pinned root-owned
    # verifier dependency, never an operator-supplied module.
    sys.path.insert(0, str(RUNTIME_OWNERSHIP_MODULE.parent))
    sys.path.insert(0, str(source.parent))
    from disdex_stable4_h48_policy import validate_h48_certificate
    return validate_h48_certificate(row, approved_sha=SOURCE, approved_plan_sha256=PLAN, now_ms=now_ms)


def validate_token(token, *, now_s):
    require(isinstance(token, str) and 0 < len(token) <= 16384, "TOKEN_MISSING")
    regular(PUBKEY, owner=0)
    # The production public key and verifier are root-owned and immutable by
    # operator-facing workflow. Never accept caller-supplied keys or scopes.
    sys.path.insert(0, "/usr/local/libexec/disdex-unified")
    from disdex_owner_approval import verify
    return verify(
        token, PUBKEY, "dunamishajime-bit/-ai-dex-manager",
        SOURCE, "HYPE_TREND_LONG", "dunamishajime-bit", PLAN,
        now=now_s, nonce_dir=None, route="GITHUB_ACTIONS",
        deployment_target="professional-dismanager.net",
        operator_target="DD1296_FINAL_ALLIN_10BPS", orders_enabled=True,
    )


def verify_preflight(approval_id, run_id, now_ms):
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    trusted_dir(ROOT, mode=0o700)
    regular(PUBKEY, owner=0)
    require(RELEASE.is_dir() and not RELEASE.is_symlink(), "IMMUTABLE_RELEASE_MISSING")
    for rel in ("lib/hype-stable4-time-only-authority.ts", "lib/hype-stable4-time-only-contract.ts"):
        regular(RELEASE / rel, no_write=True)
    regular(STORE, owner=1000)
    rows = json.loads(STORE.read_bytes())
    record = approved_record(rows, approval_id=approval_id, run_id=run_id, now_ms=now_ms)
    validate_pinned_policy(certificate(now_ms), now_ms)
    require(not CERT.exists() and not CERT.is_symlink(), "CERTIFICATE_ALREADY_ISSUED")
    return record


def install_exact_file(path, raw, mode):
    require(not path.exists() and not path.is_symlink(), "TARGET_ALREADY_EXISTS")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    try:
        os.write(fd, raw)
        os.fchmod(fd, mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    st = regular(path, owner=0, no_write=True)
    require(st.st_gid == 0 and path.read_bytes() == raw, "INSTALLED_FILE_MISMATCH")


def ensure_directory(path, mode):
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=mode)
    trusted_dir(path, mode=mode)


def issue(approval_id, run_id, token):
    import fcntl
    now_ms = time.time_ns() // 1000000
    record = verify_preflight(approval_id, run_id, now_ms)
    payload = validate_token(token, now_s=now_ms // 1000)
    # Recheck the immutable scope of the signed token and that the HP redeemed
    # the same GitHub run which is currently issuing the certificate.
    require(payload.get("nonce") and payload.get("planSha256") == PLAN, "SIGNED_BINDING_INVALID")
    fd = os.open(ROOT / "deployment-execution.lock", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        record = verify_preflight(approval_id, run_id, time.time_ns() // 1000000)
        now_ms = time.time_ns() // 1000000
        row = certificate(now_ms)
        validate_pinned_policy(row, now_ms)
        parent = Path("/etc/disdex")
        trusted_dir(parent)
        ensure_directory(parent / "stable4", 0o755)
        ensure_directory(CERT_DIR, 0o755)
        ensure_directory(AUDIT_DIR, 0o700)
        install_exact_file(CERT, canonical(row), 0o444)
        receipt = {
            "schema": "disdex-stable4-h48-hp-approved-issuance/v1",
            "approvalId": record["id"],
            "runId": run_id,
            "sourceSha": SOURCE,
            "planSha256": PLAN,
            "policy": "H48_TIME_ONLY",
            "certificateSha256": hashlib.sha256(canonical(row)).hexdigest(),
            "tokenNonceSha256": hashlib.sha256(payload["nonce"].encode("ascii")).hexdigest(),
            "approvedAt": record["approvedAt"],
            "issuedAt": now_ms,
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
        }
        install_exact_file(AUDIT_DIR / (SOURCE + ".json"), canonical(receipt), 0o444)
        return {"status": "H48_OWNER_POLICY_CERTIFICATE_ISSUED_NOT_LIVE", "approvedSha": SOURCE,
                "planSha256": PLAN, "certificateSha256": receipt["certificateSha256"],
                "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preflight-readonly", action="store_true")
    parser.add_argument("--issue", action="store_true")
    parser.add_argument("--approval-id", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    require(args.preflight_readonly != args.issue, "MODE_REQUIRED")
    if args.preflight_readonly:
        verify_preflight(args.approval_id, args.run_id, time.time_ns() // 1000000)
        result = {"status": "H48_OWNER_CERTIFICATE_PREFLIGHT_ONLY_NOT_ISSUED", "approvedSha": SOURCE, "ordersSent": 0}
    else:
        token = sys.stdin.read(16385).strip()
        result = issue(args.approval_id, args.run_id, token)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"status": "H48_FORMAL_ISSUER_FAIL_CLOSED", "reason": str(e)[:180],
                          "ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}), file=sys.stderr)
        sys.exit(2)
