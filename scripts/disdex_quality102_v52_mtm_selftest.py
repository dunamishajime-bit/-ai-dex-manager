from __future__ import annotations

import json
import os
import time
from pathlib import Path

import disdex_v11eq_aster_only_live_engine as legacy
from disdex_v52_aster_only_legacy_engine import V50_SLOT, V52AsterOnlyEngine


class FakeAster:
    def __init__(self, now_ms: int):
        self.now_ms = now_ms
        self.rows = [{"symbol": "FETUSDT", "positionAmt": "15", "markPrice": "100"}]
        self.reductions: list[dict] = []

    def positions(self):
        return list(self.rows)

    def book(self, symbol: str, limit: int = 20):
        assert symbol == "FETUSDT"
        return legacy.base.Book(
            "ASTER", symbol, 99.0, 1000.0, 101.0, 1000.0,
            [(99.0, 1000.0)], [(101.0, 1000.0)],
            self.now_ms - 50, self.now_ms,
        )

    def place_market(self, *, symbol, side, quantity, expected_price, client_id, reduce_only=False):
        assert reduce_only is True
        assert symbol == "FETUSDT"
        assert side == "SELL"
        assert quantity > 0
        self.reductions.append({"symbol": symbol, "side": side, "quantity": quantity, "clientId": client_id, "reduceOnly": reduce_only})
        self.rows[0]["positionAmt"] = str(15.0 - quantity)
        self.rows[0]["markPrice"] = "99"
        return legacy.base.Fill("ASTER", symbol, side, quantity, quantity, 99.0, "FILLED", client_id)


def main() -> int:
    now = int(time.time() * 1000)
    state = {
        "version": 1,
        "strategyId": "QUALITY102_CAUSAL_V1",
        "mode": "LIVE",
        "runtimeCommitSha": "a" * 40,
        "updatedAt": now,
        "position": {
            "symbol": "FETUSDT",
            "side": 1,
            "quantity": 15.0,
            "entryPrice": 100.0,
            "entryTs": now - 60_000,
            "hardStop": 0.10,
            "bestPrice": 100.0,
            "trailActive": False,
        },
        "failures": [],
    }
    directory = Path(".codex-tmp") / f"q102-v52-mtm-{os.getpid()}"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        path = directory / "q102.json"
        path.write_text(json.dumps(state), encoding="utf-8")
        original_path = os.environ.get("QUALITY102_CAUSAL_V1_STATE_PATH")
        original_sha = os.environ.get("DISDEX_RUNTIME_COMMIT_SHA")
        try:
            os.environ["QUALITY102_CAUSAL_V1_STATE_PATH"] = str(path)
            os.environ["DISDEX_RUNTIME_COMMIT_SHA"] = "a" * 40
            engine = object.__new__(V52AsterOnlyEngine)
            engine.live = True
            engine.aster = FakeAster(now)
            engine.crypto_gross_cap = 2.0
            engine.stock_gross_cap = 1.5
            engine.portfolio_gross_cap = 2.5
            engine.v11_gross_cap = 1.0
            engine.v50_gross_cap = 1.5
            engine.gross_tolerance = 1e-9
            engine.minimum_entry_usd = 5.0
            engine.portfolio_equity = lambda: 1000.0
            engine._actual_stock_notional = lambda: 0.0
            target = engine._prepare_quality102_for_stock_entry(V50_SLOT, 1.5)
            assert target == 1.5
            assert len(engine.aster.reductions) == 1
            written = json.loads(path.read_text(encoding="utf-8"))
            assert "pending" not in written
            assert written["position"]["quantity"] < 15.0
            assert written["lastReduction"]["accounting"] == "MARK_TO_MARKET_REALIZED_PNL"
            assert written["lastReduction"]["realizedPnl"] < 0
            snapshot = engine.gross_snapshot()
            assert snapshot["totalGross"] <= 2.5 + 1e-9
            assert snapshot["cryptoGross"] <= 2.0 + 1e-9
        finally:
            if original_path is None:
                os.environ.pop("QUALITY102_CAUSAL_V1_STATE_PATH", None)
            else:
                os.environ["QUALITY102_CAUSAL_V1_STATE_PATH"] = original_path
            if original_sha is None:
                os.environ.pop("DISDEX_RUNTIME_COMMIT_SHA", None)
            else:
                os.environ["DISDEX_RUNTIME_COMMIT_SHA"] = original_sha
            path.unlink(missing_ok=True)
            directory.rmdir()
    finally:
        if directory.exists():
            (directory / "q102.json").unlink(missing_ok=True)
            directory.rmdir()
    print("QUALITY102_V52_MTM_SELFTEST_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
