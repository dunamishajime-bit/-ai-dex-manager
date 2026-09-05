from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from disdex_strict_portfolio_planner import QUALITY102_STATE_MAX_AGE_MS, load_quality102_live_state


SHA = "a" * 40
NOW_MS = 1_800_000_000_000


def expect_stale(path: Path, now_ms: int) -> None:
    try:
        load_quality102_live_state(path, now_ms=now_ms)
    except RuntimeError as error:
        assert str(error) == "QUALITY102_STATE_STALE"
    else:
        raise AssertionError("expected QUALITY102_STATE_STALE")


def main() -> int:
    # The Q102 daemon publishes at closed-hour boundaries, so a 15-minute
    # lease would reject a healthy hourly publisher between boundaries.
    assert QUALITY102_STATE_MAX_AGE_MS == 75 * 60_000
    original_path = os.environ.get("DISDEX_RUNTIME_COMMIT_SHA")
    try:
        os.environ["DISDEX_RUNTIME_COMMIT_SHA"] = SHA
        with tempfile.TemporaryDirectory(prefix="q102-state-freshness-") as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({
                "version": 1,
                "strategyId": "QUALITY102_CAUSAL_V1",
                "mode": "LIVE",
                "runtimeCommitSha": SHA,
                "updatedAt": NOW_MS - QUALITY102_STATE_MAX_AGE_MS + 1,
                "failures": [],
            }), encoding="utf-8")
            assert load_quality102_live_state(path, now_ms=NOW_MS) is None
            path.write_text(json.dumps({
                "version": 1,
                "strategyId": "QUALITY102_CAUSAL_V1",
                "mode": "LIVE",
                "runtimeCommitSha": SHA,
                "updatedAt": NOW_MS - QUALITY102_STATE_MAX_AGE_MS - 1,
                "failures": [],
            }), encoding="utf-8")
            expect_stale(path, NOW_MS)
    finally:
        if original_path is None:
            os.environ.pop("DISDEX_RUNTIME_COMMIT_SHA", None)
        else:
            os.environ["DISDEX_RUNTIME_COMMIT_SHA"] = original_path
    print("QUALITY102_STATE_FRESHNESS_SELFTEST_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
