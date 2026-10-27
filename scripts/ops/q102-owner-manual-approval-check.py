#!/usr/bin/env python3
"""Owner-approved Q102 workflow preflight; no exchange/VPS state mutation."""
from __future__ import annotations
import json
import os
import re
import subprocess
import urllib.request

SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
OWNER = "dunamishajime-bit"
REQUIRED_WORKFLOWS = {
    "Q102 adopted three-exit production candidate CI",
    "Q102 UI decision observability typecheck",
    "Dis-Dex PENGU Dual LS V2 Final CI",
}
ALLOWED_CHANGED_FILES = {
    ".github/workflows/q102-ui-decision-observability-ci.yml",
    "apps/production-ui/components/features/DecisionStatusPanel.tsx",
    "apps/production-ui/lib/server/quality102-runtime-observability.ts",
    "lib/disdex-quality102-causal-v1-runner.ts",
    "lib/disdex-quality102-causal-v1-signal.ts",
    "lib/disdex-quality102-causal-v4-signal.ts",
    "lib/quality102-live-scheduling.ts",
    "scripts/disdex-quality102-causal-v1-live-runner-selftest.ts",
    "scripts/disdex-quality102-causal-v1-live-runner.ts",
    "scripts/disdex-quality102-causal-v1-runner-selftest.ts",
    "scripts/disdex-quality102-causal-v4-signal-selftest.ts",
    "scripts/pengu-dual-ls-v2-parity.ts",
}

def require(condition: bool, reason: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL_CLOSED_Q102_MANUAL_APPROVAL:{reason}")

def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()

def check(sha: str, prior: str, confirmation: str, actor: str, ref: str,
          event: str, changed: set[str], successful_workflows: set[str]) -> None:
    require(actor == OWNER and event == "workflow_dispatch" and ref == "refs/heads/master",
            "owner_dispatch_only")
    require(bool(SHA_RE.fullmatch(sha)) and bool(SHA_RE.fullmatch(prior)), "exact_sha_only")
    require(sha != prior, "same_release")
    require(confirmation == f"I_APPROVE_Q102_LIVE_{sha}", "explicit_exact_sha_ack_required")
    require(bool(changed) and changed <= ALLOWED_CHANGED_FILES, "candidate_contains_unapproved_files")
    require(REQUIRED_WORKFLOWS <= successful_workflows, "exact_sha_successful_ci_required")

def completed_ci_for_exact_sha(sha: str) -> set[str]:
    repository = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GH_TOKEN"]
    url = f"https://api.github.com/repos/{repository}/actions/runs?head_sha={sha}&per_page=100"
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(request, timeout=20) as result:
        runs = json.load(result).get("workflow_runs", [])
    return {str(run["name"]) for run in runs
            if run.get("head_sha") == sha and run.get("status") == "completed"
            and run.get("conclusion") == "success" and run.get("event") == "pull_request"}

def main() -> None:
    sha = os.environ["TARGET_SHA"].strip()
    prior = os.environ["EXPECTED_LIVE_SHA"].strip()
    confirmation = os.environ["OWNER_APPROVAL"].strip()
    actor = os.environ.get("GITHUB_ACTOR", "")
    ref = os.environ.get("GITHUB_REF", "")
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    require(bool(SHA_RE.fullmatch(sha)) and bool(SHA_RE.fullmatch(prior)), "sha_syntax")
    require(git("cat-file", "-t", sha) == "commit" and
            git("cat-file", "-t", prior) == "commit", "commit_missing")
    require(subprocess.run(["git", "merge-base", "--is-ancestor", prior, sha],
                           check=False).returncode == 0, "non_descendant_candidate")
    changed = set(git("diff", "--name-only", prior, sha).splitlines())
    successful = completed_ci_for_exact_sha(sha)
    check(sha, prior, confirmation, actor, ref, event, changed, successful)
    print(f"Q102_OWNER_MANUAL_RELEASE_PREFLIGHT_PASS target={sha} prior={prior} "
          f"changed_files={len(changed)}")

if __name__ == "__main__":
    main()
