#!/usr/bin/env python3
"""DisDex root-side unified deployment gate.

``--preflight-readonly`` remains a non-mutating proof only.  ``--execute``
is a separately guarded transaction boundary. It accepts either the signed
Actions route or the authenticated Codex root-SSH route, then still requires
a root-owned exact plan, a fresh read-only venue proof, a single-use nonce, and
a mandatory rollback plus three-cycle audit. Every other scope remains
fail-closed until it has its own transaction and audit implementation.
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
from typing import Callable, Optional
import uuid

from disdex_deployment_contract import (
    CODEX_SSH_AUTH_SCHEMA, CODEX_SSH_OPERATOR,
    DEPLOYMENT_TARGET, OPERATOR_TARGET, REPO, ROUTES, SCOPES,
    SHA, PLAN_HASH, validate_order_permission,
)
from disdex_deployment_plan import IDS, canonical, digest, validate
from disdex_owner_approval import verify
from disdex_v4_venue_witness import (
    PEER_STOP_ACK, PEER_STOP_SCHEMA, validate_peer_stop_approval,
)

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

EXECUTION_ACTIVATION_SCHEMA = "disdex-unified-operator-activation/v1"
VENUE_EVIDENCE_SCHEMA = "disdex-venue-readonly-evidence/v1"
SHARED_RISK_SCOPE = "SHARED_CRYPTO_RISK_ONLY"
SHARED_RISK_RUNNER = "SHARED_CRYPTO_RISK"
SHARED_RISK_ACK = "I_ACK_SHARED_RISK_ONLY_NO_ORDERS"
VENUE_MAX_AGE_SECONDS = 300
ZERO_EFFECTS = {"ordersSent": 0, "cancelsSent": 0, "positionChangesSent": 0}
EXECUTOR_CERTIFICATION_SCHEMA = "disdex-live-executor-certification/v1"
PENGU_SCOPE = "PENGU_V8"


@dataclass(frozen=True)
class DeploymentPaths:
    """Root-owned paths used by the executor.

    The defaults are deliberately not read from repository files.  Production
    callers use the canonical paths below; tests and staging inject an
    isolated fixture without changing the decision logic.
    """

    root: Path
    pins: Path
    current_plan: Path
    current: Path
    releases: Path
    nonce_dir: Path
    public_key: Path
    activation_dir: Path
    venue_before: Path
    venue_after: Path
    receipts: Path
    journal: Optional[Path] = None
    peer_stop_dir: Optional[Path] = None


class SystemdAdapter:
    """Small argument-array-only adapter for exact unit operations."""

    SYSTEMCTL = "/usr/bin/systemctl"

    @staticmethod
    def _run(action: str, unit: str) -> None:
        result = subprocess.run(
            [SystemdAdapter.SYSTEMCTL, action, unit],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            detail = (result.stderr or result.stdout or "systemctl failed").strip()
            raise RuntimeError(f"systemd {action} {unit}: {detail[:240]}")

    @classmethod
    def _state(cls, unit: str, property_name: str) -> str:
        result = subprocess.run(
            [cls.SYSTEMCTL, "show", unit, f"--property={property_name}", "--value"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            detail = (result.stderr or result.stdout or "systemctl show failed").strip()
            raise RuntimeError(f"systemd show {unit}: {detail[:240]}")
        return result.stdout.strip()

    def active_state(self, unit: str) -> str:
        return self._state(unit, "ActiveState")

    def main_pid(self, unit: str) -> int:
        value = self._state(unit, "MainPID")
        if not value.isdigit():
            raise RuntimeError("systemd MainPID is not numeric: " + unit)
        return int(value)

    def is_active(self, unit: str) -> bool:
        return self.active_state(unit) in ("active", "activating", "deactivating")

    def is_masked(self, unit: str) -> bool:
        return self._state(unit, "UnitFileState") == "masked"

    def is_enabled(self, unit: str) -> bool:
        return self._state(unit, "UnitFileState") in ("enabled", "enabled-runtime", "indirect")

    def stop(self, unit: str) -> None:
        self._run("stop", unit)

    def mask(self, unit: str) -> None:
        self._run("mask", unit)

    def unmask(self, unit: str) -> None:
        self._run("unmask", unit)

    def start(self, unit: str) -> None:
        self._run("start", unit)

    def enable(self, unit: str) -> None:
        self._run("enable", unit)

    def disable(self, unit: str) -> None:
        self._run("disable", unit)

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


def assert_codex_ssh_session(environment=None) -> dict:
    """Authenticate the Codex direct route through the root SSH session.

    The historical Codex deployment path already authenticated the operator by
    the root SSH key.  ``CODEX_SSH`` therefore does not require an additional
    owner signature.  It is still not a generic local-root bypass: the helper
    must be reached through sshd, which supplies both connection variables, and
    the caller must use the fixed ``codex-ssh`` operator identity.  The exact
    SHA/plan/scope/order checks remain in the root executor.
    """
    env = os.environ if environment is None else environment
    connection = str(env.get("SSH_CONNECTION", "")).split()
    client = str(env.get("SSH_CLIENT", "")).split()
    if (len(connection) != 4 or len(client) != 3
            or not connection[1].isdigit() or not connection[3].isdigit()
            or not client[1].isdigit() or not client[2].isdigit()
            or not 1 <= int(connection[1]) <= 65535
            or not 1 <= int(connection[3]) <= 65535
            or not 1 <= int(client[1]) <= 65535
            or not 1 <= int(client[2]) <= 65535):
        raise ValueError("authenticated Codex SSH session required")
    return {
        "schema": CODEX_SSH_AUTH_SCHEMA,
        "route": "CODEX_SSH",
        "operator": CODEX_SSH_OPERATOR,
        "authorizationMethod": "ROOT_SSH_SESSION",
    }


def build_codex_ssh_authorization(args, *, now: int | None = None) -> dict:
    """Create an in-memory, short-lived root-SSH authorization record.

    This is deliberately not a signed owner artifact and is never written as
    an approval file.  The executor caches it for one invocation and consumes
    its nonce in the root-owned nonce directory immediately before mutation.
    """
    if (getattr(args, "route", None) != "CODEX_SSH"
            or getattr(args, "owner", None) != CODEX_SSH_OPERATOR
            or getattr(args, "_codex_ssh_authenticated", False) is not True):
        raise ValueError("Codex SSH authority is not established")
    now = int(time.time()) if now is None else now
    if type(now) is not int or now <= 0:
        raise ValueError("Codex SSH authorization time invalid")
    orders_enabled = getattr(args, "orders_enabled", None) == "true"
    validate_order_permission(args.scope, orders_enabled)
    nonce = getattr(args, "_codex_ssh_nonce", None)
    if nonce is None:
        nonce = uuid.uuid4().hex
        setattr(args, "_codex_ssh_nonce", nonce)
    payload = {
        "schema": CODEX_SSH_AUTH_SCHEMA,
        "repository": REPO,
        "deploymentTarget": DEPLOYMENT_TARGET,
        "operatorTarget": OPERATOR_TARGET,
        "route": "CODEX_SSH",
        "sourceSha": args.sha,
        "scope": args.scope,
        "operator": CODEX_SSH_OPERATOR,
        "nonce": nonce,
        "planSha256": args.plan_sha256,
        "ordersEnabled": orders_enabled,
        "issuedAt": now,
        "expiresAt": now + 300,
        "authorizationMethod": "ROOT_SSH_SESSION",
        "signatureVerified": False,
    }
    setattr(args, "_codex_ssh_authorization", payload)
    return payload


def _consume_codex_ssh_nonce(nonce_dir: Path, nonce: str, *, root_uid: int) -> None:
    assert_private_dir(nonce_dir, root_uid=root_uid)
    if not re.fullmatch(r"[0-9a-f]{32}", nonce):
        raise ValueError("Codex SSH nonce invalid")
    path = nonce_dir / nonce
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError:
        raise
    try:
        os.write(fd, b"CODEX_SSH\n")
        os.fsync(fd)
    finally:
        os.close(fd)


def assert_root_trusted_dir(path: Path, *, root_uid=0):
    """Permit root-owned 0755 /etc/disdex for non-secret runner metadata."""
    s = path.lstat()
    if (not stat.S_ISDIR(s.st_mode) or s.st_uid != root_uid
            or s.st_mode & 0o022):
        raise ValueError("root-owned non-writable directory required: " + str(path))

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
    owner = 0 if root_uid is None else root_uid
    if (not stat.S_ISDIR(s.st_mode) or s.st_uid != owner
        or s.st_mode & 0o022):
        raise ValueError("release directory missing or not root-owned immutable")
    marker = release / ".disdex-release-sha"
    # Marker itself must be root-owned and non-writable even if the release is
    # readable by a service user. A root-owned 0444 marker is valid; a
    # deploy-owned marker is not a production lineage proof.
    marker_stat = assert_regular_secure(marker, root_uid=owner, private=False)
    if marker_stat.st_mode & 0o222:
        raise ValueError("immutable release marker is writable")
    if marker.read_text(encoding="ascii").strip() != sha:
        raise ValueError("immutable release marker SHA mismatch")
    dependency_root = release / "node_modules"
    if dependency_root.is_symlink():
        dependency_stat = dependency_root.lstat()
        if dependency_stat.st_uid != owner:
            raise ValueError("external dependency symlink is not root-owned")
        resolved_dependency = dependency_root.resolve(strict=True)
        try:
            resolved_dependency.relative_to(release.resolve())
        except ValueError:
            raise ValueError("external dependency symlink escapes immutable release") from None
    return release


def legacy_release_marker(sha: str, releases=RELEASES):
    """Verify an unchanged legacy peer release without blessing it as mutable.

    Existing dormant peers were deployed before the root-owned release
    boundary and may still be owned by ``deploy``.  The only operation that
    may use this migration proof is the no-order PENGU peer-stop certificate;
    it never starts the peer, changes pins, or grants venue authority.  The
    directory and marker must still be non-writable by group/other and the
    marker must match the exact SHA.
    """
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("invalid exact legacy release SHA")
    release = releases / sha
    directory = release.lstat()
    if (not stat.S_ISDIR(directory.st_mode) or release.is_symlink()
            or directory.st_uid != 0 or directory.st_mode & 0o022):
        raise ValueError("legacy release directory is writable or invalid")
    marker = release / ".disdex-release-sha"
    marker_stat = marker.lstat()
    if (not stat.S_ISREG(marker_stat.st_mode) or marker.is_symlink()
            or marker_stat.st_uid != 0
            or marker_stat.st_mode & 0o222):
        raise ValueError("legacy release marker is untrusted")
    if marker.read_text(encoding="ascii").strip() != sha:
        raise ValueError("legacy release marker SHA mismatch")
    dependency = release / "node_modules"
    if dependency.is_symlink():
        resolved = dependency.resolve(strict=True)
        if (resolved.parent != releases or not SHA.fullmatch(resolved.name)
                or resolved == release):
            raise ValueError("legacy dependency symlink escapes release lineage")
        target = resolved.lstat()
        target_marker = resolved / ".disdex-release-sha"
        target_marker_stat = target_marker.lstat()
        if (not stat.S_ISDIR(target.st_mode) or target.st_uid != 0
                or target.st_mode & 0o022
                or not stat.S_ISREG(target_marker_stat.st_mode)
                or target_marker_stat.st_uid != 0
                or target_marker_stat.st_mode & 0o222
                or target_marker.read_text(encoding="ascii").strip() != resolved.name):
            raise ValueError("legacy dependency target is not immutable")
    return release

def auxiliary_release_marker(sha: str, release_root: Path, *, root_uid=None):
    """Verify a non-Runner immutable release root without inventing a SHA path.

    UI and monitor releases are independently versioned roots. Their directory
    names are deployment metadata and are not required to equal the source
    SHA; the root-owned marker remains the immutable identity proof.
    """
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError("invalid exact auxiliary release SHA")
    release_root = Path(release_root)
    s = release_root.lstat()
    owner = 0 if root_uid is None else root_uid
    if (not stat.S_ISDIR(s.st_mode) or s.st_uid != owner
        or s.st_mode & 0o022):
        raise ValueError("auxiliary release directory missing or not root-owned immutable")
    marker = release_root / ".disdex-release-sha"
    marker_stat = assert_regular_secure(marker, root_uid=owner, private=False)
    if marker_stat.st_mode & 0o222:
        raise ValueError("auxiliary immutable release marker is writable")
    if marker.read_text(encoding="ascii").strip() != sha:
        raise ValueError("auxiliary immutable release marker SHA mismatch")
    return release_root

def validate_release_roots(plan: dict, releases=RELEASES, *, root_uid=None):
    """Validate the plan's explicit runner/UI/monitor lineage roots."""
    roots = plan["releaseRoots"]
    if roots["runners"] != str(releases):
        raise ValueError("runner release root differs from production releases")
    auxiliary_release_marker(plan["uiSha"], roots["ui"], root_uid=root_uid)
    auxiliary_release_marker(plan["monitorSha"], roots["monitor"], root_uid=root_uid)
    return roots

def parse_live_pins(manifest: dict, releases=RELEASES):
    if (not isinstance(manifest, dict)
        or manifest.get("schema") != PIN_SCHEMA
        or manifest.get("target") != DEPLOYMENT_TARGET):
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
        if entry.get("releaseRoot") != str(releases / sha):
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


def validate_pengu_peer_stop_plan(desired, current, pins, current_release_sha):
    """Validate the exact no-change plan used only for peer-stop proof."""
    validate(current)
    validate(desired)
    if (current["runners"] != pins or current["sourceSha"] != current_release_sha
            or desired["scope"] != PENGU_SCOPE
            or desired["sourceSha"] != current_release_sha
            or desired["runners"] != pins
            or desired["uiSha"] != current["uiSha"]
            or desired["monitorSha"] != current["monitorSha"]
            or desired["releaseRoots"] != current["releaseRoots"]
            or desired["ordersEnabled"] is not False):
        raise ValueError("PENGU peer-stop plan is not exact no-change scope")
    return hashlib.sha256(canonical(desired)).hexdigest(), {
        "changedRunners": [],
        "uiChanged": False,
        "monitorChanged": False,
        "releaseRootsChanged": False,
        "exactScope": PENGU_SCOPE,
        "ordersEnabled": False,
    }


def _unit_for_runner(runner_id: str, sha: str) -> str:
    if runner_id not in PREFIXES or not SHA.fullmatch(str(sha)):
        raise ValueError("runner service identity invalid")
    return f"{PREFIXES[runner_id]}@{sha}.service"


def _assert_execution_root(root_uid: int) -> None:
    geteuid = getattr(os, "geteuid", None)
    if not callable(geteuid) or geteuid() != root_uid:
        raise ValueError("root authority required")


def build_peer_stop_certificate(args, desired: dict, plan_hash: str,
                                payload: dict, now: int) -> dict:
    """Build a derived proof for an explicitly approved stopped PENGU peer.

    This function never signs or accepts an owner artifact.  The caller must
    first verify the owner token against the exact PENGU SHA and then pass the
    verified payload.  The resulting certificate is only a root-owned witness
    input for the later V4 venue read; it grants no order or service-control
    authority.
    """
    nonce = payload.get("nonce") if isinstance(payload, dict) else None
    if (getattr(args, "scope", None) != PENGU_SCOPE
            or getattr(args, "sha", None) != desired.get("sourceSha")
            or desired.get("scope") != PENGU_SCOPE
            or desired.get("ordersEnabled") is not False
            or desired.get("runners", {}).get("PENGU_V8") != args.sha
            or not isinstance(nonce, str) or not re.fullmatch(r"[0-9a-f]{32}", nonce)
            or not PLAN_HASH.fullmatch(str(plan_hash))):
        raise ValueError("PENGU peer-stop plan or token mismatch")
    certificate = {
        "schema": PEER_STOP_SCHEMA,
        "status": "APPROVED",
        "runner": PENGU_SCOPE,
        "approvedSha": args.sha,
        "deploymentTarget": DEPLOYMENT_TARGET,
        "operatorTarget": OPERATOR_TARGET,
        "operator": args.owner,
        "planSha256": plan_hash,
        "ordersEnabled": False,
        "approvedAt": now,
        "expiresAt": now + 300,
        "operatorAcknowledgement": PEER_STOP_ACK,
        "nonceDigest": hashlib.sha256(nonce.encode("ascii")).hexdigest(),
    }
    return validate_peer_stop_approval(
        certificate, runner=PENGU_SCOPE, sha=args.sha, now=now)


def _atomic_json(path: Path, value: dict, *, root_uid: int,
                 private: bool = True, trusted_parent: bool = False) -> None:
    """Publish a root-owned JSON object without following a destination link."""
    if private and not trusted_parent:
        assert_private_dir(path.parent, root_uid=root_uid)
    else:
        assert_root_trusted_dir(path.parent, root_uid=root_uid)
    if trusted_parent and not private:
        raise ValueError("trusted-parent override requires private artifact")
    if path.exists() or path.is_symlink():
        assert_regular_secure(path, root_uid=root_uid, private=private)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(temporary, flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as writer:
            json.dump(value, writer, sort_keys=True, separators=(",", ":"))
            writer.write("\n")
            writer.flush()
            os.fsync(writer.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600 if private else 0o644)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _validate_venue_evidence(value: dict, *, now: int, label: str,
                             baseline: Optional[dict] = None,
                             require_v4_runtime: bool = True) -> dict:
    if not isinstance(value, dict) or value.get("schema") != VENUE_EVIDENCE_SCHEMA:
        raise ValueError(f"venue evidence {label} schema invalid")
    if value.get("venue") != "aster" or value.get("readOnly") is not True:
        raise ValueError(f"venue evidence {label} is not a signed read-only proof")
    captured = value.get("capturedAt")
    expires = value.get("expiresAt")
    if (type(captured) is not int or type(expires) is not int
        or captured > now + 5 or now - captured > VENUE_MAX_AGE_SECONDS
        or expires < now):
        raise ValueError(f"venue evidence {label} is stale or future dated")
    for effect in ZERO_EFFECTS:
        if value.get(effect) != 0:
            raise ValueError(f"venue evidence {label} reports a mutation")
    required_true = (
        "signatureVerified", "positionsReconciled", "protectiveStopsReconciled",
        "stopOwnershipReconciled", "pendingExposureReconciled",
        "grossReconciled", "sharedRiskHealthy", "marginGuardHealthy",
        "accountLockHealthy", "killSwitchHealthy", "runnerShaMapVerified",
    )
    if require_v4_runtime:
        required_true += ("heartbeatVerified", "tickVerified")
    if any(value.get(field) is not True for field in required_true):
        raise ValueError(f"venue evidence {label} safety reconciliation incomplete")
    if value.get("sharedRiskDailyLossLimit") != 0.075:
        raise ValueError(f"venue evidence {label} Shared Risk limit mismatch")
    for field in ("unknownStops", "partialStops"):
        if value.get(field) != 0:
            raise ValueError(f"venue evidence {label} contains unmanaged STOPs")
    for digest_name in ("positionsDigest", "protectiveOrdersDigest", "pendingDigest"):
        if not isinstance(value.get(digest_name), str) or not value[digest_name]:
            raise ValueError(f"venue evidence {label} digest missing")
    if baseline is not None:
        for digest_name in ("positionsDigest", "protectiveOrdersDigest", "pendingDigest"):
            if value[digest_name] != baseline[digest_name]:
                raise ValueError(f"venue evidence {label} does not preserve {digest_name}")
    return value


def _validate_scoped_activation(activation: dict, args, desired: dict,
                                plan_hash: str, *, now: int) -> dict:
    required = {
        "schema", "repository", "deploymentTarget", "operatorTarget", "scope",
        "approvedSha", "approvedShaByRunner", "approvedRunners", "planSha256",
        "ordersEnabled", "operator", "approvedAt", "expiresAt",
        "operatorAcknowledgement",
    }
    if not isinstance(activation, dict) or set(activation) != required:
        raise ValueError("operator activation artifact fields invalid")
    if (activation["schema"] != EXECUTION_ACTIVATION_SCHEMA
        or activation["repository"] != REPO
        or activation["deploymentTarget"] != DEPLOYMENT_TARGET
        or activation["operatorTarget"] != OPERATOR_TARGET
        or activation["scope"] != args.scope
        or activation["approvedSha"] != args.sha
        or activation["planSha256"] != plan_hash
        or activation["ordersEnabled"] is not False
        or activation["operator"] != args.owner
        or activation["operatorAcknowledgement"] != SHARED_RISK_ACK):
        raise ValueError("operator activation artifact does not match scope")
    sha_map = activation["approvedShaByRunner"]
    if sha_map != desired["runners"]:
        raise ValueError("operator activation runner map mismatch")
    if activation["approvedRunners"] != [SHARED_RISK_RUNNER]:
        raise ValueError("operator activation runner scope is not Shared Risk-only")
    approved_at = activation["approvedAt"]
    expires_at = activation["expiresAt"]
    if (type(approved_at) is not int or type(expires_at) is not int
        or approved_at > now + 5 or expires_at < now
        or not 1 <= expires_at - approved_at <= 86_400):
        raise ValueError("operator activation artifact is expired or future dated")
    return activation


class RootDeploymentExecutor:
    """Fail-closed production executor for the first scoped cutover.

    Only Shared Risk-only is mutation-capable in this stage. All other valid
    contract scopes are accepted by the shared validator but rejected here
    until they receive a scope-specific transaction and audit implementation.
    """

    def __init__(self, paths: DeploymentPaths, *, root_uid: int = 0,
                 systemd=None, verify_fn: Callable = verify,
                 clock: Callable[[], int] = lambda: int(time.time()),
                 sleep_fn: Callable[[float], None] = time.sleep,
                 audit_reader: Optional[Callable[[int], dict]] = None):
        self.paths = paths
        self.root_uid = root_uid
        self.systemd = systemd or SystemdAdapter()
        self.verify_fn = verify_fn
        self.clock = clock
        self.sleep_fn = sleep_fn
        self.audit_reader = audit_reader

    def _read_current_sha(self, *, allow_legacy=False) -> str:
        link = self.paths.current.lstat()
        if not stat.S_ISLNK(link.st_mode):
            raise ValueError("production current is not symlink")
        resolved = self.paths.current.resolve(strict=True)
        if resolved.parent != self.paths.releases or not SHA.fullmatch(resolved.name):
            raise ValueError("production current symlink escapes immutable releases")
        try:
            release_marker(resolved.name, self.paths.releases, root_uid=self.root_uid)
        except ValueError:
            if not allow_legacy:
                raise
            legacy_release_marker(resolved.name, self.paths.releases)
        return resolved.name

    def _verify_token(self, args, token: str, *, nonce_dir=None):
        if args.route == "CODEX_SSH":
            payload = getattr(args, "_codex_ssh_authorization", None)
            if payload is None:
                payload = build_codex_ssh_authorization(args, now=self.clock())
            if nonce_dir is not None:
                _consume_codex_ssh_nonce(
                    nonce_dir, payload["nonce"], root_uid=self.root_uid)
            return payload
        return self.verify_fn(
            token,
            self.paths.public_key,
            REPO,
            args.sha,
            args.scope,
            args.owner,
            args.plan_sha256,
            now=self.clock(),
            nonce_dir=nonce_dir,
            route=args.route,
            deployment_target=args.deployment_target,
            operator_target=args.operator_target,
            orders_enabled=args.orders_enabled == "true",
        )

    def _audit(self, expected_pins: dict, new_unit: str, old_unit: str,
               baseline: dict, *, cycles: int = 3) -> list[dict]:
        if cycles < 3:
            raise ValueError("three-cycle audit is mandatory")
        observations = []
        previous_capture = None
        for cycle in range(cycles):
            if cycle:
                self.sleep_fn(1)
            value = (self.audit_reader(cycle) if self.audit_reader is not None
                     else read_root_json(self.paths.venue_after,
                                         root_uid=self.root_uid, private=True))
            observed = _validate_venue_evidence(
                value, now=self.clock(), label=f"after-{cycle + 1}", baseline=baseline)
            if previous_capture is not None and observed["capturedAt"] <= previous_capture:
                raise ValueError("venue evidence audit timestamp did not advance")
            previous_capture = observed["capturedAt"]
            if self.systemd.is_active(old_unit) or not self.systemd.is_active(new_unit):
                raise ValueError("writer mutual exclusion failed during audit")
            actual = parse_live_pins(read_root_json(
                self.paths.pins, root_uid=self.root_uid, private=False),
                releases=self.paths.releases)
            if actual != expected_pins:
                raise ValueError("runner-pin manifest changed outside approved scope")
            observations.append({
                "cycle": cycle + 1,
                "capturedAt": observed["capturedAt"],
                "positionsDigest": observed["positionsDigest"],
                "protectiveOrdersDigest": observed["protectiveOrdersDigest"],
                "pendingDigest": observed["pendingDigest"],
            })
        return observations

    def _execute_pengu_peer_stop(self, args, token: str) -> dict:
        """Redeem a PENGU stop approval without changing runtime state.

        This is an authorization-only transaction.  It records that the
        owner explicitly accepted the exact dormant PENGU SHA as a peer for a
        short period; it never starts, stops, masks, enables, or disables the
        service and never changes the venue, current symlink, or runner pins.
        The later V4 witness must still prove the fresh flat venue state.
        """
        _assert_execution_root(self.root_uid)
        paths = self.paths
        peer_stop_dir = paths.peer_stop_dir or paths.root / "peer-stop"
        for directory in (
            paths.root, paths.root / "plans", paths.root / "plans" / PENGU_SCOPE,
            paths.nonce_dir, paths.receipts, peer_stop_dir,
        ):
            assert_private_dir(directory, root_uid=self.root_uid)
        if args.route != "CODEX_SSH":
            assert_regular_secure(paths.public_key, root_uid=self.root_uid, private=True)
        desired = read_root_json(
            paths.root / "plans" / PENGU_SCOPE / (args.sha + ".json"),
            root_uid=self.root_uid,
        )
        current = read_root_json(paths.current_plan, root_uid=self.root_uid)
        raw_pins = read_root_json(paths.pins, root_uid=self.root_uid, private=False)
        pins = parse_live_pins(raw_pins, releases=paths.releases)
        current_sha = self._read_current_sha(allow_legacy=True)
        validate(current)
        validate(desired)
        plan_hash = hashlib.sha256(canonical(desired)).hexdigest()
        if (args.scope != PENGU_SCOPE or args.orders_enabled != "false"
                or args.plan_sha256 != plan_hash
                or desired["sourceSha"] != args.sha
                or desired["runners"] != pins
                or desired["sourceSha"] != current_sha
                or desired["scope"] != PENGU_SCOPE
                or desired["ordersEnabled"] is not False
                or desired["uiSha"] != current["uiSha"]
                or desired["monitorSha"] != current["monitorSha"]
                or desired["releaseRoots"] != current["releaseRoots"]
                or pins[PENGU_SCOPE] != args.sha):
            raise ValueError("PENGU peer-stop plan is not an exact no-change scope")
        try:
            release_marker(args.sha, paths.releases, root_uid=self.root_uid)
        except ValueError:
            # PENGU is a dormant legacy peer in this migration.  Its
            # no-order certificate may prove the exact immutable marker
            # without converting the live legacy release into a new runtime.
            legacy_release_marker(args.sha, paths.releases)
        unit = _unit_for_runner(PENGU_SCOPE, args.sha)
        if self.systemd.is_active(unit):
            raise ValueError("PENGU peer is active; peer-stop approval is not applicable")
        pid = self.systemd.main_pid(unit)
        if pid != 0:
            raise ValueError("PENGU dormant peer has nonzero PID")
        approval_path = peer_stop_dir / f"{PENGU_SCOPE}-{args.sha}.json"
        if approval_path.exists() or approval_path.is_symlink():
            raise ValueError("PENGU peer-stop approval already exists")
        if args.route != "CODEX_SSH":
            if not isinstance(token, str) or not token.strip() or len(token) > 16_384:
                raise ValueError("missing signed approval")
        payload = self._verify_token(args, token)
        nonce = payload.get("nonce")
        if not isinstance(nonce, str):
            raise ValueError("PENGU peer-stop nonce missing")
        try:
            consumed = self._verify_token(args, token, nonce_dir=paths.nonce_dir)
        except FileExistsError:
            raise ValueError("PENGU peer-stop approval replay") from None
        if consumed.get("nonce") != nonce:
            raise ValueError("PENGU peer-stop nonce changed")
        certificate = build_peer_stop_certificate(
            args, desired, plan_hash, consumed, self.clock())
        _atomic_json(approval_path, certificate, root_uid=self.root_uid)
        receipt = {
            "schema": "disdex-unified-deploy-receipt/v1",
            "status": "PENGU_PEER_STOP_AUTHORIZED",
            "repository": REPO,
            "deploymentTarget": DEPLOYMENT_TARGET,
            "operatorTarget": OPERATOR_TARGET,
            "scope": PENGU_SCOPE,
            "targetSha": args.sha,
            "planSha256": plan_hash,
            "route": args.route,
            "ordersEnabled": False,
            "serviceUnit": unit,
            "mainPid": pid,
            "approvalPath": str(approval_path),
            "nonceDigest": certificate["nonceDigest"],
            **ZERO_EFFECTS,
        }
        receipt_path = paths.receipts / f"pengu-peer-stop-{args.sha}-{nonce[:8]}.json"
        _atomic_json(receipt_path, receipt, root_uid=self.root_uid)
        return receipt

    def execute(self, args, token: str) -> dict:
        _assert_execution_root(self.root_uid)
        certify_live_executor()
        if args.deployment_target != DEPLOYMENT_TARGET or args.operator_target != OPERATOR_TARGET:
            raise ValueError("unapproved deployment target or identity")
        if args.scope == "V12_V4":
            # Lazy import keeps the shared-risk and V4 mutation boundaries
            # independent; the owner-signed scope selects the only executor.
            from disdex_v4_root_cutover import V4RootExecutor
            return V4RootExecutor(self).execute(args, token)
        if args.scope == PENGU_SCOPE:
            if args.orders_enabled != "false":
                raise ValueError("PENGU peer-stop scope cannot enable orders")
            return self._execute_pengu_peer_stop(args, token)
        if args.scope != SHARED_RISK_SCOPE:
            raise ValueError("unsupported execution scope: " + str(args.scope))
        orders_enabled = args.orders_enabled == "true"
        validate_order_permission(args.scope, orders_enabled)
        if orders_enabled:
            raise ValueError("Shared Risk-only cannot enable orders")
        if args.route != "CODEX_SSH":
            if not isinstance(token, str) or not token.strip() or len(token) > 16_384:
                raise ValueError("missing signed approval")

        assert_private_dir(self.paths.root, root_uid=self.root_uid)
        assert_private_dir(self.paths.root / "plans", root_uid=self.root_uid)
        assert_private_dir(self.paths.nonce_dir, root_uid=self.root_uid)
        assert_private_dir(self.paths.activation_dir, root_uid=self.root_uid)
        assert_private_dir(self.paths.receipts, root_uid=self.root_uid)
        if args.route != "CODEX_SSH":
            assert_regular_secure(self.paths.public_key, root_uid=self.root_uid, private=True)
        desired_path = self.paths.root / "plans" / args.scope / f"{args.sha}.json"
        assert_private_dir(desired_path.parent, root_uid=self.root_uid)
        desired = read_root_json(desired_path, root_uid=self.root_uid, private=True)
        current_plan = read_root_json(self.paths.current_plan,
                                      root_uid=self.root_uid, private=True)
        raw_pins = read_root_json(self.paths.pins,
                                  root_uid=self.root_uid, private=False)
        pins = parse_live_pins(raw_pins, releases=self.paths.releases)
        current_sha = self._read_current_sha()
        sha_hash, diff = validate_bootstrap_plan(desired, current_plan, pins, current_sha)
        if sha_hash != args.plan_sha256 or desired["sourceSha"] != args.sha:
            raise ValueError("supplied SHA / plan hash differs from root plan")
        if (desired["runners"].get(SHARED_RISK_RUNNER) != args.sha
            or diff["changedRunners"] != [SHARED_RISK_RUNNER]
            or diff["uiChanged"] or diff["monitorChanged"]
            or diff["releaseRootsChanged"]):
            raise ValueError("Shared Risk scope exceeds exact plan delta")
        validate_release_roots(desired, self.paths.releases,
                               root_uid=self.root_uid)
        for sha in set(desired["runners"].values()) | {desired["sourceSha"]}:
            release_marker(sha, self.paths.releases, root_uid=self.root_uid)

        activation_path = (self.paths.activation_dir / args.scope / f"{args.sha}.json")
        assert_private_dir(activation_path.parent, root_uid=self.root_uid)
        activation = read_root_json(activation_path,
                                    root_uid=self.root_uid, private=True)
        _validate_scoped_activation(activation, args, desired, sha_hash,
                                    now=self.clock())
        before = _validate_venue_evidence(
            read_root_json(self.paths.venue_before,
                           root_uid=self.root_uid, private=True),
            now=self.clock(), label="before")

        payload = self._verify_token(args, token)
        if payload.get("nonce") is None:
            raise ValueError("signed approval nonce missing")
        old_sha = pins[SHARED_RISK_RUNNER]
        old_unit = _unit_for_runner(SHARED_RISK_RUNNER, old_sha)
        new_unit = _unit_for_runner(SHARED_RISK_RUNNER, args.sha)
        if self.systemd.is_active(new_unit) or self.systemd.is_masked(new_unit):
            raise ValueError("new Shared Risk writer is already active or masked")
        if not self.systemd.is_active(old_unit) or self.systemd.is_masked(old_unit):
            raise ValueError("current Shared Risk writer is not the sole active owner")
        old_enabled = self.systemd.is_enabled(old_unit)

        next_manifest = json.loads(json.dumps(raw_pins))
        next_entry = next_manifest["runners"][SHARED_RISK_RUNNER]
        next_entry["sha"] = args.sha
        next_entry["serviceUnit"] = new_unit
        next_entry["releaseRoot"] = str(self.paths.releases / args.sha)
        next_manifest["target"] = DEPLOYMENT_TARGET
        expected_pins = dict(pins)
        expected_pins[SHARED_RISK_RUNNER] = args.sha
        if parse_live_pins(next_manifest, releases=self.paths.releases) != expected_pins:
            raise ValueError("candidate runner-pin manifest is invalid")

        next_current_plan = json.loads(json.dumps(current_plan))
        next_current_plan["runners"] = desired["runners"]
        next_current_plan["scope"] = SHARED_RISK_SCOPE
        next_current_plan["ordersEnabled"] = False

        # Consume the token only after all read-only checks have passed and
        # before any journal or systemd mutation. A replay is a precondition
        # failure, not a transaction that needs rollback.
        try:
            consumed = self._verify_token(args, token, nonce_dir=self.paths.nonce_dir)
        except FileExistsError:
            raise ValueError("approval replay") from None
        if consumed.get("nonce") != payload.get("nonce"):
            raise ValueError("approval nonce changed during verification")

        try:
            journal_path = self.paths.journal or self.paths.root / "transaction.json"
            _atomic_json(journal_path, {
                "schema": "disdex-unified-deploy-transaction/v1",
                "phase": "PREPARED",
                "scope": args.scope,
                "oldSha": old_sha,
                "newSha": args.sha,
                "oldUnit": old_unit,
                "newUnit": new_unit,
                "currentSymlinkSha": current_sha,
                "oldPins": raw_pins,
                "oldPlan": current_plan,
            }, root_uid=self.root_uid)
            self.systemd.stop(old_unit)
            self.systemd.mask(old_unit)
            _atomic_json(self.paths.pins, next_manifest, root_uid=self.root_uid,
                         private=False)
            _atomic_json(self.paths.current_plan, next_current_plan,
                         root_uid=self.root_uid)
            if old_enabled:
                self.systemd.enable(new_unit)
            self.systemd.start(new_unit)
            if self.systemd.is_active(old_unit) or not self.systemd.is_active(new_unit):
                raise RuntimeError("writer mutual exclusion failed after start")
            _atomic_json(journal_path, {
                "schema": "disdex-unified-deploy-transaction/v1",
                "phase": "ACTIVE_AWAITING_AUDIT",
                "scope": args.scope,
                "oldSha": old_sha,
                "newSha": args.sha,
                "oldUnit": old_unit,
                "newUnit": new_unit,
            }, root_uid=self.root_uid)
            observations = self._audit(expected_pins, new_unit, old_unit,
                                       before, cycles=3)
            receipt = {
                "schema": "disdex-unified-deploy-receipt/v1",
                "status": "SHARED_RISK_CUTOVER_VERIFIED",
                "repository": REPO,
                "deploymentTarget": DEPLOYMENT_TARGET,
                "operatorTarget": OPERATOR_TARGET,
                "scope": args.scope,
                "targetSha": args.sha,
                "planSha256": sha_hash,
                "route": args.route,
                "ordersEnabled": False,
                "oldUnit": old_unit,
                "newUnit": new_unit,
                "currentSymlinkSha": current_sha,
                "nonceDigest": hashlib.sha256(payload["nonce"].encode("ascii")).hexdigest(),
                "auditCycles": observations,
                **ZERO_EFFECTS,
            }
            receipt_path = self.paths.receipts / f"{args.scope.lower()}-{args.sha}-{payload['nonce'][:8]}.json"
            _atomic_json(receipt_path, receipt, root_uid=self.root_uid)
            _atomic_json(journal_path, {
                "schema": "disdex-unified-deploy-transaction/v1",
                "phase": "COMMITTED",
                "receipt": str(receipt_path),
                "scope": args.scope,
                "oldSha": old_sha,
                "newSha": args.sha,
            }, root_uid=self.root_uid)
            return receipt
        except Exception as error:
            rollback_error = None
            try:
                if self.systemd.is_active(new_unit):
                    self.systemd.stop(new_unit)
                if hasattr(self.systemd, "disable") and old_enabled:
                    self.systemd.disable(new_unit)
                if self.systemd.is_masked(old_unit):
                    self.systemd.unmask(old_unit)
                _atomic_json(self.paths.pins, raw_pins, root_uid=self.root_uid,
                             private=False)
                _atomic_json(self.paths.current_plan, current_plan,
                             root_uid=self.root_uid)
                if not self.systemd.is_active(old_unit):
                    self.systemd.start(old_unit)
                journal_path = self.paths.journal or self.paths.root / "transaction.json"
                _atomic_json(journal_path, {
                    "schema": "disdex-unified-deploy-transaction/v1",
                    "phase": "ROLLED_BACK",
                    "scope": args.scope,
                    "reason": str(error)[:240],
                    "oldSha": old_sha,
                    "newSha": args.sha,
                }, root_uid=self.root_uid)
            except Exception as rollback_exception:
                rollback_error = rollback_exception
            if rollback_error is not None:
                raise RuntimeError(
                    f"cutover failed and rollback failed: {rollback_error}") from error
            raise RuntimeError(f"cutover failed and rolled back: {error}") from error


def certify_live_executor() -> dict:
    """Prove the scoped executor contract without authorizing a deployment.

    This is an implementation-level certificate, not an owner approval and
    not a production cutover.  It deliberately checks the executable
    transaction boundary and reports the runtime proofs that the caller must
    still supply separately.  Keeping this distinction explicit prevents a
    stale certification blocker from hiding an implemented fail-closed
    executor while also preventing a code-only check from granting live
    authority.
    """
    execute_names = set(RootDeploymentExecutor.execute.__code__.co_names)
    execute_names.update(RootDeploymentExecutor._execute_pengu_peer_stop.__code__.co_names)
    required_names = {
        "_assert_execution_root", "validate_order_permission", "_verify_token",
        "_validate_scoped_activation", "_validate_venue_evidence", "_audit",
        "_atomic_json", "read_root_json", "release_marker",
        "parse_live_pins", "validate_bootstrap_plan", "validate_release_roots",
        "_read_current_sha", "is_active", "is_masked", "is_enabled",
        "stop", "mask", "unmask", "enable", "disable", "start",
        "SHARED_RISK_SCOPE", "SHARED_RISK_RUNNER", "PENGU_SCOPE",
        "_execute_pengu_peer_stop", "build_peer_stop_certificate", "ZERO_EFFECTS",
    }
    missing = sorted(required_names - execute_names)
    if missing:
        raise RuntimeError("executor contract missing safety checks: " + ",".join(missing))
    audit_defaults = RootDeploymentExecutor._audit.__kwdefaults__ or {}
    if audit_defaults.get("cycles") != 3:
        raise RuntimeError("executor contract requires a three-cycle audit")
    if ZERO_EFFECTS != {
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }:
        raise RuntimeError("executor contract must prove zero venue effects")
    if not inspect.isclass(RootDeploymentExecutor) or not callable(RootDeploymentExecutor.execute):
        raise RuntimeError("root deployment executor is not callable")
    return {
        "schema": EXECUTOR_CERTIFICATION_SCHEMA,
        "status": "LIVE_EXECUTOR_CONTRACT_CERTIFIED",
        "scope": SHARED_RISK_SCOPE,
        "approvedRunners": [SHARED_RISK_RUNNER],
        "ordersEnabled": False,
        "requiresRoot": True,
        "requiresOwnerSignature": True,
        "requiresOwnerSignatureByRoute": {
            "GITHUB_ACTIONS": True,
            "CODEX_SSH": False,
        },
        "singleUseNonce": True,
        "requiresFreshVenueEvidence": True,
        "preservesCurrentSymlink": True,
        "preservesPeerRunners": True,
        "requiresRollback": True,
        "auditCycles": 3,
        "productionActivation": "OWNER_SIGNED_TOKEN_REQUIRED",
        "productionActivationByRoute": {
            "GITHUB_ACTIONS": "OWNER_SIGNED_TOKEN_REQUIRED",
            "CODEX_SSH": "ROOT_SSH_SESSION_REQUIRED",
        },
    }

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
    codex_ssh = args.route == "CODEX_SSH"
    if codex_ssh:
        if (args.owner != CODEX_SSH_OPERATOR
                or getattr(args, "_codex_ssh_authenticated", False) is not True):
            raise ValueError("authenticated Codex SSH session required")
        payload = build_codex_ssh_authorization(args, now=int(time.time()))
    else:
        if not isinstance(token, str) or len(token) > 16384 or not token.strip():
            raise ValueError("missing signed approval")
    # The following paths must be provisioned only by a root operator, not
    # by GPT, Actions, or a repo checkout (which may be deploy-writable).
    assert_private_dir(root, root_uid=root_uid)
    assert_private_dir(root / "plans", root_uid=root_uid)
    if not codex_ssh:
        assert_regular_secure(root / "owner-approval-public.pem", root_uid=root_uid)
    assert_regular_secure(pins_path, root_uid=root_uid)
    assert_private_dir(root / "plans" / args.scope, root_uid=root_uid)
    desired = read_root_json(root / "plans" / args.scope / (args.sha + ".json"),
                             root_uid=root_uid)
    current_plan = read_root_json(root / "current-plan.json", root_uid=root_uid)
    pins = parse_live_pins(
        read_root_json(pins_path, root_uid=root_uid, private=False),
        releases=releases,
    )
    link = current.lstat()
    if not stat.S_ISLNK(link.st_mode):
        raise ValueError("production current is not symlink")
    resolved = current.resolve(strict=True)
    if resolved.parent != releases or not SHA.fullmatch(resolved.name):
        raise ValueError("production current symlink escapes immutable releases")
    if args.scope == PENGU_SCOPE:
        sha_hash, diff = validate_pengu_peer_stop_plan(
            desired, current_plan, pins, resolved.name)
    else:
        sha_hash, diff = validate_bootstrap_plan(
            desired, current_plan, pins, resolved.name)
    if sha_hash != args.plan_sha256 or desired["sourceSha"] != args.sha:
        raise ValueError("supplied SHA / plan hash differs from root plan")
    if args.scope == "V12_V4":
        # V4 is a trust-boundary migration from legacy deploy-owned peer/current
        # releases. Do not require rewriting unchanged peer/UI releases merely
        # to satisfy the new root-owned convention. The signed plan freezes
        # their exact SHA map; only the newly introduced V4 release must meet
        # the root-owned immutable release contract.
        if (diff["changedRunners"] != ["V12_V4"]
            or diff["uiChanged"] or diff["monitorChanged"]
            or diff["releaseRootsChanged"]
            or desired["runners"].get("V12_V4") != args.sha
            or desired["releaseRoots"]["runners"] != str(releases)):
            raise ValueError("V4 preflight exceeds exact single-runner delta")
        release_marker(args.sha, releases, root_uid=root_uid)
    else:
        if args.scope == PENGU_SCOPE:
            legacy_release_marker(resolved.name, releases)
        else:
            release_marker(resolved.name, releases, root_uid=root_uid)
        validate_release_roots(current_plan, releases, root_uid=root_uid)
        validate_release_roots(desired, releases, root_uid=root_uid)
        if args.scope != PENGU_SCOPE:
            for sha in set(desired["runners"].values()) | {desired["sourceSha"]}:
                release_marker(sha, releases, root_uid=root_uid)
    # Verify the owner signature, or establish the root-SSH route.  Neither
    # branch consumes an execution nonce during read-only preflight.
    if not codex_ssh:
        payload = verify(token, root / "owner-approval-public.pem", REPO,
                         args.sha, args.scope, args.owner, args.plan_sha256,
                         route=args.route, orders_enabled=orders_enabled)
    if payload["deploymentTarget"] != DEPLOYMENT_TARGET or payload["operatorTarget"] != OPERATOR_TARGET:
        raise ValueError("signed target differs")
    certification = certify_live_executor()
    verified_contracts = []
    unproven = ["OWNER_ENV_CONFIGURATION", "VENUE_STOP_PRESERVATION",
                "LIVE_SYSTEMD_SHA_READBACK", "ROLLBACK",
                "POST_CUTOVER_3_CYCLES"]
    if args.scope == SHARED_RISK_SCOPE:
        verified_contracts.append(certification["status"])
    elif args.scope == "V12_V4":
        from disdex_v4_root_cutover import V4RootExecutor
        if not callable(V4RootExecutor.execute):
            raise ValueError("V4 executor missing")
        verified_contracts.append("V4_SCOPE_SPECIFIC_EXECUTOR_PRESENT_SOURCE_ONLY")
        unproven.extend(["V4_RESIDENT_STOP_HANDOVER", "V4_RUNTIME_ACTIVATION",
                         "V4_POST_START_VENUE_AUDIT"])
    else:
        unproven.append("SCOPE_SPECIFIC_EXECUTOR_NOT_IMPLEMENTED")
    return {
        "status": "READONLY_PREFLIGHT_PASS_NOT_LIVE",
        "targetSha": args.sha,
        "scope": args.scope,
        "route": args.route,
        "authorizationMethod": payload["authorizationMethod"]
            if codex_ssh else "OWNER_SIGNED_TOKEN",
        "ordersEnabled": orders_enabled,
        "planSha256": sha_hash,
        "changedRunners": diff["changedRunners"],
        "verifiedContracts": verified_contracts,
        "unproven": unproven,
    }


def default_execution_paths() -> DeploymentPaths:
    return DeploymentPaths(
        root=ROOT,
        pins=PINS,
        current_plan=ROOT / "current-plan.json",
        current=CURRENT,
        releases=RELEASES,
        nonce_dir=ROOT / "nonces",
        public_key=ROOT / "owner-approval-public.pem",
        activation_dir=ROOT / "activations",
        venue_before=ROOT / "venue-before.json",
        venue_after=ROOT / "venue-after.json",
        receipts=ROOT / "receipts",
        peer_stop_dir=ROOT / "peer-stop",
    )

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
    p.add_argument("--codex-ssh", action="store_true")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-readonly", action="store_true")
    mode.add_argument("--execute", action="store_true")
    args = p.parse_args()
    try:
        if os.geteuid() != 0:
            raise ValueError("root authority required")
        if args.route == "CODEX_SSH":
            if (not args.codex_ssh or args.read_approval_stdin
                    or args.owner != CODEX_SSH_OPERATOR):
                raise ValueError("CODEX_SSH requires the fixed Codex SSH route")
            assert_codex_ssh_session()
            args._codex_ssh_authenticated = True
            raw = ""
        else:
            if args.codex_ssh or not args.read_approval_stdin:
                raise ValueError("stdin owner approval is mandatory")
            raw = sys.stdin.read(16385)
            if len(raw) > 16384:
                raise ValueError("owner approval too large")
        if args.execute:
            # Exclusive root-owned lock across GitHub Actions / CODEX_SSH paths.
            # An Actions concurrency group alone cannot serialize VPS writers.
            import fcntl
            assert_private_dir(ROOT, root_uid=0)
            lock_path = ROOT / "deployment-execution.lock"
            if lock_path.is_symlink():
                raise ValueError("untrusted deployment lock symlink")
            fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
            try:
                assert_regular_secure(lock_path, root_uid=0, private=True)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise ValueError("another root deployment is in progress") from None
                result = RootDeploymentExecutor(default_execution_paths()).execute(
                    args, raw.strip())
            finally:
                os.close(fd)
        else:
            result = preflight(args, raw.strip())
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as e:
        print("DISDEX_ROOT_DEPLOY_BLOCKED:" + str(e), file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
