#!/usr/bin/env python3
"""Build only the patched files for review, never a production release."""
import argparse
from pathlib import Path
import shutil
import subprocess

BASE = "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81"
ROOT = Path(__file__).resolve().parents[3]
OLD = '''    expected_sha = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA") or "").strip()
    if expected_sha and runtime_sha.lower() != expected_sha.lower():
        raise RuntimeError("QUALITY102_STATE_MISMATCH:runtimeCommitSha")'''
NEW = '''    # A peer owns this state: the V52 program SHA cannot authenticate Q102.
    verify_q102_identity(runtime_sha)'''
IDLE_OLD = '''    expected_sha = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA") or "").strip().lower()
    if not _SHA256_RE.fullmatch(expected_sha):
        fail("RUNTIME_SHA_UNSET")'''
IDLE_COMPARE = '''    if str(document.get("runtimeSha") or "").lower() != expected_sha:
        fail("RELEASE_SHA")'''
FET_OLD = '''                expected = str(os.environ.get("DISDEX_RUNTIME_COMMIT_SHA") or "")'''
Q102_EMPTY_OLD = '''    position = root.get("position")
    if position is None:
        return None'''
Q102_EMPTY_NEW = '''    position = root.get("position")
    if position is None:
        # A submitted/unknown entry can still consume exposure.  Do not treat
        # an unprocessed pending entry as a flat, available portfolio.
        if root.get("pending") is not None:
            raise RuntimeError("QUALITY102_PENDING_UNRECONCILED")
        return None'''
VALIDATE_START_OLD = '''    root = _quality102_object(raw, "root")
    allowed = {'''
VALIDATE_START_NEW = '''    return _validate_quality102_live_state_document(raw, now_ms=now_ms)


def _validate_quality102_live_state_document(raw, *, now_ms=None):
    root = _quality102_object(raw, "root")
    allowed = {'''
DOCUMENT_OLD = '''    owned = load_quality102_live_state(resolved, now_ms=now_ms)
    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:json") from error
    if not isinstance(raw, dict):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:root")
    return resolved, raw, owned'''
DOCUMENT_NEW = '''    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("QUALITY102_STATE_MALFORMED:json") from error
    if not isinstance(raw, dict):
        raise RuntimeError("QUALITY102_STATE_MALFORMED:root")
    owned = _validate_quality102_live_state_document(raw, now_ms=now_ms)
    return resolved, raw, owned'''


def patch_planner(source):
    if any(source.count(part) != 1 for part in (OLD, IDLE_OLD, IDLE_COMPARE, FET_OLD, Q102_EMPTY_OLD,
                                                 VALIDATE_START_OLD, DOCUMENT_OLD,
                                                 "from __future__ import annotations")):
        raise RuntimeError("V52_PREVIEW_UNEXPECTED_BASELINE")
    return (source.replace("from __future__ import annotations", "from __future__ import annotations\n\nfrom v52_q102_independent_pin import verify_q102_identity, verify_peer_identity", 1)
            .replace(OLD, NEW, 1).replace(Q102_EMPTY_OLD, Q102_EMPTY_NEW, 1)
            .replace(VALIDATE_START_OLD, VALIDATE_START_NEW, 1).replace(DOCUMENT_OLD, DOCUMENT_NEW, 1)
            .replace(IDLE_OLD, "    # Identity is checked against the independently pinned Idle service below.", 1)
            .replace(IDLE_COMPARE, '''    try:
        verify_peer_identity("IDLE_PRIORITY_SHORT", str(document.get("runtimeSha") or "").lower())
    except RuntimeError:
        fail("RELEASE_SHA")''', 1)
            .replace(FET_OLD, '''                try:
                    expected = verify_peer_identity("FET_BRK48_RESIDUAL", str(fet.get("runtimeCommitSha") or "").lower())
                except RuntimeError as error:
                    raise ValueError("peer pin mismatch") from error''', 1))


def build(output):
    output = Path(output)
    # Never overwrite a release or a previously built directory.
    output.mkdir(parents=False, exist_ok=False)
    source = subprocess.check_output(["git", "show", BASE + ":scripts/disdex_strict_portfolio_planner.py"], cwd=ROOT, text=True, encoding="utf8")
    (output / "disdex_strict_portfolio_planner.py").write_text(patch_planner(source), encoding="utf8")
    shutil.copyfile(ROOT / "scripts/v52_q102_independent_pin.py", output / "v52_q102_independent_pin.py")
    (output / "PREVIEW_NOT_A_RELEASE.txt").write_text("source-only preview; no release marker or approval\n", encoding="utf8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    args = parser.parse_args()
    build(args.output)
    print("V52_Q102_PREVIEW_NOT_LIVE")
