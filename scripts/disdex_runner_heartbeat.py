from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

SCHEMA = "disdex-runner-heartbeat/v1"
ZERO_SHA = "0" * 40
SAFETY_STATES = {
    "LIVE", "WAITING", "FAIL_CLOSED", "KILL_SWITCH", "DAILY_LOSS_LATCH",
    "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN",
}


def classify_runner_safety_state(status: str | None, reason: str | None, live_enabled: bool) -> str:
    status_text = str(status or "").strip().lower()
    normalized = f"{status_text} {str(reason or '').strip().lower()}"
    normalized = re.sub(r"[_-]+", " ", normalized)
    if re.search(r"kill\s+switch", normalized):
        return "KILL_SWITCH"
    if re.search(r"daily\s+loss|daily\s+latch", normalized):
        return "DAILY_LOSS_LATCH"
    if re.search(r"stale|invalid|freshness|\bdata\b", normalized):
        return "STALE_DATA"
    if re.search(r"reconciliation|unmanaged|position\s+(?:mismatch|disagreement)|state\s+(?:mismatch|invalid)", normalized):
        return "RECONCILIATION_FAILED"
    if status_text in {"manual review", "manual-review"} or re.search(r"manual\s+review|unresolved|ambiguous", normalized):
        return "MANUAL_REVIEW"
    if re.search(r"shared\s+(?:crypto\s+)?daily\s+risk|shared\s+risk|margin|gross|capacity|unavailable|missing|safety\s+hold", normalized):
        return "FAIL_CLOSED"
    if status_text in {"fatal", "unknown"} or re.search(r"uncaught|startup\s+(?:error|failed)", normalized):
        return "UNKNOWN"
    if re.search(r"failed|failure|error|exception|crash|blocked", status_text) or re.search(r"\b(?:failed|failure|error|exception|crash)\b", normalized):
        return "FAIL_CLOSED"
    return "LIVE" if live_enabled else "WAITING"


def _safe_reason(value: object) -> str:
    text = str(value or "runner heartbeat")
    text = re.sub(
        r"(?i)(api[_ -]?key|private[_ -]?key|secret|token|password|authorization)\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        text,
    )
    return text[:512]

def heartbeat_path(runner_id: str) -> Path:
    specific_names = {
        "V12": "DISDEX_V12_RUNNER_HEARTBEAT_PATH",
        "PENGU_V8": "DISDEX_PENGU_RUNNER_HEARTBEAT_PATH",
        "V52": "DISDEX_V52_RUNNER_HEARTBEAT_PATH",
        "QUALITY102_CAUSAL_V1": "DISDEX_QUALITY102_RUNNER_HEARTBEAT_PATH",
    }
    explicit = os.getenv(specific_names.get(runner_id, "")) or os.getenv("DISDEX_RUNNER_HEARTBEAT_PATH")
    if explicit:
        return Path(explicit)
    names = {"V12": "v12", "PENGU_V8": "pengu-v8", "V52": "v52", "QUALITY102_CAUSAL_V1": "quality102-causal-v1"}
    return Path(os.getenv("DISDEX_RUNNER_HEALTH_ROOT", "/var/lib/disdex/runner-health")) / f"{names.get(runner_id, runner_id.lower())}.json"


def service_unit(runner_id: str) -> str:
    specific_names = {
        "V12": "DISDEX_V12_RUNNER_SERVICE_UNIT",
        "PENGU_V8": "DISDEX_PENGU_RUNNER_SERVICE_UNIT",
        "V52": "DISDEX_V52_RUNNER_SERVICE_UNIT",
        "QUALITY102_CAUSAL_V1": "DISDEX_QUALITY102_RUNNER_SERVICE_UNIT",
    }
    defaults = {
        "V12": "disdex-v12-x1-all.service",
        "PENGU_V8": "disdex-pengu-dual-ls-v2.service",
        "V52": "disdex-v52-aster-only.service",
        "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1.service",
    }
    return os.getenv(specific_names.get(runner_id, "")) or os.getenv("DISDEX_RUNNER_SERVICE_UNIT") or defaults.get(runner_id, "disdex-runner.service")

def _sha(value: str | None) -> str:
    value = (value or "").strip().lower()
    return value if len(value) == 40 and all(char in "0123456789abcdef" for char in value) else ZERO_SHA

def publish_heartbeat(*, runner_id: str, mode: str, live_enabled: bool, safety_state: str, last_decision: str | None,
                      reason: str, symbols: list[dict[str, Any]] | None = None, last_tick_at: int | None = None,
                      last_reconciliation_at: int | None = None, caps: dict[str, float | None] | None = None) -> bool:
    temporary: Path | None = None
    file_descriptor: int | None = None
    try:
        now = int(time.time() * 1000)
        runtime_sha = _sha(os.getenv("DISDEX_RUNTIME_COMMIT_SHA") or os.getenv("DISDEX_RELEASE_SHA"))
        expected_sha = _sha(os.getenv("DISDEX_EXPECTED_RUNTIME_SHA") or os.getenv("DISDEX_EXPECTED_SHA"))
        derived_state = classify_runner_safety_state(last_decision, reason, bool(live_enabled))
        if safety_state in {"LIVE", "WAITING"} and derived_state not in {"LIVE", "WAITING"}:
            safety_state = derived_state
        if safety_state not in SAFETY_STATES:
            safety_state = derived_state
        if str(mode).upper() == "LIVE" and (runtime_sha == ZERO_SHA or expected_sha == ZERO_SHA):
            safety_state = "UNKNOWN"
            reason = "runtime or expected SHA unavailable"
        target = heartbeat_path(runner_id)
        payload = {"schema": SCHEMA, "runnerId": runner_id, "serviceUnit": service_unit(runner_id),
                   "runtimeSha": runtime_sha, "expectedSha": expected_sha,
                   "workingDirectory": str(Path.cwd()), "mode": mode, "liveEnabled": bool(live_enabled), "safetyState": safety_state,
                   "heartbeatAt": now, "lastTickAt": last_tick_at if last_tick_at is not None else now,
                   "lastReconciliationAt": last_reconciliation_at, "lastDecision": last_decision, "reason": _safe_reason(reason),
                   "symbols": symbols or [], "caps": caps or {"strategy": 1.5, "crypto": 2.0, "total": 2.5},
                   "restartAttempts": max(0, int(os.getenv("DISDEX_RUNNER_RESTART_ATTEMPTS", "0") or 0)), "updatedAt": now}
        target.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(target.parent, 0o700)
        file_descriptor, temporary_name = tempfile.mkstemp(
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
        )
        temporary = Path(temporary_name)
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            file_descriptor = None
            json.dump(payload, handle, separators=(",", ":"), allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
        temporary = None
        return True
    except Exception as error:
        print(json.dumps({"level": "warn", "event": "runner-heartbeat-write-failed", "runnerId": runner_id, "errorType": type(error).__name__}, separators=(",", ":")), file=sys.stderr, flush=True)
        return False
    finally:
        if file_descriptor is not None:
            try:
                os.close(file_descriptor)
            except OSError:
                pass
        if temporary is not None:
            try:
                temporary.unlink()
            except OSError:
                pass
