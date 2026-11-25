"""Read-only H48 integrated-source audit; never issue, install or authorize a permit.

Pinned to the monitor release verified on 2026-11-25. A matching source is
necessary evidence, not authorization. The formal issuer and executor must
retain their independent approved-plan, signature, venue and risk gates.
"""
import argparse
import hashlib
import json
import stat
import sys
import unittest
from pathlib import Path

SOURCE = "4786f600ae7bf86ffca948f1412956a9113cb20d"
PINS = {
    "lib/hype-zec-long-runner.ts": (
        "2ea2a5b2d39efab004714b6468e080d9300cf547e465d6c036d3c7e1357523de",
        "ad51d66680765f8f7d39b49a96c47b831bdb1dbb"),
    "lib/hype-h48-order-permit.ts": (
        "9a33eced492a24c4d9668bc81cb6b3085ccc1fa715ece2718ae9896bcd2c7bb8",
        "669ef0471c5c3a5d809eb37724807513fec1e990"),
    "lib/hype-stable4-time-only-authority.ts": (
        "ce408f45323f03940bcb33a33bbb4b80d0db2e58fc568e6d102f55254839953d",
        "da46e779ec3bfef4c658fb902ab698dd9445fc35"),
    "lib/hype-stable4-time-only-contract.ts": (
        "2c27fa29c54d467d31f6e8625fd6f93c24340b6fc7bd9a907ffe1eaa5cc09c25",
        "1322ad28afe0e643a1dff6c0ef16680ceb79158a"),
    "scripts/ops/root/disdex_stable4_h48_policy.py": (
        "3a43b8f874b18d430c8c4027471236aef6e1199c022d5ff410dc5b8e76bb6a8d",
        "e17da7467be33cb54bc28b2466396bd4de0dea3e"),
}
RELEASE = Path("/home/deploy/disdex-trading/releases") / SOURCE
ARTIFACTS = Path("/etc/disdex/stable4/h48-time-only")
RECEIPTS = Path("/var/lib/disdex/unified-deploy/h48-owner-policy-issuance")
OVERLAY = Path("/var/lib/disdex/hype-zec-long/runtime-overlays/h48-order-enable-v1")

def digests(raw):
    return (hashlib.sha256(raw).hexdigest(),
            hashlib.sha1(("blob " + str(len(raw)) + "\0").encode("ascii") + raw).hexdigest())

def regular_immutable(mode):
    return stat.S_ISREG(mode) and not (mode & 0o222)

def check_bytes(raw, expected, mode):
    if not regular_immutable(mode):
        return "NOT_IMMUTABLE_REGULAR_FILE"
    if digests(raw) != expected:
        return "HASH_MISMATCH"
    return "MATCH"

def artifact_status(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return "MISSING"
    if not regular_immutable(info.st_mode) or info.st_uid != 0:
        return "METADATA_INVALID"
    # Presence is deliberately not called a valid certificate or permit.
    return "PRESENT_NOT_AUTHENTICATED"

def source_status(root, rel, expected):
    path = root / rel
    try:
        if any(p.is_symlink() for p in [path, *path.parents]):
            return "SYMLINK"
        before = path.lstat()
        if not regular_immutable(before.st_mode):
            return "NOT_IMMUTABLE_REGULAR_FILE"
        raw = path.read_bytes()
        after = path.lstat()
        if (before.st_dev, before.st_ino, before.st_mode, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns):
            return "CHANGED_DURING_READ"
        return check_bytes(raw, expected, after.st_mode)
    except OSError:
        return "UNREADABLE"

def audit():
    sources = {rel: source_status(RELEASE, rel, pin) for rel, pin in PINS.items()}
    artifacts = {
        "certificate": artifact_status(ARTIFACTS / (SOURCE + ".json")),
        "receipt": artifact_status(RECEIPTS / (SOURCE + ".json")),
        "permit": artifact_status(ARTIFACTS / (SOURCE + ".order-enable.json")),
    }
    old_permits = sorted(p.name for p in ARTIFACTS.glob("*.order-enable.json")
                         if p.name != SOURCE + ".order-enable.json")
    old_overlay = {name: artifact_status(OVERLAY / name) for name in (
        "hype-zec-long-runner.ts", "hype-h48-order-permit.ts")}
    return {"status": "READ_ONLY_AUDIT_NOT_AUTHORIZATION", "sourceSha": SOURCE,
            "integratedSourceMatches": all(v == "MATCH" for v in sources.values()),
            "sourceFiles": sources, "artifactMetadata": artifacts,
            "legacyPermitNames": old_permits, "legacyOverlay": old_overlay,
            "authorizationEvaluated": False, "ordersEnabledByAudit": False}

class AuditTests(unittest.TestCase):
    def test_exact_bytes(self):
        raw = b"synthetic source"
        self.assertEqual(check_bytes(raw, digests(raw), stat.S_IFREG | 0o444), "MATCH")

    def test_changed_bytes_rejected(self):
        self.assertEqual(check_bytes(b"changed", digests(b"original"), stat.S_IFREG | 0o444),
                         "HASH_MISMATCH")

    def test_writable_rejected(self):
        self.assertEqual(check_bytes(b"x", digests(b"x"), stat.S_IFREG | 0o644),
                         "NOT_IMMUTABLE_REGULAR_FILE")

    def test_symlink_rejected(self):
        self.assertEqual(check_bytes(b"x", digests(b"x"), stat.S_IFLNK | 0o444),
                         "NOT_IMMUTABLE_REGULAR_FILE")

    def test_both_digests_required(self):
        pin = digests(b"x")
        self.assertEqual(check_bytes(b"x", (pin[0], "0" * 40), stat.S_IFREG | 0o444),
                         "HASH_MISMATCH")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return 0 if unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(AuditTests)).wasSuccessful() else 1
    report = audit()
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["integratedSourceMatches"] else 1

if __name__ == "__main__":
    sys.exit(main())
