from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

SCHEMA = "disdex-shared-crypto-daily-risk/v1"
STRATEGIES = ("V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL")


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
        state = {"schema": SCHEMA, "accountScope": "ASTER_FUTURES", "utcDay": dt.datetime.fromtimestamp(now / 1000, tz=dt.timezone.utc).date().isoformat(), "strategyIds": list(STRATEGIES), "lossPct": 0.0, "maximumLossPct": 5.0, "tripped": False, "updatedAt": now}
        assert validate_shared_crypto_daily_risk(state, now)[0]
        stale = {**state, "updatedAt": now - 100_000}
        assert validate_shared_crypto_daily_risk(stale, now)[1] == "STALE"
        print("SHARED_CRYPTO_DAILY_RISK_SELFTEST_PASS")
