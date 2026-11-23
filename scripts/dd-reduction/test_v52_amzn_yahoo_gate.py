"""Deterministic contract tests for the V52 AMZN SHORT Yahoo reference gate.

These tests intentionally use normalized, already downloaded bars.  Network
access is not part of the gate contract and must never be required to prove
the boundary, session, or fail-closed behavior.
"""

from datetime import datetime, timezone

from v52_amzn_yahoo_gate import evaluate_amzn_short_yahoo_gate


HOUR_MS = 60 * 60 * 1000


def ts(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def bar(start: str, close: float) -> dict:
    return {"start_ms": ts(start), "close": close}


def test_exact_threshold_is_allowed() -> None:
    # Monday after a normal Friday session.  The latest confirmed Monday bar
    # is available at the decision timestamp and is exactly +1.0%.
    result = evaluate_amzn_short_yahoo_gate(
        decision_ms=ts("2026-10-19T16:30:00Z"),
        bars=[
            bar("2026-10-16T13:30:00Z", 100.0),
            bar("2026-10-19T15:30:00Z", 101.0),
        ],
    )

    assert result["status"] == "PASS"
    assert result["reason"] == "AMZN_SHORT_YAHOO_PREV_CLOSE_NOT_GT_1PCT"
    assert abs(result["returnSincePreviousNySessionClosePct"] - 1.0) < 1e-9
    assert result["previousNySessionLastClose"] == 100.0
    assert result["latestConfirmedYahooReferencePrice"] == 101.0


def test_strictly_above_threshold_is_blocked() -> None:
    result = evaluate_amzn_short_yahoo_gate(
        decision_ms=ts("2026-10-19T16:30:00Z"),
        bars=[
            bar("2026-10-16T13:30:00Z", 100.0),
            bar("2026-10-19T15:30:00Z", 101.000001),
        ],
    )

    assert result["status"] == "BLOCK"
    assert result["reason"] == "AMZN_SHORT_YAHOO_PREV_CLOSE_GT_1PCT"


def test_incomplete_or_future_bars_are_not_used() -> None:
    result = evaluate_amzn_short_yahoo_gate(
        decision_ms=ts("2026-10-19T16:30:00Z"),
        bars=[
            bar("2026-10-16T13:30:00Z", 100.0),
            # Completes after the decision timestamp: must be ignored.
            bar("2026-10-19T16:00:00Z", 120.0),
        ],
    )

    assert result["status"] == "DATA_UNAVAILABLE"
    assert result["reason"] == "AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE"


def test_weekend_and_holiday_skip_to_previous_nyse_session() -> None:
    # 2025-09-02 is the first session after Labor Day 2025.  The prior
    # reference must be Friday 2025-08-29, not the holiday or the weekend.
    result = evaluate_amzn_short_yahoo_gate(
        decision_ms=ts("2025-09-02T16:30:00Z"),
        bars=[
            bar("2025-08-29T13:30:00Z", 100.0),
            bar("2025-09-01T13:30:00Z", 150.0),
            bar("2025-09-02T15:30:00Z", 100.5),
        ],
    )

    assert result["status"] == "PASS"
    assert result["previousNySessionLastClose"] == 100.0
    assert result["latestConfirmedYahooReferencePrice"] == 100.5
    assert result["previousNySessionDate"] == "2025-08-29"


def test_missing_previous_session_fails_closed() -> None:
    result = evaluate_amzn_short_yahoo_gate(
        decision_ms=ts("2026-10-19T16:30:00Z"),
        bars=[bar("2026-10-19T15:30:00Z", 101.0)],
    )

    assert result["status"] == "DATA_UNAVAILABLE"
    assert result["reason"] == "AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE"


def test_missing_immediately_previous_nyse_session_does_not_fall_back_to_older_data() -> None:
    # Friday is the expected previous session for Monday.  Thursday data must
    # not be silently substituted when Friday's close is missing.
    result = evaluate_amzn_short_yahoo_gate(
        decision_ms=ts("2026-10-19T16:30:00Z"),
        bars=[
            bar("2026-10-15T13:30:00Z", 100.0),
            bar("2026-10-19T15:30:00Z", 101.0),
        ],
    )

    assert result["status"] == "DATA_UNAVAILABLE"
    assert result["reason"] == "AMZN_SHORT_YAHOO_REFERENCE_DATA_UNAVAILABLE"


if __name__ == "__main__":
    for name, value in sorted(globals().items()):
        if name.startswith("test_") and callable(value):
            value()
    print("V52_AMZN_YAHOO_GATE_TESTS_PASS")
