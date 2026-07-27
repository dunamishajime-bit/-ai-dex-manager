#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = ROOT / "ops" / "bootstrap"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "apply-split-atomic-bootstrap.yml"
EXPECTED_ARCHIVE_SHA256 = "2a4c0dfd42aa8cc6e88ffc352126a37de9b9e2b864d689dae3d122ab9e1b3760"
EXPECTED_PART_GIT_BLOBS = {
    "bundle.part00": "0e1d86ea923a3f71843a8328ead4f17739390610",
    "bundle.part01": "0c89dc3d2ee862e619c09dab0de50a2231a1243b",
    "bundle.part02": "25f8467693930ad015a55ea0a94474ecc02ce576",
    "bundle.part03": "3810d7c5ad9818aa008524c654f873d9a0be49ea",
    "bundle.part04": "e73c27d02bd1f8b80967efbf0089499f822ec1b7",
}
EXPECTED_PATHS = {
    "scripts/ops/vps-common.sh",
    "scripts/ops/root/disdex-vps-control",
    "ops/systemd/disdex-v96-v52-preflight@.service",
    "ops/systemd/disdex-v96-v52-live.atomic-override.conf.example",
    "ops/pm2/ai-dex-manager-ui.atomic.config.cjs.example",
    "scripts/ops/vps-deploy-ui.sh",
    "scripts/ops/vps-deploy-trading-code.sh",
    "scripts/ops/vps-restart-trading-approved.sh",
    "scripts/ops/vps-inspection.mjs",
    "scripts/ops/vps-ops-selftest.mjs",
    ".github/workflows/inspect-vps.yml",
    ".github/workflows/deploy-ui-vps.yml",
    ".github/workflows/deploy-trading-code-vps.yml",
    ".github/workflows/restart-trading-approved.yml",
    ".github/workflows/vps-ops-static-ci.yml",
    "docs/implementation/SPLIT_ATOMIC_VPS_MIGRATION.md",
    "CODEX_VPS_RUNNER_TASK.md",
    "docs/implementation/PLUS_VPS_RUNNER_LAYOUT_ADDENDUM.md",
}


def run(*args: str) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def safe_member_name(name: str) -> str:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or ".." in path.parts or "." in path.parts:
        raise RuntimeError(f"unsafe archive path: {name!r}")
    normalized = path.as_posix()
    if normalized not in EXPECTED_PATHS:
        raise RuntimeError(f"unexpected archive path: {normalized}")
    return normalized


def load_archive() -> bytes:
    expected_names = list(EXPECTED_PART_GIT_BLOBS)
    parts = [BOOTSTRAP_DIR / name for name in expected_names]
    if not all(part.is_file() for part in parts):
        found = sorted(path.name for path in BOOTSTRAP_DIR.glob("bundle.part*"))
        raise RuntimeError(f"bundle parts mismatch: {found}")

    encoded_parts: list[bytes] = []
    for part in parts:
        data = part.read_bytes()
        actual_blob = git_blob_sha(data)
        expected_blob = EXPECTED_PART_GIT_BLOBS[part.name]
        if actual_blob != expected_blob:
            raise RuntimeError(
                f"bundle part Git blob mismatch for {part.name}: "
                f"expected={expected_blob} actual={actual_blob}"
            )
        encoded_parts.append(data)

    archive = base64.b64decode(b"".join(encoded_parts), validate=True)
    digest = hashlib.sha256(archive).hexdigest()
    if digest != EXPECTED_ARCHIVE_SHA256:
        raise RuntimeError(
            f"archive sha256 mismatch: expected={EXPECTED_ARCHIVE_SHA256} actual={digest}"
        )
    return archive


def apply_archive(archive: bytes) -> None:
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        members = bundle.getmembers()
        names = [safe_member_name(member.name) for member in members]
        if len(names) != len(set(names)):
            raise RuntimeError("duplicate archive paths")
        if set(names) != EXPECTED_PATHS:
            missing = sorted(EXPECTED_PATHS - set(names))
            extra = sorted(set(names) - EXPECTED_PATHS)
            raise RuntimeError(f"archive path set mismatch; missing={missing}, extra={extra}")
        if any(not member.isfile() for member in members):
            raise RuntimeError("archive contains a non-regular file")

        with tempfile.TemporaryDirectory(prefix="split-atomic-bootstrap-") as tmp:
            stage = Path(tmp)
            for member, name in zip(members, names, strict=True):
                source = bundle.extractfile(member)
                if source is None:
                    raise RuntimeError(f"cannot read archive member: {name}")
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read())

            for name in sorted(EXPECTED_PATHS):
                source = stage / name
                target = ROOT / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                os.chmod(target, 0o644)


def validate() -> None:
    run(
        "bash",
        "-n",
        "scripts/ops/vps-common.sh",
        "scripts/ops/root/disdex-vps-control",
        "scripts/ops/vps-deploy-ui.sh",
        "scripts/ops/vps-deploy-trading-code.sh",
        "scripts/ops/vps-restart-trading-approved.sh",
    )
    run("node", "--check", "scripts/ops/vps-inspection.mjs")
    run("node", "--check", "scripts/ops/vps-trading-restart-gate.mjs")
    run("node", "--check", "scripts/ops/vps-ops-selftest.mjs")
    run("node", "scripts/ops/vps-ops-selftest.mjs")
    run("git", "diff", "--check")


def remove_bootstrap_files() -> None:
    for path in BOOTSTRAP_DIR.glob("bundle.part*"):
        path.unlink()
    Path(__file__).unlink()
    WORKFLOW_PATH.unlink(missing_ok=True)
    try:
        BOOTSTRAP_DIR.rmdir()
    except OSError:
        pass


def commit_and_push() -> None:
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "add", "-A")
    status = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, check=True, text=True, capture_output=True
    ).stdout.strip()
    if not status:
        raise RuntimeError("bootstrap produced no repository changes")
    run("git", "commit", "-m", "Adopt split atomic VPS release layout")
    branch = os.environ.get("GITHUB_REF_NAME", "").strip()
    if not branch:
        branch = subprocess.run(
            ["git", "branch", "--show-current"], cwd=ROOT, check=True, text=True, capture_output=True
        ).stdout.strip()
    if branch != "codex/research-trade-history-sync-pr98":
        raise RuntimeError(f"unexpected bootstrap branch: {branch!r}")
    run("git", "push", "origin", f"HEAD:{branch}")


def main() -> None:
    if ROOT != Path.cwd().resolve():
        raise RuntimeError(f"run from repository root: cwd={Path.cwd()}, root={ROOT}")
    archive = load_archive()
    apply_archive(archive)
    validate()
    remove_bootstrap_files()
    run("git", "diff", "--check")
    commit_and_push()


if __name__ == "__main__":
    main()
