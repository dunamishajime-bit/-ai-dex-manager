#!/usr/bin/env python3
"""Exact-scope V12_V4 live transaction. No shell/canary/order-test fallback.

The root caller supplies already provisioned immutable releases, a root-only plan,
a fresh signed venue attestation, and a one-use owner token. No prerequisites
are synthesized or weakened by this executor.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import stat

from disdex_deployment_contract import DEPLOYMENT_TARGET, OPERATOR_TARGET, REPO, SHA, validate_order_permission
from disdex_unified_root_gate import (
    EXECUTION_ACTIVATION_SCHEMA, ZERO_EFFECTS, SHARED_RISK_SCOPE,
    _assert_execution_root, _atomic_json, _unit_for_runner,
    _validate_venue_evidence, assert_private_dir, assert_root_trusted_dir, assert_regular_secure,
    read_root_json, release_marker, validate_release_roots,
    parse_live_pins, validate_bootstrap_plan,
)

V4_SCOPE = "V12_V4"
V4_RUNNER = "V12_V4"
V4_ACK = "I_ACK_V12_V4_FULL_LIVE_PRESERVE_RESIDENT_STOP"
RUNTIME_ACK = "I_ACK_REAL_MONEY_LIVE_ACTIVATION"
RUNTIME_SCHEMA = "disdex-live-operator-activation/v1"
RUNTIME_TARGET = "DD1296_FINAL_ALLIN_10BPS"
RUNTIME_APPROVAL = Path("/var/lib/disdex/shared/operator-activation/v12-v4-full.json")

def _legacy_transition_current_sha(paths) -> str:
    """Read exact production current SHA without blessing legacy ownership.

    This is only a migration identity check. The *candidate* V4 release must
    still satisfy the root-owned immutable marker contract.
    """
    link = paths.current.lstat()
    if not stat.S_ISLNK(link.st_mode):
        raise ValueError("production current is not symlink")
    resolved = paths.current.resolve(strict=True)
    if resolved.parent != paths.releases or not SHA.fullmatch(resolved.name):
        raise ValueError("production current symlink escapes immutable releases")
    return resolved.name


def _validate_old_v4_baseline(systemd, unit: str) -> tuple[bool, str, int]:
    if systemd.is_masked(unit):
        raise ValueError("old V4 baseline is masked")
    state = systemd.active_state(unit)
    pid = systemd.main_pid(unit)
    active = systemd.is_active(unit)
    if active:
        if state != "active" or pid <= 0:
            raise ValueError("old V4 active baseline PID/state invalid")
    else:
        if state not in ("failed", "inactive") or pid != 0:
            raise ValueError("old V4 dormant baseline is not proven PID 0")
    return active, state, pid


def validate_v4_activation(activation, args, desired, plan_hash, now):
    fields = {
        "schema", "repository", "deploymentTarget", "operatorTarget",
        "scope", "approvedSha", "approvedShaByRunner", "approvedRunners",
        "planSha256", "ordersEnabled", "operator", "approvedAt", "expiresAt",
        "operatorAcknowledgement",
    }
    if not isinstance(activation, dict) or set(activation) != fields:
        raise ValueError("V4 activation schema or fields invalid")
    checks = (
        activation["schema"] == EXECUTION_ACTIVATION_SCHEMA,
        activation["repository"] == REPO,
        activation["deploymentTarget"] == DEPLOYMENT_TARGET,
        activation["operatorTarget"] == OPERATOR_TARGET,
        activation["scope"] == V4_SCOPE,
        activation["approvedSha"] == args.sha,
        activation["planSha256"] == plan_hash,
        activation["approvedShaByRunner"] == desired["runners"],
        activation["approvedRunners"] == [V4_RUNNER],
        activation["ordersEnabled"] is True,
        activation["operator"] == args.owner,
        activation["operatorAcknowledgement"] == V4_ACK,
    )
    if not all(checks):
        raise ValueError("V4 operator activation does not match signed exact scope")
    start, end = activation["approvedAt"], activation["expiresAt"]
    if (type(start) is not int or type(end) is not int or start > now + 5
            or end <= now or end - start < 1 or end - start > 3600):
        raise ValueError("V4 activation freshness invalid")
    return activation


def runtime_activation(activation, sha):
    # PreStart operator gate accepts full live, but does not itself authorize
    # trading: the exact-scope root grant + venue checks are mandatory first.
    from datetime import datetime, timezone
    return {
        "schema": RUNTIME_SCHEMA,
        "approvedSha": sha,
        "approvedShaByRunner": activation["approvedShaByRunner"],
        "approvedRunners": [V4_RUNNER],
        "target": RUNTIME_TARGET,
        "ordersEnabled": True,
        "activationClass": "FULL_LIVE",
        "operatorAcknowledgement": RUNTIME_ACK,
        "approvedAt": datetime.fromtimestamp(activation["approvedAt"], tz=timezone.utc).isoformat(),
    }


class V4RootExecutor:
    """V4 only. Shared Risk implementation is not widened or bypassed."""

    def __init__(self, common, *, runtime_approval=RUNTIME_APPROVAL):
        self.common = common
        self.runtime_approval = Path(runtime_approval)

    def execute(self, args, token):
        c = self.common
        paths = c.paths
        _assert_execution_root(c.root_uid)
        if (args.deployment_target != DEPLOYMENT_TARGET or
                args.operator_target != OPERATOR_TARGET or
                args.scope != V4_SCOPE or args.route != "GITHUB_ACTIONS"):
            raise ValueError("V4 scope/target/route mismatch")
        orders = args.orders_enabled == "true"
        validate_order_permission(args.scope, orders)
        if not orders:
            raise ValueError("V4 live requires explicitly signed ordersEnabled=true")
        if not isinstance(token, str) or not token.strip() or len(token) > 16384:
            raise ValueError("V4 missing signed owner approval")
        for directory in (
            paths.root, paths.root / "plans", paths.root / "plans" / V4_SCOPE,
            paths.nonce_dir, paths.activation_dir, paths.activation_dir / V4_SCOPE,
            paths.receipts,
        ):
            assert_private_dir(directory, root_uid=c.root_uid)
        # Existing operator-activation root is normally root:root 0755 for
        # multiple runner gates; the approval file itself remains root-only
        # mode 0600. Never chmod this shared live directory to 0700.
        assert_root_trusted_dir(self.runtime_approval.parent, root_uid=c.root_uid)
        assert_regular_secure(paths.public_key, root_uid=c.root_uid, private=True)
        desired = read_root_json(
            paths.root / "plans" / V4_SCOPE / (args.sha + ".json"),
            root_uid=c.root_uid,
        )
        current = read_root_json(paths.current_plan, root_uid=c.root_uid)
        raw_pins = read_root_json(paths.pins, root_uid=c.root_uid, private=False)
        pins = parse_live_pins(raw_pins, releases=paths.releases)
        current_sha = _legacy_transition_current_sha(paths)
        plan_hash, diff = validate_bootstrap_plan(desired, current, pins, current_sha)
        if (plan_hash != args.plan_sha256 or desired["sourceSha"] != args.sha
                or desired["ordersEnabled"] is not True
                or diff["changedRunners"] != [V4_RUNNER]
                or diff["uiChanged"] or diff["monitorChanged"]
                or diff["releaseRootsChanged"]):
            raise ValueError("V4 plan exceeds single-runner authorized delta")
        if desired["runners"][V4_RUNNER] != args.sha:
            raise ValueError("V4 candidate SHA differs from plan")
        # Exact V4 transition must not require rewriting legacy peer/UI
        # releases merely to satisfy a new ownership convention. Their SHA map
        # remains frozen in the signed plan and venue evidence. Only the new
        # V4 release is introduced by this scope, so only that release must be
        # root-owned immutable here.
        if desired["releaseRoots"]["runners"] != str(paths.releases):
            raise ValueError("V4 runner release root differs from production releases")
        release_marker(args.sha, paths.releases, root_uid=c.root_uid)
        # The unit must have a genuine SHA-local executable and readiness file,
        # rather than relying on another release's shared tsx executable.
        release = paths.releases / args.sha
        for name in (
            "node_modules/tsx/dist/cli.mjs",
            "scripts/v12-v4-production-runner.ts",
            "scripts/ops/root/disdex-live-operator-activation-gate.mjs",
            "docs/production/v12-v4-implementation-readiness.json",
        ):
            file = release / name
            if not file.is_file() or file.is_symlink():
                raise ValueError("V4 immutable release missing local runtime: " + name)
        readiness = json.loads(
            (release / "docs/production/v12-v4-implementation-readiness.json").read_text("utf8"))
        if (readiness.get("implementationStatus") != "READY" or
                any(x != "OPERATOR_LIVE_ACTIVATION_REQUIRED"
                    for x in readiness.get("blockers", []))):
            raise ValueError("V4 release readiness not certified")
        activation = read_root_json(
            paths.activation_dir / V4_SCOPE / (args.sha + ".json"),
            root_uid=c.root_uid)
        validate_v4_activation(activation, args, desired, plan_hash, c.clock())
        before = _validate_venue_evidence(
            read_root_json(paths.venue_before, root_uid=c.root_uid),
            now=c.clock(), label="before", require_v4_runtime=False)
        old_sha = pins[V4_RUNNER]
        old_unit = _unit_for_runner(V4_RUNNER, old_sha)
        new_unit = _unit_for_runner(V4_RUNNER, args.sha)
        if c.systemd.is_active(new_unit) or c.systemd.is_masked(new_unit):
            raise ValueError("new V4 already active or masked")
        old_was_active, old_state, old_pid = _validate_old_v4_baseline(c.systemd, old_unit)
        if old_unit == new_unit:
            raise ValueError("V4 no-op cutover")
        old_enabled = c.systemd.is_enabled(old_unit)
        old_runtime = None
        if self.runtime_approval.exists() or self.runtime_approval.is_symlink():
            assert_regular_secure(self.runtime_approval,
                                  root_uid=c.root_uid, private=True)
            old_runtime = read_root_json(self.runtime_approval, root_uid=c.root_uid)
        next_manifest = json.loads(json.dumps(raw_pins))
        item = next_manifest["runners"][V4_RUNNER]
        item["sha"] = args.sha
        item["serviceUnit"] = new_unit
        item["releaseRoot"] = str(paths.releases / args.sha)
        expected = dict(pins)
        expected[V4_RUNNER] = args.sha
        if parse_live_pins(next_manifest, releases=paths.releases) != expected:
            raise ValueError("V4 pin manifest invalid")
        next_plan = json.loads(json.dumps(current))
        next_plan["runners"] = desired["runners"]
        next_plan["scope"] = V4_SCOPE
        next_plan["ordersEnabled"] = True
        # Verify signature WITHOUT consuming its nonce until every static and
        # read-only venue precondition has passed.
        approved = c._verify_token(args, token)
        nonce = approved.get("nonce")
        if not isinstance(nonce, str) or len(nonce) != 32:
            raise ValueError("V4 signed nonce invalid")
        try:
            consumed = c._verify_token(args, token, nonce_dir=paths.nonce_dir)
        except FileExistsError:
            raise ValueError("V4 owner approval replay") from None
        if consumed.get("nonce") != nonce:
            raise ValueError("V4 owner nonce changed")

        journal = paths.journal or paths.root / "transaction.json"
        from disdex_unified_root_gate import _atomic_json
        changes_started = False
        try:
            _atomic_json(journal, {
                "schema": "disdex-unified-deploy-transaction/v1",
                "phase": "PREPARED", "scope": V4_SCOPE,
                "oldSha": old_sha, "newSha": args.sha,
                "oldUnit": old_unit, "newUnit": new_unit,
                "oldBaselineState": old_state, "oldBaselinePid": old_pid,
                "oldBaselineWasActive": old_was_active,
                "oldPins": raw_pins, "oldPlan": current,
                "oldRuntimeApprovalPresent": old_runtime is not None,
            }, root_uid=c.root_uid)
            changes_started = True
            if old_was_active:
                c.systemd.stop(old_unit)
            c.systemd.mask(old_unit)
            _atomic_json(paths.pins, next_manifest, root_uid=c.root_uid, private=False)
            _atomic_json(paths.current_plan, next_plan, root_uid=c.root_uid)
            _atomic_json(self.runtime_approval, runtime_activation(activation, args.sha),
                         root_uid=c.root_uid, trusted_parent=True)
            if old_enabled:
                c.systemd.enable(new_unit)
            c.systemd.start(new_unit)
            if c.systemd.is_active(old_unit) or not c.systemd.is_active(new_unit):
                raise RuntimeError("V4 writer mutual exclusion failed")
            _atomic_json(journal, {
                "schema": "disdex-unified-deploy-transaction/v1",
                "phase": "ACTIVE_AWAITING_AUDIT",
                "scope": V4_SCOPE, "oldSha": old_sha, "newSha": args.sha,
                "oldUnit": old_unit, "newUnit": new_unit,
            }, root_uid=c.root_uid)
            observed = c._audit(expected, new_unit, old_unit, before, cycles=3)
            receipt = {
                "schema": "disdex-unified-deploy-receipt/v1",
                "status": "V4_LIVE_CUTOVER_VERIFIED",
                "repository": REPO, "deploymentTarget": DEPLOYMENT_TARGET,
                "operatorTarget": OPERATOR_TARGET, "scope": V4_SCOPE,
                "targetSha": args.sha, "planSha256": plan_hash,
                "route": args.route, "ordersEnabled": True,
                "oldUnit": old_unit, "newUnit": new_unit,
                "currentSymlinkSha": current_sha,
                "nonceDigest": hashlib.sha256(nonce.encode("ascii")).hexdigest(),
                "auditCycles": observed, **ZERO_EFFECTS,
            }
            receipt_path = paths.receipts / (f"v12_v4-{args.sha}-{nonce[:8]}.json")
            _atomic_json(receipt_path, receipt, root_uid=c.root_uid)
            _atomic_json(journal, {
                "schema": "disdex-unified-deploy-transaction/v1",
                "phase": "COMMITTED", "receipt": str(receipt_path),
                "scope": V4_SCOPE, "oldSha": old_sha, "newSha": args.sha,
            }, root_uid=c.root_uid)
            return receipt
        except Exception as exc:
            if not changes_started:
                raise
            try:
                if c.systemd.is_active(new_unit):
                    c.systemd.stop(new_unit)
                if old_enabled:
                    c.systemd.disable(new_unit)
                if c.systemd.is_masked(old_unit):
                    c.systemd.unmask(old_unit)
                _atomic_json(paths.pins, raw_pins, root_uid=c.root_uid, private=False)
                _atomic_json(paths.current_plan, current, root_uid=c.root_uid)
                if old_runtime is not None:
                    _atomic_json(self.runtime_approval, old_runtime, root_uid=c.root_uid,
                                 trusted_parent=True)
                elif self.runtime_approval.exists():
                    assert_regular_secure(self.runtime_approval,
                                          root_uid=c.root_uid, private=True)
                    self.runtime_approval.unlink()
                if old_was_active and not c.systemd.is_active(old_unit):
                    c.systemd.start(old_unit)
                _atomic_json(journal, {
                    "schema": "disdex-unified-deploy-transaction/v1",
                    "phase": "ROLLED_BACK", "scope": V4_SCOPE,
                    "reason": str(exc)[:240],
                    "oldSha": old_sha, "newSha": args.sha,
                }, root_uid=c.root_uid)
            except Exception as rollback_error:
                raise RuntimeError(
                    "V4 cutover failed and rollback failed: " + str(rollback_error)) from exc
            raise RuntimeError("V4 cutover failed and rolled back: " + str(exc)) from exc
