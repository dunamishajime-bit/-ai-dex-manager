from __future__ import annotations

import json
import os
import time
from pathlib import Path

from disdex_strict_portfolio_planner import (
    STRICT_CAPS,
    plan_v52_stock_capacity,
    quality102_crypto_notional_from_positions,
    validate_gross_snapshot,
)
from disdex_v52_aster_only_legacy_engine import V52AsterOnlyEngine


Q102_SHA = "a" * 40
KNOWN_CRYPTO = frozenset({"BTCUSDT"})
KNOWN_STOCK = frozenset({"AMZNUSDT"})


def state_payload(*, symbol: str = "FETUSDT", side: int = 1, quantity: float = 2.0) -> dict:
    return {
        "version": 1,
        "strategyId": "QUALITY102_CAUSAL_V1",
        "mode": "LIVE",
        "runtimeCommitSha": Q102_SHA,
        "updatedAt": time.time() * 1000,
        "position": {
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "entryPrice": 90.0,
            "entryTs": time.time() * 1000 - 60_000,
            "hardStop": 0.10,
            "bestPrice": 90.0,
            "trailActive": False,
        },
        "failures": [],
    }


def rows(*, q102_quantity: float = 2.0, q102_side: int = 1) -> list[dict]:
    return [
        {"symbol": "FETUSDT", "positionAmt": q102_quantity * q102_side, "markPrice": 100.0},
        {"symbol": "BTCUSDT", "positionAmt": 1.0, "markPrice": 1000.0},
        {"symbol": "AMZNUSDT", "positionAmt": 1.0, "markPrice": 500.0},
    ]


def expect_error(fn, marker: str) -> None:
    try:
        fn()
    except RuntimeError as error:
        assert marker in str(error), (marker, error)
    else:
        raise AssertionError(f"expected {marker}")


def self_test() -> None:
    original_path = os.environ.get("QUALITY102_CAUSAL_V1_STATE_PATH")
    original_alias = os.environ.get("DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH")
    original_sha = os.environ.get("DISDEX_RUNTIME_COMMIT_SHA")
    try:
        path = Path(".quality102-v52-selftest-state.json").resolve()
        try:
            path.write_text(json.dumps(state_payload()), encoding="utf-8")
            os.environ["QUALITY102_CAUSAL_V1_STATE_PATH"] = str(path)
            os.environ.pop("DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH", None)
            os.environ["DISDEX_RUNTIME_COMMIT_SHA"] = Q102_SHA

            notional = quality102_crypto_notional_from_positions(
                rows(), known_crypto=KNOWN_CRYPTO, known_stock=KNOWN_STOCK
            )
            assert notional == 1_200.0

            # The V52 gross snapshot uses the marked Q102 position and leaves
            # the stock sleeve calculation unchanged.
            engine = object.__new__(V52AsterOnlyEngine)
            engine.live = True
            engine.aster = type("FakeAster", (), {"positions": lambda self: rows()})()
            engine.portfolio_equity = lambda: 2_000.0
            engine._actual_stock_notional = lambda: 500.0
            snapshot = engine.gross_snapshot()
            assert snapshot["cryptoNotionalUsd"] == 1_200.0
            assert snapshot["stockNotionalUsd"] == 500.0
            assert snapshot["cryptoGross"] == 0.6
            assert snapshot["totalGross"] == 0.85
            validate_gross_snapshot(snapshot)
            capacity = plan_v52_stock_capacity(snapshot, 1.0, 1.0)
            assert capacity["acceptedGross"] == 1.0
            assert STRICT_CAPS.stock_gross == 1.5
            expect_error(
                lambda: quality102_crypto_notional_from_positions(
                    [{"symbol": "FETUSDT", "positionAmt": 2.0}],
                    known_crypto=KNOWN_CRYPTO,
                    known_stock=KNOWN_STOCK,
                ),
                "QUALITY102_POSITION_MALFORMED",
            )

            # A malformed or mismatched state cannot silently turn an unknown
            # exchange position into owned exposure.
            path.write_text("{not-json", encoding="utf-8")
            expect_error(lambda: quality102_crypto_notional_from_positions(rows(), known_crypto=KNOWN_CRYPTO, known_stock=KNOWN_STOCK), "QUALITY102_STATE_MALFORMED")
            path.write_text(json.dumps(state_payload(side=-1)), encoding="utf-8")
            expect_error(lambda: quality102_crypto_notional_from_positions(rows(), known_crypto=KNOWN_CRYPTO, known_stock=KNOWN_STOCK), "QUALITY102_STATE_POSITION_MISMATCH")
            path.write_text(json.dumps(state_payload()), encoding="utf-8")
            expect_error(lambda: quality102_crypto_notional_from_positions([{"symbol": "DOGEUSDT", "positionAmt": 1.0, "markPrice": 10.0}], known_crypto=KNOWN_CRYPTO, known_stock=KNOWN_STOCK), "Unknown non-flat")

            # Removing the state is safe only while no unknown non-zero Q102
            # position exists; the existing fail-closed behavior remains.
            path.unlink()
            expect_error(lambda: quality102_crypto_notional_from_positions(rows(), known_crypto=KNOWN_CRYPTO, known_stock=KNOWN_STOCK), "Unknown non-flat")
        finally:
            path.unlink(missing_ok=True)
    finally:
        for name, value in (
            ("QUALITY102_CAUSAL_V1_STATE_PATH", original_path),
            ("DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH", original_alias),
            ("DISDEX_RUNTIME_COMMIT_SHA", original_sha),
        ):
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
    print("QUALITY102_V52_COEXISTENCE_SELFTEST_PASS")


if __name__ == "__main__":
    self_test()
