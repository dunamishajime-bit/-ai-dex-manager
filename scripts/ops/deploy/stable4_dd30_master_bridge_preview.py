#!/usr/bin/env python3
"""Deterministic PRE-LIVE candidate+master control-plane source bundle.

This utility never connects to VPS, redeems approvals, edits Git refs, invokes
systemd, or emits executable LIVE permits. Its output is an offline evidence
artifact only; Codex must construct a new reviewed Git SHA and approval plan.
"""
from __future__ import annotations

import argparse
from collections import Counter
from io import BytesIO
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile

CANDIDATE_SHA = "179e3f4e50f86ca8ab60baadaba1a96ed4c914ee"
CONTROL_SHA = "1eeb864b7b8be2a0279be9ed60af1b9ad234d8ed"
CANDIDATE_SOURCE_DIRS = ("lib", "config", "scripts", "ops")
CANDIDATE_ROOT_FILES = (
    "package.json", "package-lock.json", "tsconfig.json",
    "tsconfig.live-runner.json", "tsconfig.pengu-dual-ls-v1.json",
    "tsconfig.pengu-dual-ls-v2.json", "tsconfig.v12-v4-shadow.json",
    "requirements-stock-aster-only.txt", "requirements-stock-live.txt",
)
CONTROL_DIR = "scripts/ops/deploy"
MAX_SINGLE_FILE = 20 * 1024 * 1024
MAX_TOTAL_DATA = 180 * 1024 * 1024
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REVIEWED_WORKFLOWS = (
    ".github/workflows/disdex-stable4-safety-repair-cutover.yml",
    ".github/workflows/disdex-stable4-safety-repair-ci.yml",
    ".github/workflows/disdex-stable4-runner-scoped-order-enable.yml",
    ".github/workflows/disdex-stable4-runner-bundle-order-enable.yml",
    ".github/workflows/disdex-stable4-h48-owner-gates.yml",
)
REQUIRED = (
    "config/v12V4AdoptionRiskPolicy.ts",
    "config/integratedProductionRiskPolicy.ts",
    "config/sharedCryptoRiskPolicy.ts",
    "lib/v12-v4-runner-engine.ts",
    "lib/v12-v4-shared-reservations.ts",
    "lib/v12-v4-venue-exit.ts",
    "lib/v12-v4-stop-retirement.ts",
    "lib/pengu-dual-ls-v2-portfolio-runner.ts",
    "lib/disdex-quality102-causal-v1-runner.ts",
    "lib/fet-brk48-live-runner.ts",
    "lib/hype-trend-long-runner.ts",
    "lib/idle-priority-short-runner.ts",
    "scripts/v12-v4-production-runner.ts",
    "scripts/disdex_v52_aster_only_legacy_engine.py",
    "scripts/ops/deploy/disdex_owner_approval.py",
    "scripts/ops/deploy/disdex_stable4_safety_repair_cutover.py",
    "scripts/ops/deploy/disdex_deployment_contract.py",
)


class PreliveBundleError(RuntimeError):
    pass


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(repo: Path, *args: str) -> bytes:
    z = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, timeout=90, check=False)
    if z.returncode:
        raise PreliveBundleError("GIT_SOURCE_UNAVAILABLE:" + " ".join(args[:2]))
    return z.stdout


def read_git_archive(repo: Path, ref: str, paths: tuple[str, ...]) -> dict[str, bytes]:
    if not SHA_RE.fullmatch(ref):
        raise PreliveBundleError("SOURCE_REF_NOT_A_PINNED_SHA")
    raw = git(repo, "archive", "--format=tar", ref, "--", *paths)
    out: dict[str, bytes] = {}
    total = 0
    with tarfile.open(fileobj=BytesIO(raw), mode="r:") as archive:
        for member in archive:
            if member.isdir():
                continue
            if not member.isfile() or member.issym() or member.islnk():
                raise PreliveBundleError("SYMLINK_OR_UNEXPECTED_GIT_OBJECT")
            rel = member.name
            path = PurePosixPath(rel)
            if (path.is_absolute() or ".." in path.parts or "\\" in rel
                    or str(path) != rel or rel in out):
                raise PreliveBundleError("UNSAFE_OR_DUPLICATE_FILE:" + rel)
            if member.size > MAX_SINGLE_FILE:
                raise PreliveBundleError("FILE_EXCEEDS_PRELIVE_LIMIT:" + rel)
            stream = archive.extractfile(member)
            if stream is None:
                raise PreliveBundleError("FILE_UNREADABLE:" + rel)
            value = stream.read()
            total += len(value)
            if total > MAX_TOTAL_DATA:
                raise PreliveBundleError("BUNDLE_SIZE_LIMIT")
            out[rel] = value
    return out


def prepare(repo: Path, *, candidate_sha: str = CANDIDATE_SHA,
            control_sha: str = CONTROL_SHA) -> tuple[bytes, dict]:
    if candidate_sha != CANDIDATE_SHA or control_sha != CONTROL_SHA:
        raise PreliveBundleError("UNREVIEWED_SOURCE_SHA")
    if len(git(repo, "rev-parse", candidate_sha).strip()) != 40:
        raise PreliveBundleError("INVALID_CANDIDATE_COMMIT")
    if len(git(repo, "rev-parse", control_sha).strip()) != 40:
        raise PreliveBundleError("INVALID_MASTER_COMMIT")
    sources = read_git_archive(
        repo, candidate_sha, CANDIDATE_SOURCE_DIRS + CANDIDATE_ROOT_FILES)
    # The authoritative deploy/approval code must come only from master.
    protected = {k for k in sources if k.startswith(CONTROL_DIR + "/")}
    for path in protected:
        del sources[path]
    formal = read_git_archive(repo, control_sha, (CONTROL_DIR,))
    if any(not k.startswith(CONTROL_DIR + "/") for k in formal):
        raise PreliveBundleError("MASTER_CONTROLPLANE_PATH_ESCAPE")
    sources.update(formal)
    workflows = read_git_archive(repo, control_sha, REVIEWED_WORKFLOWS)
    for path in REQUIRED:
        if path not in sources:
            raise PreliveBundleError("REQUIRED_RUNNER_OR_ROOT_MISSING:" + path)
    policy = sources["config/v12V4AdoptionRiskPolicy.ts"].decode("utf-8")
    if "V12_V4_MAXIMUM_DRAWDOWN = 0.30" not in policy:
        raise PreliveBundleError("V4_DD30_POLICY_NOT_IN_BUNDLE")
    if "V4_SHARED_RESERVATION_HOLD" not in sources[
        "lib/v12-v4-shared-reservations.ts"].decode("utf-8"):
        raise PreliveBundleError("V4_ENTRY_DD_GATE_DISCONNECTED")
    if "attestV4CompletedExitMissingStop" not in sources[
        "lib/v12-v4-runner-engine.ts"].decode("utf-8"):
        raise PreliveBundleError("V4_STOP_PROTECTION_NOT_PRESENT")
    if "strategy_daily_loss_held = self.enforce_daily_loss()" not in sources[
        "scripts/disdex_v52_aster_only_legacy_engine.py"].decode("utf-8"):
        raise PreliveBundleError("V52_EXIT_PROTECTION_NOT_PRESENT")
    if "Q102 existing-position H1 history unavailable" not in sources[
        "lib/disdex-quality102-causal-v1-runner.ts"].decode("utf-8"):
        raise PreliveBundleError("Q102_EXIT_PROTECTION_NOT_PRESENT")
    # This historical master workflow still pins c731 & old approval.  Never
    # represent this pre-LIVE combination as ready for that formal cutover.
    cutover = workflows[".github/workflows/disdex-stable4-safety-repair-cutover.yml"]
    if b"c7310d34ba1b6de07071d8883a2ed0de8dcce2a7" not in cutover:
        raise PreliveBundleError("MASTER_CONTROLPLANE_PIN_UNEXPECTED")
    files_hash = {k: sha(v) for k, v in sorted(sources.items())}
    internal = {
        "schema": "disdex-stable4-dd30-prelive-bundle/v1",
        "candidateSourceCommit": candidate_sha,
        "formalControlPlaneCommit": control_sha,
        "globalHoldUnchanged": True,
        "liveOrderEnable": False,
        "productionDeploymentReady": False,
        "ownerDD30ApprovalVerified": False,
        "formalRootWorkflowRetargeted": False,
        "requiresNewReviewedCommitAndOwnerPlan": True,
        "payloadSha256": files_hash,
        "workflowSourceSha256": {
            k: sha(v) for k, v in sorted(workflows.items())
        },
        "sourceAttribution": {
            "candidateRunnerSources": len(files_hash) - len(formal),
            "replacedByMasterControlPlane": len(protected),
            "masterControlPlaneFiles": len(formal),
        },
    }
    marker = "STABLE4_PRELIVE_SOURCE_MANIFEST.json"
    if marker in sources:
        raise PreliveBundleError("MANIFEST_PATH_CONFLICT")
    sources[marker] = (json.dumps(internal, ensure_ascii=False,
                                  indent=2, sort_keys=True) + "\n").encode()
    buffer = BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0,
                       filename="", compresslevel=6) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.USTAR_FORMAT) as tar:
            for path, value in sorted(sources.items()):
                member = tarfile.TarInfo(path)
                member.mtime = 0
                member.uid = member.gid = 0
                member.uname = member.gname = ""
                member.mode = 0o644
                member.size = len(value)
                tar.addfile(member, BytesIO(value))
    bundle = buffer.getvalue()
    report = {
        "schema": "disdex-stable4-dd30-bridge-preview/v1",
        "sourceCommit": candidate_sha,
        "masterCommit": control_sha,
        "bundleSHA256": sha(bundle),
        "bundleBytes": len(bundle),
        "files": len(sources),
        "sourceDetails": internal["sourceAttribution"],
        "masterWorkflowSHA256": internal["workflowSourceSha256"],
        "candidateV4DdEntryHold": 0.30,
        "formalApproval": "NOT_ISSUED",
        "formalImmutableGitReleaseCommit": "NOT_CREATED",
        "productionInstalled": False,
        "runOnlyAsPreliveResearch": True,
        "codexReviewRequired": True,
        "blockedReasons": [
            "NO_NEW_COMPOSITE_GIT_COMMIT_IN_FORMAL_OWNER_SCOPE",
            "FORMAL_ROOT_CUTOVER_TARGET_STILL_C731_OLD_PLAN",
            "NO_DD30_OWNER_APPROVAL",
            "NO_CURRENT_VPS_RUNNER_AND_STOP_READINESS_CERT",
            "OLD_Q102_B8D_SYSTEMD_CHDIR_STALE_UNIT_UNRESOLVED",
            "C731_MARGIN_GUARD_RUNTIME_SCRIPT_MISSING_UNRESOLVED",
            "V4_STOP_CROSSCHECK_DIAGNOSTIC_STALE_PIN_UNRESOLVED",
            "UI_MONITOR_RELEASE_NOT_CERTIFIED",
            "NO_FULL_STABLE4_RUNTIME_ECONOMIC_PARITY_CERT",
        ],
    }
    return bundle, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        bundle, report = prepare(args.repo.resolve())
    except (PreliveBundleError, subprocess.TimeoutExpired) as error:
        print("STABLE4_DD30_BRIDGE_BLOCKED:" + str(error))
        return 2
    args.out_dir.mkdir(parents=True, exist_ok=True)
    name = "stable4-dd30-prelive-composite-" + CANDIDATE_SHA[:12] + ".tar.gz"
    (args.out_dir / name).write_bytes(bundle)
    report["bundleName"] = name
    (args.out_dir / "stable4-dd30-prelive-composite-manifest.json").write_text(
        json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2)+"\n",
        encoding="utf-8")
    print("OFFLINE_PRELIVE_COMPOSITE_READY_FOR_CODEX_REVIEW")
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
