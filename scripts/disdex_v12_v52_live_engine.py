from __future__ import annotations

import argparse
import contextlib
import json
import os
import signal
import time

# Expand the legacy V96/V52 shared Margin Guard before importing the
# margin-aware V52 engine. This preserves the deployed V96 implementation while
# giving the post-migration composition the full frozen V12 universe.
import disdex_v96_v52_margin_guard as guard
from disdex_account_order_lock import AccountOrderLock

V12_CRYPTO_SYMBOLS = (
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT",
    "DOGEUSDT", "INJUSDT", "XRPUSDT", "ADAUSDT", "LTCUSDT", "ATOMUSDT",
    "AAVEUSDT", "NEARUSDT", "PENGUUSDT",
)

guard.MANAGED_CRYPTO_SYMBOLS = V12_CRYPTO_SYMBOLS
guard.MANAGED_SYMBOLS = V12_CRYPTO_SYMBOLS + guard.MANAGED_STOCK_SYMBOLS

import disdex_v52_margin_aware_live_engine as legacy  # noqa: E402

legacy.MANAGED_SYMBOLS = guard.MANAGED_SYMBOLS
legacy.verify_managed_configuration = guard.verify_managed_configuration

EPSILON = 1e-12


class V12AwareV52AsterOnlyEngine(legacy.MarginAwareV52AsterOnlyEngine):
    """V52 stock sleeve for the V12 + PENGU V2 crypto composition.

    Capacity is based on actual Aster positions across every frozen V12 symbol,
    PENGU and the five stock symbols. The legacy V96 state no longer receives
    margin priority after migration.

    The daemon singleton lock is local. The cross-language account-order lock is
    held only around exchange-mutating critical sections. Owner IDs encode the
    shared arbitration priority: P1 for reduce-only/flatten and P2 for new V52
    stock exposure. New exposure is reserved in the shared lock before the
    inherited V52 code persists ``pendingOrder`` and sends the order.
    """

    def __init__(self, mode: str):
        super().__init__(mode)
        # Replace the inherited account lock with the same protocol configured
        # for V52 durable crash recovery. The inherited state schema uses
        # ``pendingOrder`` and strategyId=legacy.STRATEGY_ID.
        self.account_order_lock = AccountOrderLock(
            os.getenv("DISDEX_ACCOUNT_LOCK_PATH", ".runtime-state/shared/account-order.lock"),
            legacy.base.int_env("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000),
            recovery_owner_prefix="V52:",
            recovery_state_strategy_id=legacy.STRATEGY_ID,
            recovery_reservation_strategy_prefix="V52:",
            pending_state_path=self.state_path,
        )
        self.lock = legacy.base.FileLock(
            self.state_root / f"runner-{mode}.lock",
            legacy.base.int_env("DISDEX_STOCK_LOCK_STALE_MS", 15 * 60_000),
        )
        self._account_critical_depth = 0

    @contextlib.contextmanager
    def _account_critical(self, priority: int, wait_seconds: float, required: bool):
        if self._account_critical_depth > 0:
            self._account_critical_depth += 1
            try:
                yield True
            finally:
                self._account_critical_depth -= 1
            return

        deadline = time.monotonic() + max(0.0, wait_seconds)
        acquired = False
        owner_id = f"V52:P{priority}:{self.mode}:{os.getpid()}:{time.time_ns()}"
        while True:
            if self.account_order_lock.acquire(owner_id=owner_id):
                acquired = True
                break
            if time.monotonic() >= deadline:
                if required:
                    raise RuntimeError(f"V52_SHARED_ACCOUNT_ORDER_LOCK_TIMEOUT:P{priority}")
                yield False
                return
            time.sleep(0.05)

        self._account_critical_depth = 1
        try:
            yield True
        finally:
            self._account_critical_depth = 0
            if acquired:
                self.account_order_lock.release()

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        # New stock exposure is P2. If a simultaneous P1 close/protection action
        # wins arbitration, ordinary contention skips this entry instead of
        # becoming a fatal tick / Kill Switch event.
        with self._account_critical(priority=2, wait_seconds=1.0, required=False) as acquired:
            if not acquired:
                self.log("v52-entry-skipped-account-priority", slot=slot, priority=2, ordersSent=False)
                return False

            equity = self.portfolio_equity()
            if not equity > 0:
                raise RuntimeError("V52_ACCOUNT_EQUITY_INVALID_BEFORE_RESERVATION")
            symbol = str(candidate.get("symbol") or "").upper()
            open_side = str(candidate.get("side") or "").upper()
            reservation_side = "LONG" if open_side == "BUY" else "SHORT" if open_side == "SELL" else ""
            if not symbol or not reservation_side:
                raise RuntimeError("V52_RESERVATION_INPUT_INVALID")
            reservation = self.account_order_lock.reserve(
                f"V52:{slot}",
                symbol,
                reservation_side,
                float(target_gross),
                float(target_gross) * float(equity),
            )
            try:
                # Inherited path now executes while the reservation is visible:
                # fresh gross/margin check -> durable pendingOrder -> send ->
                # result/reconcile. A hard crash leaves both lock+reservation and
                # pending evidence for dead-PID recovery.
                return super().open_basis_position(slot, candidate, target_gross)
            finally:
                # On a live Python exception (not a hard crash), release the
                # reservation before releasing the enclosing account lock.
                try:
                    self.account_order_lock.release_reservation(reservation["reservationId"])
                except Exception as error:
                    self.log("v52-reservation-release-failed", slot=slot, error=str(error))
                    raise

    def close_slot(self, slot: str, reason: str) -> None:
        # Risk-reducing exits are highest priority and retry boundedly rather
        # than yielding to a new exposure request. No positive-gross reservation
        # is needed for reduce-only work.
        with self._account_critical(priority=1, wait_seconds=30.0, required=True):
            return super().close_slot(slot, reason)

    def flatten_all(self, reason: str) -> None:
        # Keep cancellation + all reduce-only close operations serialized as one
        # P1 critical section. close_slot() is re-entrant here.
        with self._account_critical(priority=1, wait_seconds=30.0, required=True):
            return super().flatten_all(reason)

    def v96_requires_margin(self) -> bool:
        return False

    def gross_snapshot_from_rows(self, account: dict, rows: list[dict]) -> dict:
        equity = legacy.base.finite(account.get("totalMarginBalance"))
        if equity <= 0:
            raise RuntimeError("Aster totalMarginBalance must be positive")
        crypto_symbols = set(V12_CRYPTO_SYMBOLS)
        stock_symbols = set(legacy.base.ASTER_SYMBOL.values())
        crypto_notional = 0.0
        stock_notional = 0.0
        for row in rows:
            symbol = str(row.get("symbol") or "").upper()
            quantity = abs(legacy.base.finite(row.get("positionAmt")))
            price = legacy.base.finite(row.get("markPrice") or row.get("entryPrice"))
            if quantity <= EPSILON:
                continue
            notional = quantity * price
            if symbol in crypto_symbols:
                crypto_notional += notional
            elif symbol in stock_symbols:
                stock_notional += notional
            else:
                raise RuntimeError(f"Unknown non-flat Aster symbol requires manual review: {symbol}")
        return {
            "equityUsd": equity,
            "cryptoNotionalUsd": crypto_notional,
            "stockNotionalUsd": stock_notional,
            "cryptoGross": crypto_notional / equity,
            "stockGross": stock_notional / equity,
            "totalGross": (crypto_notional + stock_notional) / equity,
        }


def self_test() -> None:
    engine = object.__new__(V12AwareV52AsterOnlyEngine)
    account = {"totalMarginBalance": "1000"}
    rows = [
        {"symbol": "LINKUSDT", "positionAmt": "2", "markPrice": "20"},
        {"symbol": "PENGUUSDT", "positionAmt": "100", "markPrice": "0.10"},
        {"symbol": "METAUSDT", "positionAmt": "1", "markPrice": "500"},
        {"symbol": "UNKNOWNUSDT", "positionAmt": "0", "markPrice": "1"},
    ]
    snapshot = engine.gross_snapshot_from_rows(account, rows)
    assert abs(snapshot["cryptoNotionalUsd"] - 50.0) < EPSILON
    assert abs(snapshot["stockNotionalUsd"] - 500.0) < EPSILON
    assert abs(snapshot["totalGross"] - 0.55) < EPSILON
    assert engine.v96_requires_margin() is False
    try:
        engine.gross_snapshot_from_rows(account, rows + [{"symbol": "UNKNOWNUSDT", "positionAmt": "1", "markPrice": "1"}])
    except RuntimeError as error:
        assert "Unknown non-flat Aster symbol" in str(error)
    else:
        raise AssertionError("Unknown non-flat symbols must fail closed")

    class FakeAccountLock:
        def __init__(self):
            self.acquires: list[str] = []
            self.releases = 0

        def acquire(self, owner_id=None):
            self.acquires.append(str(owner_id))
            return True

        def release(self):
            self.releases += 1

    fake = FakeAccountLock()
    engine.mode = "paper"
    engine.account_order_lock = fake
    engine._account_critical_depth = 0
    with engine._account_critical(priority=1, wait_seconds=0, required=True):
        with engine._account_critical(priority=1, wait_seconds=0, required=True):
            assert engine._account_critical_depth == 2
    assert len(fake.acquires) == 1
    assert ":P1:" in fake.acquires[0]
    assert fake.releases == 1
    assert engine._account_critical_depth == 0
    assert len(V12_CRYPTO_SYMBOLS) == 15
    print("V12-aware V52 live engine self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("paper", "live"), default=os.getenv("DISDEX_V52_ASTER_ONLY_RUNNER_MODE", "paper"))
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--preflight-readonly", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    runner = V12AwareV52AsterOnlyEngine(args.mode)
    signal.signal(signal.SIGINT, lambda *_: setattr(runner, "stop_requested", True))
    signal.signal(signal.SIGTERM, lambda *_: setattr(runner, "stop_requested", True))
    if args.preflight_readonly:
        print(json.dumps(runner.preflight(read_only=True), ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.preflight:
        print(json.dumps(runner.preflight(), indent=2, ensure_ascii=False))
        return 0
    runner.run(args.daemon and not args.once)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
