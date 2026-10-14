#!/usr/bin/env python3
"""Read-only Git-object parity gate for staged DisDex releases.

Run on a STAGED directory, before any Production promotion:
  python3 scripts/ops/verify-v12-v4-release-tree.py --repository REPO --release STAGE --sha EXACT_40_HEX_SHA

Git SHA and LF policy are verified on tracked source files. Missing, extra
generated files (e.g. node_modules) are treated differently: all tracked files
must match byte-for-byte. This script NEVER modifies files or runner state.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


def blob_hash(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def verify(repository: Path, release: Path, sha: str) -> int:
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("Expected exact 40-character lowercase Git SHA")
    if not release.is_dir() or release.is_symlink():
        raise ValueError("Release must be a real directory")
    if repository.resolve() == release.resolve():
        # Checking a checkout is allowed (e.g. CI), but this script is never a writer.
        pass
    marker = release / ".disdex-release-sha"
    if marker.exists() and marker.read_text(encoding="utf-8").strip() != sha:
        raise ValueError("Release marker does not match the expected commit")

    output = subprocess.run(
        ["git", "-C", str(repository), "ls-tree", "-rz", sha],
        capture_output=True, check=True,
    ).stdout
    exact = 0
    crlf = []
    different = []
    missing = []
    unsafe = []
    for line in output.split(b"\0"):
        if not line:
            continue
        header, path_bytes = line.split(b"\t", 1)
        mode, kind, expected = header.split(b" ", 2)
        if kind != b"blob":
            continue
        name = path_bytes.decode("utf-8", errors="surrogateescape")
        parts = Path(name).parts
        if not parts or name.startswith("/") or ".." in parts:
            unsafe.append(name)
            continue
        local = release.joinpath(*parts)
        try:
            info = local.lstat()
            if mode == b"120000":
                if not stat.S_ISLNK(info.st_mode):
                    unsafe.append(name)
                    continue
                data = os.readlink(local).encode("utf-8", errors="surrogateescape")
            else:
                if not stat.S_ISREG(info.st_mode) or local.is_symlink():
                    unsafe.append(name)
                    continue
                data = local.read_bytes()
                if mode == b"100755" and not (info.st_mode & stat.S_IXUSR):
                    unsafe.append(name)
                    continue
        except FileNotFoundError:
            missing.append(name)
            continue
        actual = blob_hash(data)
        if actual == expected.decode("ascii"):
            exact += 1
        elif blob_hash(data.replace(b"\r\n", b"\n")) == expected.decode("ascii"):
            crlf.append(name)
        else:
            different.append(name)

    print(f"SOURCE_SHA={sha} EXACT={exact} CRLF_ONLY={len(crlf)} "
          f"DIFFERENT={len(different)} MISSING={len(missing)} UNSAFE={len(unsafe)}")
    for label, values in [
        ("CRLF_ONLY", crlf), ("DIFFERENT", different),
        ("MISSING", missing), ("UNSAFE", unsafe),
    ]:
        for name in values[:20]:
            print(f"{label}: {name}")
        if len(values) > 20:
            print(f"{label}: ... and {len(values) - 20} more")
    if crlf or different or missing or unsafe:
        print("BLOCKED_RELEASE_PARITY: build or package from an LF checkout. "
              "Do not rewrite files in an active Production release.", file=sys.stderr)
        return 2
    print("EXACT_GIT_RELEASE_PARITY_PASS")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    try:
        return verify(args.repository, args.release, args.sha)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"RELEASE_PARITY_UNAVAILABLE: {error}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
