#!/usr/bin/env python3
"""Offline owner-approval positive/negative gates: no venue or GitHub connection."""
import importlib.util
from pathlib import Path

f = Path(__file__).with_name("q102-owner-manual-approval-check.py")
spec = importlib.util.spec_from_file_location("q102_manual_gate", f)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
sha = "a" * 40
old = "b" * 40
files = {"lib/disdex-quality102-causal-v1-runner.ts"}
ci = set(m.REQUIRED_WORKFLOWS)
good = (sha, old, f"I_APPROVE_Q102_LIVE_{sha}", m.OWNER,
        "refs/heads/master", "workflow_dispatch", files, ci)
m.check(*good)
failures = [
    (sha,old,"BAD",m.OWNER,"refs/heads/master","workflow_dispatch",files,ci),
    (sha,old,good[2],"unauthorized-user","refs/heads/master","workflow_dispatch",files,ci),
    (sha,old,good[2],m.OWNER,"refs/heads/master","push",files,ci),
    (sha,old,good[2],m.OWNER,"refs/heads/feature","workflow_dispatch",files,ci),
    (sha,old,good[2],m.OWNER,"refs/heads/master","workflow_dispatch",
     {"lib/pengu-dual-ls-v2-portfolio-runner.ts"},ci),
    (sha,old,good[2],m.OWNER,"refs/heads/master","workflow_dispatch",
     files,ci-{"Q102 UI decision observability typecheck"}),
]
for case in failures:
    try:
        m.check(*case)
    except SystemExit as e:
        assert "FAIL_CLOSED" in str(e)
    else:
        raise AssertionError(f"unsafe authorization accepted: {case}")
print("Q102_OWNER_MANUAL_APPROVAL_SELFTEST_PASS", len(failures), "negative cases")
