#!/usr/bin/env python3
"""Verify short-lived owner-signed DisDex deployment grants; never accept a password here."""
import argparse
import base64
import binascii
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time

SCHEMA = "disdex-owner-deployment-approval/v1"
REPO = "dunamishajime-bit/-ai-dex-manager"
SCOPES = frozenset(("FULL_PROJECT V12_V4 QUALITY102_CAUSAL_V1 V52 PENGU_V8 "
    "FET_BRK48_RESIDUAL HYPE_TREND_LONG IDLE_PRIORITY_SHORT SHARED_CRYPTO_RISK_ONLY "
    "MARGIN_GUARD_ONLY API_MONITORS HP_ONLY ROLLBACK").split())
FIELDS = {"schema", "repository", "sourceSha", "scope", "operator", "nonce", "issuedAt", "expiresAt"}
SHA = re.compile(r"[0-9a-f]{40}\Z")
LOGIN = re.compile(r"[A-Za-z0-9-]{1,39}\Z")
NONCE = re.compile(r"[0-9a-f]{32}\Z")

def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")

def unique_json(value):
    def unique(pairs):
        d = {}
        for k, v in pairs:
            if k in d:
                raise ValueError("duplicate field")
            d[k] = v
        return d
    return json.loads(value, object_pairs_hook=unique)

def crypto(data, key, signature=None):
    with tempfile.TemporaryDirectory(prefix="disdex-approval-") as directory:
        message = Path(directory) / "message"
        sig = Path(directory) / "sig"
        message.write_bytes(data)
        if signature is None:
            argv = ["openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(key),
                    "-in", str(message), "-out", str(sig)]
        else:
            sig.write_bytes(signature)
            argv = ["openssl", "pkeyutl", "-verify", "-rawin", "-pubin", "-inkey",
                    str(key), "-in", str(message), "-sigfile", str(sig)]
        result = subprocess.run(argv, capture_output=True, check=False)
        if result.returncode:
            raise ValueError("invalid owner signature or key")
        return sig.read_bytes() if signature is None else True

def issue(repo, sha, scope, operator, key, now=None, ttl=300):
    now = int(time.time()) if now is None else now
    if (repo != REPO or not SHA.fullmatch(sha) or scope not in SCOPES or
        not LOGIN.fullmatch(operator) or type(ttl) is not int or not 1 <= ttl <= 300):
        raise ValueError("invalid approval request")
    payload = dict(schema=SCHEMA, repository=repo, sourceSha=sha, scope=scope,
                   operator=operator, nonce=secrets.token_hex(16),
                   issuedAt=now, expiresAt=now + ttl)
    sig = crypto(canonical(payload), key)
    return base64.b64encode(canonical(dict(payload=payload,
        signature=base64.b64encode(sig).decode("ascii")))).decode("ascii")

def verify(token, public_key, repo, sha, scope, operator, now=None, nonce_dir=None):
    now = int(time.time()) if now is None else now
    if len(token) > 16384:
        raise ValueError("oversized approval")
    try:
        content = unique_json(base64.b64decode(token, validate=True))
        payload = content["payload"]
        sig = base64.b64decode(content["signature"], validate=True)
    except (ValueError, TypeError, KeyError, binascii.Error):
        raise ValueError("malformed approval") from None
    if not isinstance(content, dict) or set(content) != {"payload", "signature"}:
        raise ValueError("unexpected approval fields")
    if not isinstance(payload, dict) or set(payload) != FIELDS:
        raise ValueError("unexpected payload fields")
    if (repo != REPO or payload["schema"] != SCHEMA or payload["repository"] != repo or
        payload["sourceSha"] != sha or payload["scope"] != scope or
        payload["operator"] != operator):
        raise ValueError("approval target mismatch")
    if (not isinstance(sha, str) or not SHA.fullmatch(sha) or scope not in SCOPES
        or not isinstance(operator, str) or not LOGIN.fullmatch(operator)
        or not isinstance(payload["nonce"], str) or not NONCE.fullmatch(payload["nonce"])):
        raise ValueError("invalid approval identity")
    issued, expires = payload["issuedAt"], payload["expiresAt"]
    if (type(issued) is not int or type(expires) is not int or
        not 1 <= expires - issued <= 300 or issued > now + 30 or expires < now):
        raise ValueError("approval outside permitted time window")
    if len(sig) != 64:
        raise ValueError("signature length invalid")
    crypto(canonical(payload), public_key, sig)
    if nonce_dir:
        directory = Path(nonce_dir)
        stat = directory.lstat()
        if (not directory.is_dir() or directory.is_symlink() or stat.st_uid != 0
            or stat.st_mode & 0o077):
            raise ValueError("nonce directory must be root-owned and private")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            fd = os.open(directory / payload["nonce"], flags, 0o600)
        except FileExistsError:
            raise ValueError("approval replay") from None
        with os.fdopen(fd, "w") as writer:
            writer.write(sha + "\n" + scope + "\n")
    return payload

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    sign = sub.add_parser("sign")
    sign.add_argument("--key", required=True, help="owner's locally encrypted Ed25519 key")
    sign.add_argument("--ttl", type=int, default=300)
    check = sub.add_parser("verify")
    check.add_argument("--public-key", required=True)
    check.add_argument("--nonce-dir")
    for command in (sign, check):
        command.add_argument("--repository", required=True)
        command.add_argument("--sha", required=True)
        command.add_argument("--scope", required=True, choices=sorted(SCOPES))
        command.add_argument("--operator", required=True)
    a = parser.parse_args()
    try:
        if a.mode == "sign":
            print(issue(a.repository, a.sha, a.scope, a.operator, a.key, ttl=a.ttl))
        else:
            verify(sys.stdin.read().strip(), a.public_key, a.repository, a.sha,
                   a.scope, a.operator, nonce_dir=a.nonce_dir)
            print("DISDEX_OWNER_APPROVAL_VALID")
    except (ValueError, OSError) as e:
        print("DISDEX_OWNER_APPROVAL_BLOCKED: " + str(e), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
