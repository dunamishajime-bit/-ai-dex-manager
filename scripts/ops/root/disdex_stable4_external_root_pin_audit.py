"""Fail-closed read-only attestation against the private Owner-PC Root snapshot pins.

Reads static source bytes and metadata only. Never imports or executes Root
modules, connects to the venue, enables orders, writes service files, or
turns a matching *old snapshot* into an Owner-approved production release.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import stat

from disdex_stable4_root_dependency_graph_readonly import ROOTS, scan

PIN_FILE = Path(__file__).resolve().parents[3] / "config/stable4/root-observed-snapshot-pins-20261116.json"
PIN_SCHEMA = "disdex-stable4-owner-root-observed-pins/v1"
VALID_MODULE = re.compile(r"disdex_[A-Za-z0-9_]+\Z")
VALID_SHA = re.compile(r"[a-f0-9]{64}\Z")
PRODUCTION_ROOT_POSIX = "/usr/local/libexec/disdex-unified"
PRODUCTION_ROOT = Path(PRODUCTION_ROOT_POSIX)


def unique_pairs(rows):
    value = {}
    for name, item in rows:
        if name in value:
            raise ValueError("ROOT_PIN_DUPLICATE_JSON_KEY")
        value[name] = item
    return value


def strict_json(raw):
    def nonfinite(token):
        raise ValueError("ROOT_PIN_NONFINITE:" + token)
    return json.loads(raw, object_pairs_hook=unique_pairs,
                      parse_constant=nonfinite)


def validate_pins(data):
    if (not isinstance(data, dict)
        or data.get("schema") != PIN_SCHEMA
        or data.get("observedSource") != "OWNER_PC_PRIVATE_ROOT_SNAPSHOT_NOT_VPS_LIVE"
        or data.get("rootPath") != PRODUCTION_ROOT_POSIX
        or data.get("sourceClosureCertified") is not False
        or data.get("productionReady") is not False
        or data.get("ownerActivationAuthorized") is not False):
        raise ValueError("ROOT_PIN_UNTRUSTED_DECLARATION")
    expected = data.get("moduleSha256ByName")
    if (not isinstance(expected, dict) or not 1 <= len(expected) <= 128
        or not all(isinstance(name, str) and VALID_MODULE.fullmatch(name)
                   and isinstance(digest, str) and VALID_SHA.fullmatch(digest)
                   for name, digest in expected.items())
        or any(name not in expected for name in ROOTS)):
        raise ValueError("ROOT_PIN_MODULES_INVALID")
    dynamic = data.get("expectedDynamicImports")
    if not isinstance(dynamic, list) or len(dynamic) > 128:
        raise ValueError("ROOT_PIN_DYNAMIC_SITES_INVALID")
    for site in dynamic:
        if (not isinstance(site, dict)
            or set(site) != {"module", "line", "kind"}
            or site["module"] not in expected
            or type(site["line"]) is not int or site["line"] <= 0
            or site["kind"] not in ("EXTERNAL_CODE_LOADER_REQUIRES_REVIEW",
                                    "DYNAMIC_MODULE_NAME")):
            raise ValueError("ROOT_PIN_DYNAMIC_SITE_INVALID")
    return expected, dynamic


def read_pin_file(path, *, offline_snapshot):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("ROOT_PIN_SOURCE_LINK_OR_MISSING")
    meta = path.lstat()
    if not stat.S_ISREG(meta.st_mode) or meta.st_size > 100_000:
        raise ValueError("ROOT_PIN_SOURCE_METADATA_INVALID")
    if not offline_snapshot:
        if path.resolve(strict=True) != PIN_FILE.resolve(strict=True):
            raise ValueError("ROOT_PIN_SOURCE_NOT_CANONICAL")
        if meta.st_uid != 0 or meta.st_mode & 0o022:
            raise ValueError("ROOT_PIN_SOURCE_NOT_ROOT_OWNED")
    return strict_json(path.read_bytes())


def site_identity(row):
    return row["module"], row["line"], row["kind"]


def assess(*, root=PRODUCTION_ROOT, declaration, offline_snapshot=False):
    expected, dynamic = validate_pins(declaration)
    root = Path(root)
    if not offline_snapshot and root != PRODUCTION_ROOT:
        raise ValueError("ROOT_PIN_PRODUCTION_PATH_MISMATCH")
    snapshot = scan(root=root, expected_sha256_by_name=expected,
                    enforce_root_ownership=not offline_snapshot,
                    owner_uid=0)
    if snapshot["missing"] or set(snapshot["modules"]) != set(expected):
        raise ValueError("ROOT_PIN_MODULE_GRAPH_NOT_EXACT")
    if Counter(map(site_identity, snapshot["dynamicImports"])) != Counter(
            map(site_identity, dynamic)):
        raise ValueError("ROOT_PIN_DYNAMIC_LOADER_DRIFT")
    # Matching historical pins is only a useful cross-check. It cannot
    # replace independent external review of executable dynamic code.
    return {
        "schema": "disdex-stable4-owner-root-pin-audit/v1",
        "status": "ROOT_PIN_HASHES_MATCH_DYNAMIC_LOADER_REVIEW_PENDING",
        "moduleCount": snapshot["moduleCount"],
        "dynamicSiteCount": len(snapshot["dynamicImports"]),
        "rootOwnershipChecked": not offline_snapshot,
        "snapshotSource": declaration["observedSource"],
        "sourceClosureCertified": False,
        "externalRootIndependentlyReviewed": False,
        "deploymentAuthorized": False,
        "productionReady": False,
        "ordersEnabled": False,
        "productionMutated": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pins", type=Path, default=PIN_FILE)
    parser.add_argument("--root", type=Path, default=PRODUCTION_ROOT)
    parser.add_argument("--offline-snapshot", action="store_true")
    args = parser.parse_args()
    try:
        declaration = read_pin_file(args.pins, offline_snapshot=args.offline_snapshot)
        result = assess(root=args.root, declaration=declaration,
                        offline_snapshot=args.offline_snapshot)
    except (OSError, ValueError, SyntaxError, json.JSONDecodeError) as exc:
        print(json.dumps({"schema": "disdex-stable4-owner-root-pin-audit/v1",
                          "status": "BLOCKED_ROOT_PIN_AUDIT",
                          "reason": str(exc)[:256],
                          "sourceClosureCertified": False,
                          "deploymentAuthorized": False,
                          "ordersEnabled": False,
                          "productionMutated": False}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True, indent=2))
    # Even on a fully matching observed snapshot, dynamic code remains
    # unreviewed. This must never count as an activation or certify gate.
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
