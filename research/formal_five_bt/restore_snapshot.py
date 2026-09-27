"""Read-only reconstruction of audited LIVE source snapshot from exact Git blobs.

Does NOT update the source manifest. All allowlisted files must match their
SHA256 in the historical audit or the entire restore fails closed. Never read
environment files, secrets, VPS state, runtime orders or account records.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import subprocess

from .manifest import load_manifest

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
ALLOWED_TOP = {"config", "lib", "scripts", "data"}
ALLOWED_SUFFIX = {".ts", ".js", ".py", ".json"}


def restore_snapshot(repo: Path, manifest_path: Path, destination: Path) -> dict:
    repo = repo.resolve()
    destination = destination.resolve()
    manifest = load_manifest(manifest_path)
    commit = manifest.get("verified_repository_commit")
    if not isinstance(commit, str) or not COMMIT_RE.fullmatch(commit):
        raise ValueError("INVALID_AUDITED_GIT_COMMIT")
    expected = manifest.get("files")
    if not isinstance(expected, list) or not expected:
        raise ValueError("SOURCE_MANIFEST_EMPTY")
    files: dict[str, bytes] = {}
    for record in expected:
        relative = record["path"]
        parsed = PurePosixPath(relative)
        if (parsed.is_absolute() or ".." in parsed.parts or len(parsed.parts) < 2
                or parsed.parts[0] not in ALLOWED_TOP or parsed.suffix not in ALLOWED_SUFFIX
                or str(parsed) != relative or relative in files):
            raise ValueError("INVALID_OR_DUPLICATE_AUDITED_SOURCE_PATH")
        try:
            proc = subprocess.run(["git", "show", f"{commit}:{relative}"],
                                  cwd=repo, check=True, capture_output=True)
        except subprocess.CalledProcessError as error:
            raise ValueError(f"AUDITED_GIT_SOURCE_MISSING:{relative}") from error
        raw = proc.stdout
        if hashlib.sha256(raw).hexdigest() != record["sha256"]:
            raise ValueError(f"AUDITED_GIT_SOURCE_SHA256_MISMATCH:{relative}")
        files[relative] = raw
    # Do not leave a partly verified snapshot if one source fails.
    for relative, raw in files.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    return {"runtime_sha": manifest["runtime_sha"],
            "repository_commit": commit,
            "verified_source_files": len(files), "status": "HASH_VERIFIED"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("runtime_source_manifest.json"))
    parser.add_argument("--snapshot-root", type=Path, default=Path(__file__).with_name("runtime_source_snapshot"))
    args = parser.parse_args()
    import json
    print(json.dumps(restore_snapshot(args.repo_root, args.manifest, args.snapshot_root), sort_keys=True))


if __name__ == "__main__":
    main()
