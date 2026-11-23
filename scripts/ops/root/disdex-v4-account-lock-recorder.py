#!/usr/bin/env python3
"""Read-only shared account-lock owner observer for DisDex V4 diagnostics.

Watches atomic lock creation/renames/removal via inotify; it never creates,
renames, acquires, expires, or deletes the actual account lock.
"""
import ctypes
import datetime
import hashlib
import json
import os
import re
import select
import signal
import stat
import struct
import sys
import time

LOCK = "/var/lib/disdex/shared/account-order.lock"
OUTPUT = "/var/lib/disdex/v12-v4/lock-holder-events.jsonl"
EVENT_MASK = 0x00000008 | 0x00000080 | 0x00000200 | 0x00000100
HEADER = struct.Struct("iIII")
stop = False


def utc_time():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def snapshot(path=LOCK):
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        fd = os.open(path, flags)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
                return None
            data = os.read(fd, 16385)
        finally:
            os.close(fd)
        doc = json.loads(data)
        if doc.get("schema") != "disdex-account-lock/v1":
            return None
        owner = doc.get("ownerId")
        lease = doc.get("leaseId")
        if not isinstance(owner, str) or not isinstance(lease, str):
            return None
        acquired = doc.get("acquiredAt")
        expires = doc.get("expiresAt")
        if not isinstance(acquired, (int, float)) or not isinstance(expires, (int, float)):
            return None
        now = time.time() * 1000
        return {
            "ownerId": re.sub(r"[^A-Za-z0-9_.:-]", "_", owner)[:100],
            "leaseFingerprint": hashlib.sha256(lease.encode("utf8")).hexdigest()[:16],
            "acquiredAt": int(acquired),
            "expiresAt": int(expires),
            "heldForMs": max(0, int(now - acquired)),
            "remainingMs": max(0, int(expires - now)),
            "expired": expires <= now,
        }
    except (OSError, ValueError, TypeError, UnicodeDecodeError):
        return None


def emit(event, data=None):
    row = {
        "schema": "disdex-shared-account-lock-holder-history/v1",
        "observedAt": utc_time(),
        "event": event,
        "readOnly": True,
        "orderMutation": 0,
    }
    if data:
        row.update(data)
    payload = json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n"
    os.makedirs(os.path.dirname(OUTPUT), mode=0o700, exist_ok=True)
    if os.path.isfile(OUTPUT) and os.stat(OUTPUT).st_size > 16 * 1024 * 1024:
        for index in (2, 1):
            source = OUTPUT + "." + str(index)
            dest = OUTPUT + "." + str(index + 1)
            if os.path.exists(source):
                os.replace(source, dest)
        os.replace(OUTPUT, OUTPUT + ".1")
    with open(OUTPUT, "a", encoding="utf8") as f:
        os.chmod(f.fileno(), 0o600)
        f.write(payload)
    print(payload.rstrip(), flush=True)


def self_test():
    text = '{"schema":"disdex-account-lock/v1","ownerId":"Q102_RUNNER","leaseId":"secret-test-id","acquiredAt":1000,"expiresAt":9999999999999}'
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "lock")
        with open(p, "w", encoding="utf8") as f:
            f.write(text)
        value = snapshot(p)
        assert value and value["ownerId"] == "Q102_RUNNER"
        assert value["leaseFingerprint"] != "secret-test-id"
        assert not snapshot(os.path.join(d, "absent"))
    print("SELF_TEST_PASS", flush=True)


def stop_handler(_sig, _frame):
    global stop
    stop = True


def main():
    global stop
    if "--self-test" in sys.argv:
        self_test()
        return
    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
    if fd < 0:
        raise OSError(ctypes.get_errno(), "inotify_init1 failed")
    try:
        watch = libc.inotify_add_watch(fd, os.fsencode(os.path.dirname(LOCK)), EVENT_MASK)
        if watch < 0:
            raise OSError(ctypes.get_errno(), "inotify_add_watch failed")
        last = None

        def examine():
            nonlocal last
            current = snapshot()
            identity = current["leaseFingerprint"] if current else None
            if identity != last:
                if last:
                    emit("LEASE_NO_LONGER_PRESENT", {"leaseFingerprint": last})
                if current:
                    emit("LEASE_OWNER_OBSERVED", current)
                last = identity

        examine()
        emit("MONITOR_STARTED", {"lockPathId": "ASTER_FUTURES_ACCOUNT_LOCK"})
        while not stop:
            ready, _, _ = select.select([fd], [], [], 1.0)
            if ready:
                data = os.read(fd, 65536)
                offset = 0
                while offset + HEADER.size <= len(data):
                    _, mask, _, name_size = HEADER.unpack_from(data, offset)
                    offset += HEADER.size
                    raw = data[offset:offset + name_size]
                    offset += name_size
                    name = raw.split(b"\x00", 1)[0].decode("utf8", "replace")
                    if name == os.path.basename(LOCK):
                        examine()
            else:
                # Reconciling periodically covers missed startup races.
                examine()
        emit("MONITOR_STOPPED")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
