#!/usr/bin/env python3
"""Send confirmed Aster fill emails from the append-only production inbox.

This is a separate notification-only worker. It has no venue, order, stop,
Kill Switch or runner APIs. Bootstrap never sends existing historical fills.
Each confirmed notification advances a durable cursor only after SMTP success.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from email.message import EmailMessage
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import ssl
import stat
import sys

INBOX = Path("/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl")
STATE = Path("/var/lib/disdex/shared/trade-fill-notifications/email-dispatch-state.json")
LOCK = Path("/var/lib/disdex/shared/trade-fill-notifications/email-dispatch.lock")
SCHEMA = "disdex-fill-email-dispatch/v1"
MAX_INBOX_BYTES = 8 * 1024 * 1024
RECIPIENT_DEFAULT = "dunamis.hajime@gmail.com"


def require(value, code):
    if not value:
        raise ValueError("FILL_EMAIL_" + code)


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")


def read_inbox(path):
    require(not path.is_symlink() and path.is_file(), "INBOX_NOT_REGULAR")
    st_before = path.stat()
    require(stat.S_ISREG(st_before.st_mode) and st_before.st_size <= MAX_INBOX_BYTES, "INBOX_NOT_BOUNDED")
    raw = path.read_bytes()
    st_after = path.stat()
    require((st_before.st_dev, st_before.st_ino, st_before.st_size, st_before.st_mtime_ns) ==
            (st_after.st_dev, st_after.st_ino, st_after.st_size, st_after.st_mtime_ns) and
            len(raw) == st_after.st_size, "INBOX_CHANGED_DURING_READ")
    end = raw.rfind(b"\n") + 1
    return raw[:end], st_after


def validate_state(row, st, length):
    require(isinstance(row, dict) and row.get("schema") == SCHEMA, "STATE_INVALID")
    require(type(row.get("cursor")) is int and 0 <= row["cursor"] <= length, "CURSOR_INVALID")
    require(row.get("inboxDevice") == st.st_dev and row.get("inboxInode") == st.st_ino, "INBOX_ROTATED_REVIEW_REQUIRED")
    require(type(row.get("sentCount")) is int and row["sentCount"] >= 0, "SENT_COUNT_INVALID")
    require(isinstance(row.get("sentKeys"), list) and len(row["sentKeys"]) <= 5000
            and all(isinstance(v, str) and re.fullmatch("[0-9a-f]{64}", v) for v in row["sentKeys"]), "SENT_KEYS_INVALID")
    return row


def atomic_state(path, row):
    require(not path.is_symlink(), "STATE_SYMLINK")
    temp = path.parent / (".email-state-" + secrets.token_hex(12))
    require(not temp.exists() and not temp.is_symlink(), "STATE_TEMP_COLLISION")
    fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        else:
            os.chmod(temp, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical(row))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        if os.name != "nt":
            dir_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
    finally:
        temp.unlink(missing_ok=True)


@contextmanager
def exclusive_lock(path):
    import fcntl
    require(not path.is_symlink(), "LOCK_SYMLINK")
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def bootstrap(spool=INBOX, state_path=STATE):
    require(not state_path.exists(), "ALREADY_BOOTSTRAPPED")
    raw, st = read_inbox(spool)
    prior_keys = []
    for line in raw.splitlines(keepends=True):
        event = parse_fill(line)
        if event is not None:
            prior_keys.append(fill_key(event))
    require(len(prior_keys) <= 5000, "BOOTSTRAP_TOO_MANY_EVENTS")
    # Reject a concurrently appended fill instead of silently treating it as
    # historical. The worker is bootstrapped before its timer is enabled.
    row = {
        "schema": SCHEMA, "cursor": len(raw), "inboxDevice": st.st_dev,
        "inboxInode": st.st_ino, "baselineSha256": hashlib.sha256(raw).hexdigest(),
        "baselineAt": timestamp(), "sentCount": 0, "sentKeys": list(dict.fromkeys(prior_keys)), "lastSentKey": None,
        "lastSentAt": None,
    }
    require(spool.stat().st_size == len(raw) and spool.stat().st_mtime_ns == st.st_mtime_ns,
            "BOOTSTRAP_INBOX_CHANGED")
    atomic_state(state_path, row)
    return {"status": "HISTORICAL_BASELINE_ONLY", "baselineBytes": len(raw),
            "ordersSent": 0, "emailsSent": 0}


def parse_fill(raw):
    try:
        event = json.loads(raw.decode("utf8"))
    except (ValueError, UnicodeError):
        raise ValueError("FILL_EMAIL_EVENT_MALFORMED") from None
    require(isinstance(event, dict), "EVENT_NOT_OBJECT")
    if event.get("eventType") not in ("ENTRY_FILL", "EXIT_FILL"):
        return None
    require(event.get("status") == "FILLED", "EVENT_NOT_CONFIRMED")
    for name in ("orderId", "symbol", "strategyId", "executedAt", "side"):
        value = event.get(name)
        require(isinstance(value, str) and 0 < len(value) < 160, "EVENT_" + name.upper() + "_INVALID")
    require(re.fullmatch(r"[A-Z0-9]{3,24}", event["symbol"]) is not None, "EVENT_SYMBOL_INVALID")
    for name in ("averagePrice", "executedQuantity"):
        try:
            value = float(event.get(name))
            require(0 < value < 10**15 and value != float("inf"), "EVENT_" + name.upper() + "_INVALID")
        except (TypeError, ValueError, OverflowError):
            raise ValueError("FILL_EMAIL_EVENT_" + name.upper() + "_INVALID") from None
    try:
        date = datetime.fromisoformat(event["executedAt"].replace("Z", "+00:00"))
        require(date.tzinfo is not None, "EVENT_TIME_ZONE_MISSING")
    except ValueError:
        raise ValueError("FILL_EMAIL_EVENT_TIME_INVALID") from None
    return event


def fill_key(event):
    return hashlib.sha256(("|".join([
        event["eventType"], event["orderId"], event["executedAt"],
        event["symbol"], event["side"],
    ])).encode("utf8")).hexdigest()


def mail_message(event, recipient):
    digest = fill_key(event)
    msg = EmailMessage()
    msg["To"] = recipient
    msg["From"] = os.environ["GMAIL_USER"]
    msg["Subject"] = "[DisDex] 約定通知: " + event["eventType"] + " " + event["symbol"]
    msg["Message-ID"] = "<disdex-fill-" + digest[:32] + "@professional-dismanager.net>"
    at = datetime.fromisoformat(event["executedAt"].replace("Z", "+00:00")).astimezone(
        timezone.utc).isoformat(timespec="seconds")
    reason = str(event.get("reason") or "未取得")[:200]
    msg.set_content("\n".join([
        "DisDex の取引所FILLEDを確認しました。",
        "種別: " + event["eventType"],
        "ロジック: " + event["strategyId"],
        "銘柄: " + event["symbol"],
        "方向: " + event["side"],
        "約定数量: " + str(event["executedQuantity"]),
        "平均約定価格: " + str(event["averagePrice"]),
        "約定時刻(UTC): " + at,
        "注文ID: " + event["orderId"],
        "判定理由: " + reason,
        "",
        "この通知は実約定から生成され、発火候補のみでは送信されません。",
    ]), charset="utf-8")
    return msg, digest


def send_smtp(event):
    username = os.environ.get("GMAIL_USER", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    recipient = os.environ.get("TRADE_FILL_NOTIFICATION_EMAIL", "").strip() or RECIPIENT_DEFAULT
    require(username and password and "@" in recipient, "MAIL_CREDENTIALS_OR_RECIPIENT_MISSING")
    msg, digest = mail_message(event, recipient)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=18, context=ssl.create_default_context()) as conn:
        conn.login(username, password)
        refused = conn.send_message(msg)
        require(not refused, "SMTP_RECIPIENT_REJECTED")
    return digest


def check_smtp():
    username = os.environ.get("GMAIL_USER", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    require(username and password, "MAIL_CREDENTIALS_MISSING")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=18, context=ssl.create_default_context()) as conn:
        conn.login(username, password)
    return {"status": "SMTP_AUTH_VERIFIED_NO_EMAIL_SENT", "emailsSent": 0, "ordersSent": 0}


def run_once(spool=INBOX, state_path=STATE, send=send_smtp):
    require(state_path.is_file() and not state_path.is_symlink(), "BOOTSTRAP_REQUIRED")
    raw, st = read_inbox(spool)
    row = validate_state(json.loads(state_path.read_bytes()), st, len(raw))
    cursor = row["cursor"]
    # The spool is append-only and each line is a confirmed immutable event.
    # Advance a cursor only after a successful SMTP submission, preserving
    # at-least-once delivery across crashes.
    sent = 0
    for line in raw[cursor:].splitlines(keepends=True):
        require(line.endswith(b"\n"), "PARTIAL_EVENT")
        event = parse_fill(line)
        if event is not None:
            digest = fill_key(event)
            if digest not in row["sentKeys"]:
                confirmed = send(event)
                require(confirmed == digest, "SMTP_SEND_UNCONFIRMED")
                row["sentKeys"] = (row["sentKeys"] + [digest])[-5000:]
                row["lastSentKey"] = digest
                row["lastSentAt"] = timestamp()
                row["sentCount"] += 1
                sent += 1
        cursor += len(line)
        row["cursor"] = cursor
        atomic_state(state_path, row)
    return {"status": "EMAIL_DISPATCH_CHECK_COMPLETE", "emailsSent": sent,
            "totalNotifications": row["sentCount"], "cursor": row["cursor"], "ordersSent": 0}


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--preflight-readonly", action="store_true")
    modes.add_argument("--bootstrap", action="store_true")
    modes.add_argument("--once", action="store_true")
    modes.add_argument("--check-smtp", action="store_true")
    args = parser.parse_args()
    if args.check_smtp:
        result = check_smtp()
    elif args.preflight_readonly:
        raw, st = read_inbox(INBOX)
        result = {"status": "EMAIL_DISPATCH_READONLY", "inboxBytes": len(raw),
                  "bootstrapped": STATE.is_file(), "ordersSent": 0, "emailsSent": 0}
    else:
        with exclusive_lock(LOCK):
            result = bootstrap() if args.bootstrap else run_once()
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never log SMTP secrets, recipient addresses, account identifiers or raw event bodies.
        reason = str(exc) if isinstance(exc, ValueError) and str(exc).startswith("FILL_EMAIL_") else type(exc).__name__
        print(json.dumps({"status": "EMAIL_DISPATCH_FAIL_CLOSED", "reason": reason,
                          "ordersSent": 0, "emailsSent": 0}), file=sys.stderr)
        raise SystemExit(2) from None
