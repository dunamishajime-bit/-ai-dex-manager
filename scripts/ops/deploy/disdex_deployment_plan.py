#!/usr/bin/env python3
"""Canonical multi-SHA DisDex deployment plan hashing and scoped diff validation.

The current-plan input MUST be produced from fresh VPS systemd/runtime
readback by the trusted root helper. A repository copy is NOT venue truth.
"""
import argparse
import hashlib
import json
from pathlib import Path

from disdex_deployment_contract import (
    DEPLOYMENT_TARGET,
    OPERATOR_TARGET,
    REPO,
    SCOPES,
    SHA,
    validate_order_permission,
)

SCHEMA = "disdex-unified-deployment-plan/v2"
IDS = (
    "V12_V4", "QUALITY102_CAUSAL_V1", "V52", "PENGU_V8",
    "FET_BRK48_RESIDUAL", "HYPE_TREND_LONG", "IDLE_PRIORITY_SHORT",
    "SHARED_CRYPTO_RISK", "MARGIN_GUARD",
)
INDIVIDUAL = {
    "V12_V4": "V12_V4",
    "QUALITY102_CAUSAL_V1": "QUALITY102_CAUSAL_V1",
    "V52": "V52", "PENGU_V8": "PENGU_V8",
    "FET_BRK48_RESIDUAL": "FET_BRK48_RESIDUAL",
    "HYPE_TREND_LONG": "HYPE_TREND_LONG",
    "IDLE_PRIORITY_SHORT": "IDLE_PRIORITY_SHORT",
    "SHARED_CRYPTO_RISK_ONLY": "SHARED_CRYPTO_RISK",
    "MARGIN_GUARD_ONLY": "MARGIN_GUARD",
}
FIELDS = {"schema", "repository", "deploymentTarget", "operatorTarget",
          "sourceSha", "scope", "runners", "uiSha", "monitorSha",
          "releaseRoots", "ordersEnabled"}
RELEASE_ROOT_FIELDS = {"runners", "ui", "monitor"}

def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")

def _validate_release_roots(value):
    if not isinstance(value, dict) or set(value) != RELEASE_ROOT_FIELDS:
        raise ValueError("release root map missing, extra or malformed")
    for name, root in value.items():
        if (not isinstance(root, str) or not root or "\x00" in root
            or not root.startswith("/") or root.endswith("/")
            or any(part in ("", ".", "..") for part in root.split("/")[1:])):
            raise ValueError("invalid immutable release root for " + name)
    return value

def validate(plan):
    if not isinstance(plan, dict) or set(plan) != FIELDS:
        raise ValueError("deployment plan schema fields")
    if (plan["schema"] != SCHEMA or plan["repository"] != REPO or
        plan["deploymentTarget"] != DEPLOYMENT_TARGET or
        plan["operatorTarget"] != OPERATOR_TARGET or
        plan["scope"] not in SCOPES):
        raise ValueError("deployment target, operator or scope mismatch")
    validate_order_permission(plan["scope"], plan["ordersEnabled"])
    for field in ("sourceSha", "uiSha", "monitorSha"):
        value = plan[field]
        if not isinstance(value, str) or not SHA.fullmatch(value):
            raise ValueError("invalid deployment SHA for " + field)
    pins = plan["runners"]
    if not isinstance(pins, dict) or set(pins) != set(IDS):
        raise ValueError("runner map missing, extra or malformed")
    for runner_id, sha in pins.items():
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise ValueError("invalid runner SHA for " + runner_id)
    _validate_release_roots(plan["releaseRoots"])
    return plan

def approve_diff(desired, current):
    validate(desired)
    validate(current)
    if desired["repository"] != current["repository"] or (
        desired["deploymentTarget"] != current["deploymentTarget"] or
        desired["operatorTarget"] != current["operatorTarget"]):
        raise ValueError("current and desired target mismatch")
    changed = {k for k in IDS if desired["runners"][k] != current["runners"][k]}
    ui_changed = desired["uiSha"] != current["uiSha"]
    monitor_changed = desired["monitorSha"] != current["monitorSha"]
    release_roots_changed = desired["releaseRoots"] != current["releaseRoots"]
    scope = desired["scope"]
    if scope in INDIVIDUAL and (changed - {INDIVIDUAL[scope]} or ui_changed
                                or monitor_changed or release_roots_changed):
        raise ValueError("scope exceeds approved runner")
    if scope == "HP_ONLY" and (changed or monitor_changed
                                or desired["releaseRoots"]["ui"] != current["releaseRoots"]["ui"]):
        raise ValueError("HP-only scope modifies trading/runtime")
    if scope == "API_MONITORS" and (changed or ui_changed
                                     or desired["releaseRoots"]["monitor"] != current["releaseRoots"]["monitor"]):
        raise ValueError("monitor-only scope modifies trading/UI")
    if not changed and not ui_changed and not monitor_changed:
        raise ValueError("no deployment differences")
    return dict(changedRunners=sorted(changed), uiChanged=ui_changed,
                monitorChanged=monitor_changed,
                releaseRootsChanged=release_roots_changed,
                exactScope=scope,
                ordersEnabled=desired["ordersEnabled"])

def digest(desired, current):
    changes = approve_diff(desired, current)
    return hashlib.sha256(canonical(desired)).hexdigest(), changes

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--desired", required=True)
    parser.add_argument("--current", required=True)
    args = parser.parse_args()
    try:
        desired = json.loads(Path(args.desired).read_text())
        current = json.loads(Path(args.current).read_text())
        sha, changes = digest(desired, current)
        print(json.dumps({"planSha256": sha, "changes": changes}, sort_keys=True))
    except (ValueError, OSError) as e:
        parser.exit(1, "DISDEX_DEPLOYMENT_PLAN_BLOCKED: " + str(e) + "\n")

if __name__ == "__main__":
    main()
