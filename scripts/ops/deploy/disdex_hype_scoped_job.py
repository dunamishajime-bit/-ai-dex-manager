#!/usr/bin/env python3
"""Run a root-authorized HYPE cutover independently of the SSH session."""
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
import uuid
from types import SimpleNamespace

from disdex_deployment_contract import (
    CODEX_SSH_AUTH_SCHEMA, CODEX_SSH_OPERATOR, DEPLOYMENT_TARGET,
    OPERATOR_TARGET, REPO, SHA, PLAN_HASH,
)
from disdex_deployment_plan import canonical

JOB_SCHEMA = "disdex-hype-scoped-job/v1"
JOB_DIR = Path("/var/lib/disdex/unified-deploy/jobs/hype")
RECEIPTS = Path("/var/lib/disdex/unified-deploy/receipts")


def require(condition, reason):
    if not condition:
        raise ValueError("HYPE_JOB_" + reason)


def validate_job_request(row, job_id, now):
    require(re.fullmatch(r"[a-f0-9]{32}", str(job_id)) is not None, "ID")
    require(isinstance(row, dict) and row.get("schema") == JOB_SCHEMA
            and row.get("jobId") == job_id, "SCHEMA_OR_ID")
    require(row.get("deploymentTarget") == DEPLOYMENT_TARGET
            and row.get("operatorTarget") == OPERATOR_TARGET, "TARGET")
    require(row.get("scope") == "HYPE_TREND_LONG"
            and row.get("ordersEnabled") is True, "SCOPE_OR_ORDER_PERMISSION")
    require(isinstance(row.get("sourceSha"), str) and SHA.fullmatch(row["sourceSha"])
            and isinstance(row.get("planSha256"), str) and PLAN_HASH.fullmatch(row["planSha256"]),
            "SHA_OR_PLAN_HASH")
    route = row.get("route")
    require(route in ("CODEX_SSH", "GITHUB_ACTIONS"), "ROUTE")
    if route == "CODEX_SSH":
        auth = row.get("authorization")
        require(isinstance(auth, dict)
                and auth.get("schema") == CODEX_SSH_AUTH_SCHEMA
                and auth.get("repository") == REPO
                and auth.get("deploymentTarget") == DEPLOYMENT_TARGET
                and auth.get("operatorTarget") == OPERATOR_TARGET
                and auth.get("route") == route
                and auth.get("operator") == CODEX_SSH_OPERATOR
                and row.get("owner") == CODEX_SSH_OPERATOR
                and auth.get("sourceSha") == row["sourceSha"]
                and auth.get("scope") == row["scope"]
                and auth.get("planSha256") == row["planSha256"]
                and auth.get("ordersEnabled") is True
                and auth.get("authorizationMethod") == "ROOT_SSH_SESSION"
                and auth.get("signatureVerified") is False
                and auth.get("nonce") == job_id, "SSH_AUTH_BINDING")
        issued, expires = auth.get("issuedAt"), auth.get("expiresAt")
        require(type(now) is int and type(issued) is int and type(expires) is int
                and issued <= now < expires and 1 <= expires-issued <= 300,
                "SSH_AUTH_EXPIRED")
        require(not row.get("approvalToken"), "SSH_TOKEN_UNEXPECTED")
    else:
        token = row.get("approvalToken")
        require(row.get("owner") and isinstance(token, str)
                and 0 < len(token) <= 16384 and not row.get("authorization"),
                "OWNER_TOKEN_REQUIRED")
    return row


def _private_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
            and stat.S_IMODE(info.st_mode) == 0o600 and not path.is_symlink(),
            "UNTRUSTED_REQUEST_FILE")
    return info


def _read_private_request(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
                and stat.S_IMODE(info.st_mode) == 0o600, "UNTRUSTED_REQUEST_FILE")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            raw = handle.read(32769)
        require(len(raw) <= 32768 and len(raw) == info.st_size,
                "REQUEST_TOO_LARGE_OR_CHANGED")
        return raw
    finally:
        os.close(fd)


def _unlink_request(path):
    path.unlink()
    fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _failure_receipt(job_id, row, error):
    from disdex_unified_root_gate import assert_private_dir
    assert_private_dir(RECEIPTS, root_uid=0)
    raw = str(error).split(":", 1)[0]
    code = raw if re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", raw) else type(error).__name__.upper()
    receipt = {
        "schema": "disdex-hype-scoped-job-receipt/v1",
        "status": "HYPE_SCOPED_JOB_FAILED_NO_COMMIT",
        "jobId": job_id,
        "scope": "HYPE_TREND_LONG",
        "sourceSha": row.get("sourceSha") if isinstance(row, dict) else None,
        "planSha256": row.get("planSha256") if isinstance(row, dict) else None,
        "route": row.get("route") if isinstance(row, dict) else None,
        "failureCode": code,
        "failedAt": int(time.time()),
    }
    path = RECEIPTS / ("hype-job-" + job_id + ".json")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o400)
    try:
        os.fchown(fd, 0, 0)
        data = memoryview(canonical(receipt) + b"\n")
        while data:
            written = os.write(fd, data)
            require(written > 0, "FAILURE_RECEIPT_SHORT_WRITE")
            data = data[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(RECEIPTS, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def run(job_id):
    require(os.geteuid() == 0, "ROOT_REQUIRED")
    require(os.environ.get("DISDEX_HYPE_JOB_ID") == job_id
            and bool(os.environ.get("INVOCATION_ID")), "SYSTEMD_INSTANCE_REQUIRED")
    from disdex_unified_root_gate import (
        RootDeploymentExecutor, assert_private_dir, default_execution_paths,
    )
    assert_private_dir(JOB_DIR, root_uid=0)
    path = JOB_DIR / (job_id + ".json")
    raw = _read_private_request(path)
    row = {}
    try:
        row = json.loads(raw)
        validate_job_request(row, job_id, int(time.time()))
    finally:
        # A queued approval is consumed as an invocation even if validation or
        # a later gate fails. Recovery always needs a new fresh authorization.
        _unlink_request(path)
    args = SimpleNamespace(
        deployment_target=row["deploymentTarget"],
        operator_target=row["operatorTarget"],
        sha=row["sourceSha"], scope=row["scope"],
        plan_sha256=row["planSha256"], orders_enabled="true",
        route=row["route"], owner=row["owner"], _hype_job_worker=True,
    )
    if row["route"] == "CODEX_SSH":
        args._codex_ssh_authenticated = True
        args._codex_ssh_authorization = row["authorization"]
        token = ""
    else:
        token = row["approvalToken"]
    from disdex_deployment_serialization import deployment_lock
    parent = RootDeploymentExecutor(default_execution_paths())
    return execute_after_lock(parent, args, token, lock_factory=deployment_lock)


def execute_after_lock(parent, args, token, *, lock_factory,
                       sleep_fn=time.sleep, clock_fn=time.monotonic,
                       deadline_seconds=300):
    """Wait only for the submitter's brief lock, then execute once.

    The generic root gate enqueues this worker while holding the global
    deployment lock. Only that exact contention is retried; lock integrity,
    token expiry, and transaction failures remain fail closed.
    """
    deadline = clock_fn() + deadline_seconds
    while True:
        manager = lock_factory(parent.paths.root, args.scope,
                               args.orders_enabled == "true")
        try:
            manager.__enter__()
        except ValueError as error:
            if str(error) != "another root deployment is in progress":
                raise
            remaining = deadline - clock_fn()
            if remaining <= 0:
                raise ValueError("HYPE_JOB_DEPLOYMENT_LOCK_TIMEOUT") from None
            sleep_fn(min(0.25, remaining))
            continue
        try:
            result = parent.execute(args, token)
        except BaseException as error:
            manager.__exit__(type(error), error, error.__traceback__)
            raise
        else:
            manager.__exit__(None, None, None)
            return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()
    row = {}
    try:
        row_path = JOB_DIR / (args.job_id + ".json")
        if row_path.exists() and not row_path.is_symlink():
            row = json.loads(_read_private_request(row_path))
        result = run(args.job_id)
        # The authoritative completion receipt is written by the transaction.
        return 0 if result.get("status") == "HYPE_PROTECTED_HOLD_VERIFIED_NOT_ORDER_ENABLED" else 1
    except Exception as error:
        try:
            _failure_receipt(args.job_id, row, error)
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
