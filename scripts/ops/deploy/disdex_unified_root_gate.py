#!/usr/bin/env python3
"""DisDex root-side unified deployment gate (READ-ONLY PREFLIGHT only).

This source deliberately refuses all LIVE mutations until a separately
certified scoped executor, venue/STOP readback and rollback audit exist.
DO NOT present a passing preflight as operator activation or LIVE proof.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import stat
import sys

from disdex_deployment_contract import (
    DEPLOYMENT_TARGET, OPERATOR_TARGET, REPO, ROUTES, SCOPES,
    SHA, PLAN_HASH, validate_order_permission,
)
from disdex_deployment_plan import IDS, digest, validate
from disdex_owner_approval import verify

ROOT = Path("/var/lib/disdex/unified-deploy")
PINS = Path("/etc/disdex/runner-pins.json")
CURRENT = Path("/home/deploy/disdex-trading/current")
RELEASES = Path("/home/deploy/disdex-trading/releases")
PUB = ROOT / "owner-approval-public.pem"
PIN_SCHEMA = "disdex-runner-pin-manifest/v1"
PREFIXES = {
    "V12_V4": "disdex-v12-v4",
    "PENGU_V8": "disdex-pengu-dual-ls-v2",
    "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1",
    "V52": "disdex-v52-aster-only",
    "FET_BRK48_RESIDUAL": "disdex-fet-brk48",
    "HYPE_TREND_LONG": "disdex-hype-long",
    "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short",
    "SHARED_CRYPTO_RISK": "disdex-shared-crypto-risk",
    "MARGIN_GUARD": "disdex-v12-v52-margin-guard",
}
STOP_OWNERS = {
    "V12_V4": "V4_PRIMARY", "PENGU_V8": "PENGU_V8",
    "QUALITY102_CAUSAL_V1": "Q102_PRIMARY", "V52": "V52",
    "FET_BRK48_RESIDUAL": "FET_BRK48_RESIDUAL",
    "HYPE_TREND_LONG": "HYPE_TREND_LONG",
    "IDLE_PRIORITY_SHORT": "IDLE_PRIORITY_SHORT",
    "SHARED_CRYPTO_RISK": "SHARED_RISK", "MARGIN_GUARD": "MARGIN_GUARD",
}

def assert_regular_secure(path: Path, *, root_uid=0, private=False):
    s = path.lstat()  # no following a final symlink
    if not stat.S_ISREG(s.st_mode) or s.st_uid != root_uid:
        raise ValueError("untrusted file type or owner: " + str(path))
    if s.st_mode & (0o077 if private else 0o022):
        raise ValueError("file permissions unsafe: " + str(path))
    return s

def assert_private_dir(path: Path, *, root_uid=0):
    s = path.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != root_uid or s.st_mode & 0o077:
        raise ValueError("root-only directory required: " + str(path))

def read_root_json(path: Path, *, root_uid=0, private=True):
    assert_regular_secure(path, root_uid=root_uid, private=private)
    with path.open("rb") as f:
        b = f.read(65537)
    if len(b) > 65536:
        raise ValueError("oversized root-owned JSON")
    def unique(pairs):
        out = {}
        for k, v in pairs:
            if k in out:
                raise ValueError("duplicate JSON key")
            out[k] = v
        return out
    return json.loads(b, object_pairs_hook=unique)

def release_marker(sha: str, releases=RELEASES, *, root_uid=None):
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("invalid exact release SHA")
    release = releases / sha
    s = release.lstat()
    if not stat.S_ISDIR(s.st_mode):
        raise ValueError("release directory missing or symlinked")
    marker = release / ".disdex-release-sha"
    # Marker itself must be root-owned and protected even if release is
    # readable by the service's deploy user.
    assert_regular_secure(marker, root_uid=(0 if root_uid is None else root_uid))
    if marker.read_text(encoding="ascii").strip() != sha:
        raise ValueError("immutable release marker SHA mismatch")
    return release

def parse_live_pins(manifest: dict):
    if not isinstance(manifest, dict) or manifest.get("schema") != PIN_SCHEMA:
        raise ValueError("current runner pin manifest schema invalid")
    runners = manifest.get("runners")
    if not isinstance(runners, dict) or set(runners) != set(IDS):
        raise ValueError("current pin map incomplete or has unknown runner")
    pins = {}
    for key in IDS:
        entry = runners[key]
        if not isinstance(entry, dict):
            raise ValueError("pin entry invalid: " + key)
        sha = entry.get("sha")
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValueError("pin SHA invalid: " + key)
        if entry.get("serviceUnit") != f"{PREFIXES[key]}@{sha}.service":
            raise ValueError("service unit not exact SHA: " + key)
        if entry.get("releaseRoot") != str(RELEASES / sha):
            raise ValueError("release path not exact SHA: " + key)
        if entry.get("stopOwner") != STOP_OWNERS[key]:
            raise ValueError("STOP ownership differs: " + key)
        if entry.get("evidenceMode") not in ("legacy", "tick-v1"):
            raise ValueError("unrecognized tick mode: " + key)
        pins[key] = sha
    return pins

def validate_bootstrap_plan(desired, current, pins, current_release_sha):
    # current is a root-only operator snapshot; it cannot by itself attest
    # running PIDs/STOPs. Check it against independent current symlink and pins.
    validate(current)
    validate(desired)
    if current["runners"] != pins:
        raise ValueError("current plan is stale vs root runner-pin manifest")
    if current["sourceSha"] != current_release_sha:
        raise ValueError("current plan is stale vs current symlink")
    # Any plan targeting FULL_PROJECT MUST retain a complete SHA mapping.
    plan_hash, diff = digest(desired, current)
    return plan_hash, diff

def preflight(args, token, *, root=ROOT, pins_path=PINS, current=CURRENT,
             releases=RELEASES, root_uid=0):
    if (args.deployment_target != DEPLOYMENT_TARGET
        or args.operator_target != OPERATOR_TARGET
        or not SHA.fullmatch(args.sha)
        or args.scope not in SCOPES or args.route not in ROUTES
        or not PLAN_HASH.fullmatch(args.plan_sha256)):
        raise ValueError("unapproved deployment target or identity")
    orders_enabled = args.orders_enabled == "true"
    validate_order_permission(args.scope, orders_enabled)
    if not isinstance(token, str) or len(token) > 16384 or not token.strip():
        raise ValueError("missing signed approval")
    # The following paths must be provisioned only by a root operator, not
    # by GPT, Actions, or a repo checkout (which may be deploy-writable).
    assert_private_dir(root, root_uid=root_uid)
    assert_private_dir(root / "plans", root_uid=root_uid)
    assert_regular_secure(root / "owner-approval-public.pem", root_uid=root_uid)
    assert_regular_secure(pins_path, root_uid=root_uid)
    assert_private_dir(root / "plans" / args.scope, root_uid=root_uid)
    desired = read_root_json(root / "plans" / args.scope / (args.sha + ".json"),
                             root_uid=root_uid)
    current_plan = read_root_json(root / "current-plan.json", root_uid=root_uid)
    pins = parse_live_pins(read_root_json(pins_path, root_uid=root_uid,
                                           private=False))
    link = current.lstat()
    if not stat.S_ISLNK(link.st_mode):
        raise ValueError("production current is not symlink")
    resolved = current.resolve(strict=True)
    if resolved.parent != releases or not SHA.fullmatch(resolved.name):
        raise ValueError("production current symlink escapes immutable releases")
    release_marker(resolved.name, releases, root_uid=root_uid)
    sha_hash, diff = validate_bootstrap_plan(
        desired, current_plan, pins, resolved.name)
    if sha_hash != args.plan_sha256 or desired["sourceSha"] != args.sha:
        raise ValueError("supplied SHA / plan hash differs from root plan")
    for sha in set(desired["runners"].values()) | {
        desired["sourceSha"], desired["uiSha"], desired["monitorSha"]}:
        release_marker(sha, releases, root_uid=root_uid)
    # Verify signature but DO NOT consume a nonce here: a read-only preflight
    # cannot authorize or burn the owner's one-use LIVE grant.
    payload = verify(token, root / "owner-approval-public.pem", REPO,
                     args.sha, args.scope, args.owner, args.plan_sha256,
                     route=args.route, orders_enabled=orders_enabled)
    if payload["deploymentTarget"] != DEPLOYMENT_TARGET or payload["operatorTarget"] != OPERATOR_TARGET:
        raise ValueError("signed target differs")
    return {
        "status": "READONLY_PREFLIGHT_PASS_NOT_LIVE",
        "targetSha": args.sha,
        "scope": args.scope,
        "route": args.route,
        "ordersEnabled": orders_enabled,
        "planSha256": sha_hash,
        "changedRunners": diff["changedRunners"],
        "unproven": ["OWNER_ENV_CONFIGURATION", "VENUE_STOP_PRESERVATION",
                     "LIVE_SYSTEMD_SHA_READBACK", "ROOT_MUTATING_EXECUTOR",
                     "ROLLBACK", "POST_CUTOVER_3_CYCLES"],
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--deployment-target", required=True)
    p.add_argument("--operator-target", required=True)
    p.add_argument("--sha", required=True)
    p.add_argument("--scope", required=True, choices=sorted(SCOPES))
    p.add_argument("--plan-sha256", required=True)
    p.add_argument("--orders-enabled", required=True, choices=("true", "false"))
    p.add_argument("--route", required=True, choices=sorted(ROUTES))
    p.add_argument("--owner", required=True)
    p.add_argument("--read-approval-stdin", action="store_true")
    p.add_argument("--preflight-readonly", action="store_true")
    args = p.parse_args()
    try:
        if os.geteuid() != 0:
            raise ValueError("root authority required")
        if not args.read_approval_stdin:
            raise ValueError("stdin owner approval is mandatory")
        if not args.preflight_readonly:
            # Phase 1 MUST reject LIVE cutover, even with a valid owner token.
            raise ValueError("LIVE_EXECUTOR_NOT_CERTIFIED: NO MUTATION PERMITTED")
        raw = sys.stdin.read(16385)
        if len(raw) > 16384:
            raise ValueError("owner approval too large")
        result = preflight(args, raw.strip())
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print("DISDEX_ROOT_DEPLOY_BLOCKED:" + str(e), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
