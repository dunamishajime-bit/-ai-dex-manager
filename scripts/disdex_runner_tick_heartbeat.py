from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Mapping


SCHEMA = "disdex-runner-tick-heartbeat/v1"
DEFAULT_ROOT = Path("/var/lib/disdex/runner-health")
SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)
RUNNER_RE = re.compile(r"^[A-Za-z0-9_]+$")


def _nonnegative_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"RUNNER_TICK_HEARTBEAT_{label}_INVALID")
    return value


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"RUNNER_TICK_HEARTBEAT_{label}_INVALID")
    return value


def runner_tick_heartbeat_path(root: Path | str, runner_id: str) -> Path:
    if not RUNNER_RE.fullmatch(runner_id):
        raise ValueError("RUNNER_TICK_HEARTBEAT_RUNNER_ID_INVALID")
    return Path(root) / "ticks" / f"{runner_id}.json"


def write_runner_tick_heartbeat(
    *,
    runner_id: str,
    runtime_sha: str,
    service_unit: str,
    tick_started_at: int,
    tick_completed_at: int,
    status: str,
    reason: str = "",
    counters: Mapping[str, Any] | None = None,
    root: Path | str | None = None,
) -> dict[str, Any]:
    if not RUNNER_RE.fullmatch(runner_id):
        raise ValueError("RUNNER_TICK_HEARTBEAT_RUNNER_ID_INVALID")
    if not SHA_RE.fullmatch(runtime_sha):
        raise ValueError("RUNNER_TICK_HEARTBEAT_SHA_INVALID")
    if service_unit != service_unit.strip() or not service_unit.endswith(f"@{runtime_sha.lower()}.service"):
        raise ValueError("RUNNER_TICK_HEARTBEAT_SERVICE_UNIT_INVALID")
    if not isinstance(status, str) or not status.strip():
        raise ValueError("RUNNER_TICK_HEARTBEAT_STATUS_INVALID")
    if not isinstance(reason, str):
        raise ValueError("RUNNER_TICK_HEARTBEAT_REASON_INVALID")
    started = _positive_int(tick_started_at, "STARTED_AT")
    completed = _positive_int(tick_completed_at, "COMPLETED_AT")
    if completed < started:
        raise ValueError("RUNNER_TICK_HEARTBEAT_TIME_ORDER_INVALID")
    counters = counters or {}
    orders_sent = _nonnegative_int(counters.get("ordersSent", 0), "ORDERS_SENT")
    cancels_sent = _nonnegative_int(counters.get("cancelsSent", 0), "CANCELS_SENT")
    position_changes_sent = _nonnegative_int(counters.get("positionChangesSent", 0), "POSITION_CHANGES_SENT")
    marker = {
        "schema": SCHEMA,
        "runnerId": runner_id,
        "runtimeSha": runtime_sha.lower(),
        "serviceUnit": service_unit,
        "tickStartedAt": started,
        "tickCompletedAt": completed,
        "status": status,
        "reason": reason,
        "ordersSent": orders_sent,
        "cancelsSent": cancels_sent,
        "positionChangesSent": position_changes_sent,
    }
    marker_path = runner_tick_heartbeat_path(
        root or os.environ.get("DISDEX_RUNNER_TICK_HEARTBEAT_ROOT") or DEFAULT_ROOT,
        runner_id,
    )
    marker_path.parent.mkdir(parents=True, mode=0o750, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{marker_path.name}.", suffix=".tmp", dir=marker_path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(marker, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, marker_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return marker
