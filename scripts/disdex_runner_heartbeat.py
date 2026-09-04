from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

SCHEMA = "disdex-runner-heartbeat/v1"
ZERO_SHA = "0" * 40

def heartbeat_path(runner_id: str) -> Path:
    explicit = os.getenv("DISDEX_RUNNER_HEARTBEAT_PATH")
    if explicit:
        return Path(explicit)
    names = {"V12": "v12", "PENGU_V8": "pengu-v8", "V52": "v52", "QUALITY102_CAUSAL_V1": "quality102-causal-v1"}
    return Path(os.getenv("DISDEX_RUNNER_HEALTH_ROOT", "/var/lib/disdex/runner-health")) / f"{names.get(runner_id, runner_id.lower())}.json"

def _sha(value: str | None) -> str:
    value = (value or "").strip().lower()
    return value if len(value) == 40 and all(char in "0123456789abcdef" for char in value) else ZERO_SHA

def publish_heartbeat(*, runner_id: str, mode: str, live_enabled: bool, safety_state: str, last_decision: str | None,
                      reason: str, symbols: list[dict[str, Any]] | None = None, last_tick_at: int | None = None,
                      last_reconciliation_at: int | None = None, caps: dict[str, float | None] | None = None) -> None:
    now = int(time.time() * 1000)
    runtime_sha = _sha(os.getenv("DISDEX_RUNTIME_COMMIT_SHA") or os.getenv("DISDEX_RELEASE_SHA"))
    target = heartbeat_path(runner_id)
    payload = {"schema": SCHEMA, "runnerId": runner_id, "serviceUnit": os.getenv("DISDEX_RUNNER_SERVICE_UNIT", "disdex-v52-aster-only.service"),
               "runtimeSha": runtime_sha, "expectedSha": _sha(os.getenv("DISDEX_EXPECTED_RUNTIME_SHA") or runtime_sha),
               "workingDirectory": str(Path.cwd()), "mode": mode, "liveEnabled": bool(live_enabled), "safetyState": safety_state,
               "heartbeatAt": now, "lastTickAt": last_tick_at if last_tick_at is not None else now,
               "lastReconciliationAt": last_reconciliation_at, "lastDecision": last_decision, "reason": reason or "runner heartbeat",
               "symbols": symbols or [], "caps": caps or {"strategy": 1.5, "crypto": 2.0, "total": 2.5},
               "restartAttempts": max(0, int(os.getenv("DISDEX_RUNNER_RESTART_ATTEMPTS", "0") or 0)), "updatedAt": now}
    target.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(target.parent, 0o700)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, prefix=f".{target.name}.", suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(payload, handle, separators=(",", ":"))
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)
