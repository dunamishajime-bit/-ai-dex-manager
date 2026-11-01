#!/usr/bin/env python3
"""Serialized file-backed DisDex deployment approval store helper.

This helper exists for GitHub Actions that must publish a PENDING approval on
the Production VPS before the UI can serve it. It uses the same lock path and
CAS revision semantics as lib/server/deploy-approval-store.ts.

It never reads or writes owner passwords, OTP values, signing keys, API
credentials, orders, positions, STOPs, Gross, or Kill Switch state.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import pwd
import re
import time
import uuid

DEFAULT_STORE = Path("/home/deploy/disdex-ui/shared/data/deploy-approvals.json")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PLAN_RE = re.compile(r"^[0-9a-f]{64}$")
UUID_RE = re.compile(r"^[0-9a-fA-F-]{1,128}$")
ACTIVE = {"PENDING", "OTP_SENT", "APPROVED", "DISPATCHED"}
EXPIRABLE = {"PENDING", "OTP_SENT", "APPROVED"}
MAX_RECORDS = 50


def fail(reason: str) -> None:
    raise SystemExit(reason)


def acquire_lock(store: Path, attempts: int = 200, sleep_seconds: float = 0.05) -> Path:
    store.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = Path(str(store) + ".task-lock")
    for _ in range(attempts):
        try:
            lock.mkdir(mode=0o700)
            return lock
        except FileExistsError:
            time.sleep(sleep_seconds)
    fail("APPROVAL_STORE_BUSY_FAIL_CLOSED")


def release_lock(lock: Path) -> None:
    try:
        lock.rmdir()
    except FileNotFoundError:
        return


def load_records(store: Path) -> list[dict]:
    try:
        raw = json.loads(store.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("APPROVAL_STORE_INVALID_OR_UNREADABLE") from exc
    if not isinstance(raw, list) or any(not isinstance(item, dict) for item in raw):
        raise RuntimeError("APPROVAL_STORE_INVALID")
    return raw


def atomic_save(store: Path, records: list[dict]) -> None:
    store.parent.mkdir(parents=True, exist_ok=True)
    tmp = store.parent / f".deploy-approvals-{os.getpid()}-{uuid.uuid4()}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(tmp, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", closefd=True) as handle:
            json.dump(records, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            deploy = pwd.getpwnam("deploy")
            os.chown(tmp, deploy.pw_uid, deploy.pw_gid)
        except KeyError:
            pass
        os.chmod(tmp, 0o600)
        os.replace(tmp, store)
        try:
            directory_fd = os.open(store.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            # The data file has already been atomically renamed. Some filesystems
            # do not support fsync on directories; do not weaken file validation.
            pass
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def parse_bool(value: str) -> bool:
    normalized = str(value).strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    fail("APPROVAL_ORDERS_ENABLED_INVALID")


def validate_input(args: argparse.Namespace) -> None:
    if not args.operation or len(args.operation) > 128:
        fail("APPROVAL_OPERATION_INVALID")
    if not args.scope or len(args.scope) > 128:
        fail("APPROVAL_SCOPE_INVALID")
    if not SHA_RE.fullmatch(args.target_sha):
        fail("APPROVAL_TARGET_SHA_INVALID")
    if not PLAN_RE.fullmatch(args.plan_sha256):
        fail("APPROVAL_PLAN_HASH_INVALID")
    if not args.actor or len(args.actor) > 128:
        fail("APPROVAL_ACTOR_INVALID")
    if args.comment_id and not UUID_RE.fullmatch(args.comment_id):
        # GitHub comment IDs are normally decimal, while test fixtures may use
        # a bounded opaque identifier. Do not allow shell/meta characters.
        if not re.fullmatch(r"^[0-9]{1,32}$", args.comment_id):
            fail("APPROVAL_COMMENT_ID_INVALID")


def create_pending(args: argparse.Namespace) -> dict:
    validate_input(args)
    orders_enabled = parse_bool(args.orders_enabled)
    store = Path(args.store)
    now = int(time.time() * 1000)
    lock = acquire_lock(store)
    try:
        records = load_records(store)

        for record in records:
            if (
                record.get("status") in EXPIRABLE
                and int(record.get("requestExpiresAt") or 0) <= now
            ):
                record["status"] = "EXPIRED"
                record["lastError"] = "request expired"
                record["updatedAt"] = now
                record["storeRevision"] = str(uuid.uuid4())

        existing = next(
            (
                record for record in records
                if record.get("targetSha") == args.target_sha
                and record.get("planSha256") == args.plan_sha256
                and (record.get("operation") or (
                    "V12_V4_LIVE" if record.get("scope") == "V12_V4" else None
                )) == args.operation
                and record.get("scope") == args.scope
                and bool(record.get("ordersEnabled", True)) == orders_enabled
                and record.get("status") in ACTIVE
                and int(record.get("requestExpiresAt") or 0) > now
            ),
            None,
        )
        if existing:
            # Persist any expiry transitions discovered above before returning.
            atomic_save(
                store,
                sorted(records, key=lambda item: int(item.get("createdAt") or 0), reverse=True)[:MAX_RECORDS],
            )
            return {
                "id": str(existing.get("id")),
                "status": str(existing.get("status")),
                "reused": True,
                "operation": args.operation,
                "scope": args.scope,
                "ordersEnabled": orders_enabled,
            }

        request_id = str(uuid.uuid4())
        record = {
            "id": request_id,
            "scope": args.scope,
            "operation": args.operation,
            "ordersEnabled": orders_enabled,
            "targetSha": args.target_sha,
            "planSha256": args.plan_sha256,
            "requestActor": args.actor,
            **({"requestCommentId": args.comment_id} if args.comment_id else {}),
            "createdAt": now,
            "requestExpiresAt": now + 30 * 60 * 1000,
            "updatedAt": now,
            "storeRevision": str(uuid.uuid4()),
            "status": "PENDING",
        }
        records.append(record)
        records = sorted(
            records,
            key=lambda item: int(item.get("createdAt") or 0),
            reverse=True,
        )[:MAX_RECORDS]
        atomic_save(store, records)
        return {
            "id": request_id,
            "status": "PENDING",
            "reused": False,
            "operation": args.operation,
            "scope": args.scope,
            "ordersEnabled": orders_enabled,
        }
    finally:
        release_lock(lock)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-pending"])
    parser.add_argument("--store", default=str(DEFAULT_STORE))
    parser.add_argument("--operation", required=True)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--orders-enabled", required=True)
    parser.add_argument("--target-sha", required=True)
    parser.add_argument("--plan-sha256", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--comment-id", default="")
    args = parser.parse_args()

    result = create_pending(args)
    print("APPROVAL_REQUEST_ID=" + result["id"])
    print("APPROVAL_STATUS=" + result["status"])
    print("APPROVAL_REQUEST_REUSED=" + ("TRUE" if result["reused"] else "FALSE"))
    print("OPERATION=" + result["operation"])
    print("SCOPE=" + result["scope"])
    print("ORDERS_ENABLED=" + str(result["ordersEnabled"]).lower())
    print("TRADING_MUTATION=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
