import re
from typing import Any, Optional


_SATURATED = re.compile(r"^ASTER_GLOBAL_RATE_BUDGET_SATURATED:(\d+)$")
_LOCK_FAILURES = {
    "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT",
    "ASTER_GLOBAL_RATE_BUDGET_LOCK_RELEASE_FAILED",
    "ASTER_GLOBAL_RATE_BUDGET_RECOVERY_LOCK_RELEASE_FAILED",
}


def classify_aster_rate_budget_failure(error: BaseException | str) -> Optional[dict[str, Any]]:
    reason = str(error).strip()
    saturated = _SATURATED.fullmatch(reason)
    if saturated:
        return {"kind": "RATE_BUDGET_DEFERRED", "reason": reason, "waitMs": int(saturated.group(1))}
    if reason in _LOCK_FAILURES:
        return {"kind": "RATE_BUDGET_DEFERRED", "reason": reason}
    return None


def next_aster_rate_budget_retry_ms(attempt: int, base_ms: float, max_ms: float, wait_ms: float = 0.0, random_value: float = 0.5) -> int:
    if attempt < 0 or not float(attempt).is_integer() or base_ms < 0 or max_ms < 0:
        raise ValueError("ASTER_GLOBAL_RATE_BUDGET_RETRY_CONFIG_INVALID")
    exponential = min(max_ms, base_ms * (2 ** int(attempt)))
    jitter = min(max_ms, exponential * (0.5 + min(1.0, max(0.0, random_value)) * 0.5))
    return int(min(max_ms, max(0.0, wait_ms, jitter)))
