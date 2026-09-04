from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
from pathlib import Path
from typing import Any

SCHEMA = "disdex-shared-crypto-daily-risk/v1"
STRATEGIES = ("V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1")


def _hash_without_state_hash(value: dict[str, Any]) -> str:
    body = {key: item for key, item in value.items() if key != "stateHash"}
    encoded = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_shared_crypto_daily_risk(value: Any, now_ms: int | None = None, max_age_ms: int = 90_000) -> tuple[bool, str, dict[str, Any] | None]:
    now_ms = now_ms or int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    if not isinstance(value, dict):
        return False, "MISSING_OR_MALFORMED", None
    if value.get("schema") != SCHEMA or value.get("accountScope") != "ASTER_FUTURES":
        return False, "SCHEMA_OR_SCOPE_MISMATCH", None
    if not isinstance(value.get("strategyIds"), list) or any(strategy not in value["strategyIds"] for strategy in STRATEGIES):
        return False, "STRATEGY_SET_MISMATCH", None
    utc_day = value.get("utcDay")
    if not isinstance(utc_day, str):
        return False, "UTC_DAY_INVALID", None
    try:
        dt.date.fromisoformat(utc_day)
    except ValueError:
        return False, "UTC_DAY_INVALID", None
    try:
        updated = int(value["updatedAt"])
        float(value["lossPct"])
        float(value["maximumLossPct"])
    except (KeyError, TypeError, ValueError):
        return False, "NON_FINITE", None
    if abs(now_ms - updated) > max_age_ms:
        return False, "STALE", None
    expected_day = dt.datetime.fromtimestamp(now_ms / 1000, tz=dt.timezone.utc).date().isoformat()
    if utc_day != expected_day:
        return False, "DAY_MISMATCH", None
    if value.get("stateHash") and value["stateHash"] != _hash_without_state_hash(value):
        return False, "HASH_MISMATCH", None
    breakdown = [value.get(name) for name in ("realizedPnl", "unrealizedPnl", "fees", "funding", "netDailyPnl", "referenceEquity")]
    if value.get("sourceComplete") is not True or any(not isinstance(item, (int, float)) or not math.isfinite(float(item)) for item in breakdown) or float(value["referenceEquity"]) <= 0:
        return False, "PNL_BREAKDOWN_INCOMPLETE", None
    if abs(float(value["netDailyPnl"]) - sum(float(value[name]) for name in ("realizedPnl", "unrealizedPnl", "fees", "funding"))) > 1e-6:
        return False, "PNL_BREAKDOWN_INCONSISTENT", None
    if value.get("tripped") is True:
        return False, "DAILY_LOSS_TRIPPED", value
    return True, "OK", value


def read_shared_crypto_daily_risk(path: str | Path, now_ms: int | None = None, max_age_ms: int = 90_000) -> tuple[bool, str, dict[str, Any] | None]:
    try:
        return validate_shared_crypto_daily_risk(json.loads(Path(path).read_text(encoding="utf-8")), now_ms, max_age_ms)
    except FileNotFoundError:
        return False, "MISSING", None
    except (OSError, json.JSONDecodeError):
        return False, "MALFORMED", None


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        now = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
        state = {"schema": SCHEMA, "accountScope": "ASTER_FUTURES", "utcDay": dt.datetime.fromtimestamp(now / 1000, tz=dt.timezone.utc).date().isoformat(), "strategyIds": list(STRATEGIES), "lossPct": 0.0, "maximumLossPct": 5.0, "tripped": False, "updatedAt": now, "realizedPnl": 0.0, "unrealizedPnl": 0.0, "fees": 0.0, "funding": 0.0, "netDailyPnl": 0.0, "referenceEquity": 100.0, "sourceComplete": True}
        assert validate_shared_crypto_daily_risk(state, now)[0]
        stale = {**state, "updatedAt": now - 100_000}
        assert validate_shared_crypto_daily_risk(stale, now)[1] == "STALE"
        print("SHARED_CRYPTO_DAILY_RISK_SELFTEST_PASS")
