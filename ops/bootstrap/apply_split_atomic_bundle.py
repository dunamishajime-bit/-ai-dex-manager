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
EXPECTED_ARCHIVE_SHA256 = "d0f968b8d3fda23bda9c090cd8e2138a0bce589c3af8edfee9847dbc265826ff"
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


def safe_member_name(name: str) -> str:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or ".." in path.parts or "." in path.parts:
        raise RuntimeError(f"unsafe archive path: {name!r}")
    normalized = path.as_posix()
    if normalized not in EXPECTED_PATHS:
        raise RuntimeError(f"unexpected archive path: {normalized}")
    return normalized


def load_archive() -> bytes:
    parts = sorted(BOOTSTRAP_DIR.glob("bundle.part*"))
    expected_names = [f"bundle.part{index:02d}" for index in range(5)]
    if [part.name for part in parts] != expected_names:
        raise RuntimeError(f"bundle parts mismatch: {[part.name for part in parts]}")
    encoded = b"".join(part.read_bytes() for part in parts)
    archive = base64.b64decode(encoded, validate=True)
    digest = hashlib.sha256(archive).hexdigest()
    if digest != EXPECTED_ARCHIVE_SHA256:
        raise RuntimeError(f"archive sha256 mismatch: {digest}")
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
    WORKFLOW_PATH.unlink()
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
    if branch != "codex/research-trade-history-sync-pr98":
        raise RuntimeError(f"unexpected workflow branch: {branch!r}")
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
