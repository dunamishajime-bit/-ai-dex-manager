#!/usr/bin/env python3
"""Install a bounded, no-order V4 evidence refresh lease.

The owner approval is verified by the existing Ed25519 approval contract and
its nonce is consumed before this lease is published.  The scheduled TypeScript
worker can only use the derived lease for one exact V4 release SHA; it cannot
enable orders, change runner pins, change systemd, or change venue state.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import time
from typing import Callable

from disdex_deployment_contract import (
    DEPLOYMENT_TARGET,
    OPERATOR_TARGET,
    REPO,
    ROUTES,
    SHA,
    validate_order_permission,
)
from disdex_owner_approval import verify

REFRESH_SCOPE = "V4_EVIDENCE_REFRESH_ONLY"
REFRESH_LEASE_SCHEMA = "disdex-v4-evidence-refresh-lease/v1"
REFRESH_PLAN_SCHEMA = "disdex-v4-evidence-refresh-plan/v1"
REFRESH_RUNNER = "V12_V4"
MAX_LEASE_SECONDS = 24 * 60 * 60
# A new independently signed grant can renew the bounded lease before expiry.
# Never allow early renewal outside the final warning window.
EARLY_RENEWAL_WINDOW_SECONDS = 12 * 60 * 60
LOGIN = re.compile(r"[A-Za-z0-9-]{1,39}\Z")
PLAN_HASH = re.compile(r"[0-9a-f]{64}\Z")
HEX32 = re.compile(r"[0-9a-f]{32}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
LEASE_ROOT = Path("/var/lib/disdex/unified-deploy/refresh-leases/v4")
REFRESH_OUTPUT_PATH = "/var/lib/disdex/v12-v4/evidence-refresh-last.json"
LEASE_FIELDS = frozenset({
    "schema", "repository", "deploymentTarget", "operatorTarget", "scope", "route",
    "approvedSha", "approvedRunner", "approvedRunners", "approvedShaByRunner",
    "releaseRoot", "evidenceRoot", "outputPath", "planSha256", "ordersEnabled", "signatureVerified",
    "approvalNonceDigest", "approvalIssuedAt", "approvalExpiresAt", "approvedAt",
    "expiresAt", "leaseId",
})


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate lease field")
        result[key] = value
    return result


def refresh_plan(sha: str) -> dict:
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("refresh plan SHA invalid")
    return {
        "schema": REFRESH_PLAN_SCHEMA,
        "repository": REPO,
        "deploymentTarget": DEPLOYMENT_TARGET,
        "operatorTarget": OPERATOR_TARGET,
        "scope": REFRESH_SCOPE,
        "sourceSha": sha,
        "approvedRunner": REFRESH_RUNNER,
        "approvedRunners": [REFRESH_RUNNER],
        "approvedShaByRunner": {REFRESH_RUNNER: sha},
        "releaseRoot": f"/home/deploy/disdex-trading/releases/{sha}",
        "evidenceRoot": "/etc/disdex/v12-v4-evidence",
        "outputPath": REFRESH_OUTPUT_PATH,
        "ordersEnabled": False,
    }


def refresh_plan_sha256(sha: str) -> str:
    return hashlib.sha256(canonical(refresh_plan(sha))).hexdigest()


def _assert_approval_shape(approval: dict) -> None:
    if not isinstance(approval, dict):
        raise ValueError("approval must be an object")
    if (approval.get("schema") != "disdex-owner-deployment-approval/v2"
            or approval.get("repository") != REPO
            or approval.get("deploymentTarget") != DEPLOYMENT_TARGET
            or approval.get("operatorTarget") != OPERATOR_TARGET
            or approval.get("scope") != REFRESH_SCOPE
            or approval.get("ordersEnabled") is not False):
        raise ValueError("refresh approval scope or target mismatch")
    sha = approval.get("sourceSha")
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("refresh approval SHA invalid")
    operator = approval.get("operator")
    if not isinstance(operator, str) or not LOGIN.fullmatch(operator):
        raise ValueError("refresh approval operator invalid")
    if approval.get("route") not in ROUTES:
        raise ValueError("refresh approval route invalid")
    if approval.get("planSha256") != refresh_plan_sha256(sha):
        raise ValueError("refresh approval plan mismatch")
    nonce = approval.get("nonce")
    if not isinstance(nonce, str) or not HEX32.fullmatch(nonce):
        raise ValueError("refresh approval nonce invalid")
    issued = approval.get("issuedAt")
    expires = approval.get("expiresAt")
    if (type(issued) is not int or type(expires) is not int
            or not 1 <= expires - issued <= 300):
        raise ValueError("refresh approval time window invalid")
    validate_order_permission(REFRESH_SCOPE, False)


def build_refresh_lease(approval: dict, *, now: int | None = None,
                        ttl: int = MAX_LEASE_SECONDS) -> dict:
    _assert_approval_shape(approval)
    now = int(time.time()) if now is None else now
    if type(now) is not int or now <= 0:
        raise ValueError("refresh lease time invalid")
    if type(ttl) is not int or not 1 <= ttl <= MAX_LEASE_SECONDS:
        raise ValueError("refresh lease TTL invalid")
    if approval["expiresAt"] <= now:
        raise ValueError("refresh approval expired")
    sha = approval["sourceSha"]
    return {
        "schema": REFRESH_LEASE_SCHEMA,
        "repository": REPO,
        "deploymentTarget": DEPLOYMENT_TARGET,
        "operatorTarget": OPERATOR_TARGET,
        "scope": REFRESH_SCOPE,
        "route": approval["route"],
        "approvedSha": sha,
        "approvedRunner": REFRESH_RUNNER,
        "approvedRunners": [REFRESH_RUNNER],
        "approvedShaByRunner": {REFRESH_RUNNER: sha},
        "releaseRoot": f"/home/deploy/disdex-trading/releases/{sha}",
        "evidenceRoot": "/etc/disdex/v12-v4-evidence",
        "outputPath": REFRESH_OUTPUT_PATH,
        "planSha256": approval["planSha256"],
        "ordersEnabled": False,
        "signatureVerified": True,
        "approvalNonceDigest": hashlib.sha256(approval["nonce"].encode("ascii")).hexdigest(),
        "approvalIssuedAt": approval["issuedAt"],
        "approvalExpiresAt": approval["expiresAt"],
        "approvedAt": now,
        "expiresAt": now + ttl,
        "leaseId": secrets.token_hex(16),
    }


def validate_refresh_lease(lease: dict, *, sha: str, now: int | None = None,
                          allow_expired: bool = False) -> dict:
    now = int(time.time()) if now is None else now
    if (not isinstance(lease, dict) or set(lease) != LEASE_FIELDS
            or lease.get("schema") != REFRESH_LEASE_SCHEMA):
        raise ValueError("refresh lease schema invalid")
    if lease.get("repository") != REPO or lease.get("deploymentTarget") != DEPLOYMENT_TARGET or lease.get("operatorTarget") != OPERATOR_TARGET:
        raise ValueError("refresh lease target mismatch")
    if lease.get("scope") != REFRESH_SCOPE:
        raise ValueError("refresh lease scope mismatch")
    if lease.get("approvedSha") != sha or not SHA.fullmatch(str(sha)):
        raise ValueError("refresh lease SHA mismatch")
    if lease.get("approvedRunner") != REFRESH_RUNNER or lease.get("approvedRunners") != [REFRESH_RUNNER] or lease.get("approvedShaByRunner") != {REFRESH_RUNNER: sha}:
        raise ValueError("refresh lease runner map mismatch")
    if (lease.get("releaseRoot") != f"/home/deploy/disdex-trading/releases/{sha}"
            or lease.get("evidenceRoot") != "/etc/disdex/v12-v4-evidence"
            or lease.get("outputPath") != REFRESH_OUTPUT_PATH):
        raise ValueError("refresh lease path mismatch")
    if lease.get("ordersEnabled") is not False:
        raise ValueError("refresh lease orders are not allowed")
    if lease.get("signatureVerified") is not True:
        raise ValueError("refresh lease signature not verified")
    if lease.get("route") not in ROUTES:
        raise ValueError("refresh lease route invalid")
    if not PLAN_HASH.fullmatch(str(lease.get("planSha256", ""))) or lease["planSha256"] != refresh_plan_sha256(sha):
        raise ValueError("refresh lease plan mismatch")
    if not HEX64.fullmatch(str(lease.get("approvalNonceDigest", ""))) or not HEX32.fullmatch(str(lease.get("leaseId", ""))):
        raise ValueError("refresh lease nonce invalid")
    approved_at = lease.get("approvedAt")
    expires_at = lease.get("expiresAt")
    approval_issued = lease.get("approvalIssuedAt")
    approval_expires = lease.get("approvalExpiresAt")
    if (type(approved_at) is not int or type(expires_at) is not int
            or approved_at <= 0 or expires_at <= 0
            or approved_at > now + 30 or expires_at <= approved_at
            or (not allow_expired and expires_at <= now)
            or expires_at - approved_at > MAX_LEASE_SECONDS):
        raise ValueError("refresh lease expired or future dated")
    if (type(approval_issued) is not int or type(approval_expires) is not int
            or approval_issued <= 0 or approval_expires <= 0
            or approval_issued > now + 30
            or not 1 <= approval_expires - approval_issued <= 300):
        raise ValueError("refresh lease approval window invalid")
    return lease


def expected_lease_path(sha: str, root: Path = LEASE_ROOT) -> Path:
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("refresh lease SHA invalid")
    return root / f"{sha}.json"


def require_fresh_refresh_approval(existing: dict | None, approval: dict) -> None:
    """Reject a re-approval that repeats the nonce recorded in an old lease."""
    if existing is None:
        return
    nonce = approval.get("nonce") if isinstance(approval, dict) else None
    if isinstance(nonce, str) and existing.get("approvalNonceDigest") == hashlib.sha256(
            nonce.encode("ascii")).hexdigest():
        raise ValueError("refresh approval nonce reused")


def validate_refresh_renewal_window(existing: dict | None, *, now: int) -> None:
    """Allow a newly signed grant to replace a lease only near its deadline.

    This does NOT renew a lease by itself. install_refresh_lease still requires
    a new owner-signed token, consumes its nonce, and binds the exact same SHA,
    scope, plan and ordersEnabled=false. No self-renewal or silent extension.
    """
    if existing is None:
        return
    if type(now) is not int or now <= 0:
        raise ValueError("refresh renewal time invalid")
    expires_at = existing.get("expiresAt")
    if type(expires_at) is not int:
        raise ValueError("refresh renewal expiry invalid")
    if expires_at - now > EARLY_RENEWAL_WINDOW_SECONDS:
        raise ValueError("refresh lease renewal too early")


def _assert_root() -> None:
    geteuid = getattr(os, "geteuid", None)
    if not callable(geteuid) or geteuid() != 0:
        raise ValueError("root authority required")


def _private_dir(path: Path) -> None:
    s = path.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
        raise ValueError("refresh lease directory must be root-owned and private")


def _write_root_json(path: Path, value: dict) -> None:
    _private_dir(path.parent)
    if path.exists() or path.is_symlink():
        s = path.lstat()
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
            raise ValueError("refresh lease destination is untrusted")
    temporary = path.parent / f".{path.name}.{secrets.token_hex(16)}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def install_refresh_lease(*, token: str, sha: str, operator: str,
                          route: str, plan_sha256: str, public_key: Path,
                          nonce_dir: Path, lease_path: Path,
                          now: int | None = None, verify_fn: Callable = verify) -> dict:
    _assert_root()
    now = int(time.time()) if now is None else now
    if type(now) is not int or now <= 0:
        raise ValueError("refresh activation time invalid")
    if plan_sha256 != refresh_plan_sha256(sha):
        raise ValueError("refresh plan mismatch")
    if lease_path.parent != LEASE_ROOT or lease_path.name != f"{sha}.json":
        raise ValueError("refresh lease path must be exact SHA path")
    existing = None
    if lease_path.exists() or lease_path.is_symlink():
        _private_dir(lease_path.parent)
        existing_stat = lease_path.lstat()
        if (not stat.S_ISREG(existing_stat.st_mode) or existing_stat.st_uid != 0
                or existing_stat.st_mode & 0o077):
            raise ValueError("existing refresh lease is untrusted")
        try:
            existing = json.loads(lease_path.read_text(encoding="utf-8"), object_pairs_hook=_unique_json)
            validate_refresh_lease(existing, sha=sha, now=now, allow_expired=True)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise ValueError("existing refresh lease is invalid; refusing overwrite") from error
        validate_refresh_renewal_window(existing, now=now)
    approval = verify_fn(
        token,
        public_key,
        REPO,
        sha,
        REFRESH_SCOPE,
        operator,
        plan_sha256,
        now=now,
        nonce_dir=nonce_dir,
        route=route,
        deployment_target=DEPLOYMENT_TARGET,
        operator_target=OPERATOR_TARGET,
        orders_enabled=False,
    )
    require_fresh_refresh_approval(existing, approval)
    lease = build_refresh_lease(approval, now=now)
    validate_refresh_lease(lease, sha=sha, now=now)
    _write_root_json(lease_path, lease)
    return {"status": "V4_REFRESH_LEASE_INSTALLED", "scope": REFRESH_SCOPE,
            "approvedSha": sha, "ordersEnabled": False,
            "leasePath": str(lease_path), "signatureVerified": True}


def main() -> int:
    parser = argparse.ArgumentParser(description="Install a no-order V4 evidence refresh lease")
    parser.add_argument("--install", action="store_true", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--operator", required=True)
    parser.add_argument("--route", required=True, choices=sorted(ROUTES))
    parser.add_argument("--plan-sha256", required=True)
    parser.add_argument("--token-stdin", action="store_true", required=True)
    parser.add_argument("--public-key", default="/var/lib/disdex/unified-deploy/owner-approval-public.pem")
    parser.add_argument("--nonce-dir", default="/var/lib/disdex/unified-deploy/nonces")
    args = parser.parse_args()
    try:
        if not SHA.fullmatch(args.sha) or not LOGIN.fullmatch(args.operator):
            raise ValueError("refresh identity invalid")
        token = sys.stdin.read(16_385)
        if len(token) > 16_384:
            raise ValueError("owner approval too large")
        result = install_refresh_lease(
            token=token.strip(), sha=args.sha, operator=args.operator,
            route=args.route, plan_sha256=args.plan_sha256,
            public_key=Path(args.public_key), nonce_dir=Path(args.nonce_dir),
            lease_path=expected_lease_path(args.sha),
        )
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print("DISDEX_V4_REFRESH_LEASE_BLOCKED:" + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
