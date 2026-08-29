from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import json
import os
import signal
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Expand the legacy V96/V52 shared Margin Guard before importing the
# margin-aware V52 engine. This preserves the deployed V96 implementation while
# giving the post-migration composition the full frozen V12 universe.
import disdex_v96_v52_margin_guard as guard
from disdex_account_order_lock import AccountOrderLock, active_reserved_gross
from disdex_v56_policy import (
    V11_DEFAULT_GROSS,
    V50_BASIS_STOP_MULTIPLE,
    V50_MAX_ADVERSE_BASIS_MOVE_BPS,
    V50_MAX_CONCURRENT_POSITIONS,
    V50_MAX_DAILY_ENTRIES,
    V50_MAX_HOLDING_HOURS,
    V50_RANK1_MIN_BASIS_BPS,
    V50_RANK1_MIN_NET_EDGE_BPS,
    V50_RANK1_NORMAL_GROSS,
    V50_RANK1_STRONG_BASIS_BPS,
    V50_RANK1_STRONG_GROSS,
    V50_RANK1_STRONG_NET_EDGE_BPS,
    V50_RANK2_GROSS,
    V50_RANK2_MIN_BASIS_BPS,
    V50_RANK2_MIN_NET_EDGE_BPS,
    v11_requested_gross,
    v50_requested_gross,
)

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
V50_WINDOWS = legacy.legacy.V50_WINDOWS
V11_SLOT = legacy.V11_SLOT
V50_SLOT = legacy.V50_SLOT
V50_RANK2_SLOT = "V50_POST_OPEN_BASIS_RANK2"
V50_RANK1_REQUESTED_GROSS = V50_RANK1_NORMAL_GROSS
V50_RANK1_STRONG_REQUESTED_GROSS = V50_RANK1_STRONG_GROSS
V50_RANK2_REQUESTED_GROSS = V50_RANK2_GROSS
REFERENCE_STALE_RETRY_MS = 5 * 60_000
REFERENCE_STALE_NOTIFICATION_STATE_PATH = "/var/lib/disdex/shared/v52-reference-stale-notification-state.json"


def reference_age_ms(timestamp_ms: int, observed_at_ms: int | None = None) -> int:
    """Return source quote age without ever treating a future timestamp as stale."""
    observed = legacy.base.now_ms() if observed_at_ms is None else int(observed_at_ms)
    return max(0, observed - int(timestamp_ms))


def reference_entry_policy(reference_status: str, aster_data_ready: bool) -> dict:
    """Decide whether the final V52 entry gate may use a reference fallback."""
    status = str(reference_status or "UNKNOWN").upper()
    if status == "FRESH":
        return {"allow": True, "fallback": False, "reason": "REFERENCE_FRESH"}
    if status in {"STALE", "UNAVAILABLE"} and aster_data_ready:
        return {"allow": True, "fallback": True, "reason": "STALE_REFERENCE_ASTER_FALLBACK"}
    return {"allow": False, "fallback": False, "reason": "REFERENCE_UNAVAILABLE_OR_ASTER_DATA_NOT_READY"}

# V56 is a fixed production contract.  Keep these values in the shared base
# module because its inherited entry/exit lifecycle reads module-level policy.
legacy.legacy.V50_MAX_HOLDING_HOURS = V50_MAX_HOLDING_HOURS
legacy.legacy.V50_BASIS_STOP_MULTIPLE = V50_BASIS_STOP_MULTIPLE
legacy.legacy.V50_MAX_ADVERSE_BASIS_MOVE_BPS = V50_MAX_ADVERSE_BASIS_MOVE_BPS
legacy.legacy.V50_MAX_DAILY_TRADES = V50_MAX_DAILY_ENTRIES

# Research-locked V50 gate profile from PR #189 / Actions run 32774114948.
# Only strategy selectivity and the explicitly audited V52 reference recovery
# path are changed here. Spread, depth, adverse-move, Gross, Margin Guard,
# daily-loss and Kill Switch gates remain unchanged and fail closed.
V50_MIN_ENTRY_BASIS_BPS = V50_RANK1_MIN_BASIS_BPS
V50_MIN_NET_EDGE_BPS = V50_RANK1_MIN_NET_EDGE_BPS
legacy.legacy.V50_MIN_ENTRY_BASIS_BPS = V50_MIN_ENTRY_BASIS_BPS
legacy.legacy.V50_MIN_NET_EDGE_BPS = V50_MIN_NET_EDGE_BPS


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

    V52 has its own 3.5% strategy daily-loss latch. The V12+PENGU shared crypto
    daily-risk file is intentionally not an entry prerequisite for V52 stock
    signal evaluation. Combined account Gross and Margin Guard checks remain
    mandatory immediately before every exposure-increasing V52 order.
    """

    def _notify_fill(self, event: dict) -> None:
        if os.environ.get("DISDEX_TRADE_FILL_NOTIFICATIONS_ENABLED", "").lower() != "true":
            return
        script = Path(__file__).with_name("trade-fill-email-notifier.mjs")
        try:
            child = subprocess.Popen(
                [os.environ.get("DISDEX_NODE_BIN", "node"), str(script)],
                cwd=str(script.parent.parent),
                env=os.environ.copy(),
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                start_new_session=True,
            )
            if child.stdin is not None:
                child.stdin.write(json.dumps(event, separators=(",", ":"), default=str))
                child.stdin.close()
        except Exception as error:
            # Mail is observability only. Never alter the order result or
            # activate a trading failsafe because SMTP is unavailable.
            self.log("v52-fill-notification-dispatch-failed", error=str(error))

    def _notify_reference_stale_failure(self, event: dict) -> None:
        if os.environ.get("DISDEX_V52_STALE_REFERENCE_NOTIFICATIONS_ENABLED", "true").lower() != "true":
            return
        script = Path(__file__).with_name("trade-fill-email-notifier.mjs")
        environment = os.environ.copy()
        environment["DISDEX_TRADE_FILL_NOTIFICATION_STATE_PATH"] = os.getenv(
            "DISDEX_V52_STALE_NOTIFICATION_STATE_PATH",
            REFERENCE_STALE_NOTIFICATION_STATE_PATH,
        )
        try:
            child = subprocess.Popen(
                [os.environ.get("DISDEX_NODE_BIN", "node"), str(script)],
                cwd=str(script.parent.parent),
                env=environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                start_new_session=True,
            )
            if child.stdin is not None:
                child.stdin.write(json.dumps(event, separators=(",", ":"), default=str))
                child.stdin.close()
        except Exception as error:
            # Notification failure must never alter the V52 order or risk path.
            self.log("v52-reference-stale-notification-dispatch-failed", error=str(error))

    def _reference_recovery_state(self) -> dict:
        state = self.state.get("v52ReferenceRecovery")
        if not isinstance(state, dict):
            state = {}
            self.state["v52ReferenceRecovery"] = state
        return state

    def _append_reference_recovery_event(self, event: dict) -> None:
        history = self.state.setdefault("v52ReferenceRecoveryHistory", [])
        if not isinstance(history, list):
            history = []
            self.state["v52ReferenceRecoveryHistory"] = history
        history.append(event)
        del history[:-200]

    def _reference_recovery_event(self, symbol: str, row: dict, event: str, **extra: object) -> dict:
        return {
            "event": event,
            "symbol": symbol,
            "at": legacy.base.now_ms(),
            "detectedAt": row.get("detectedAt"),
            "lastSourceTimestampMs": row.get("lastSourceTimestampMs"),
            "lastAgeMs": row.get("lastAgeMs"),
            **extra,
        }

    def _notify_reference_recovery_failure(self, symbol: str, row: dict) -> None:
        if row.get("notificationSent"):
            return
        now = legacy.base.now_ms()
        event = {
            "eventId": f"v52-stale-reference:{symbol}:{row.get('detectedAt')}",
            "eventType": "STALE_REFERENCE_ALERT",
            "strategyId": "V52",
            "symbol": symbol,
            "baseAsset": symbol,
            "quoteAsset": "USD",
            "positionSide": "-",
            "orderSide": "-",
            "executedAt": dt.datetime.fromtimestamp(now / 1000, tz=dt.timezone.utc).isoformat(),
            "exchange": "Alpaca reference",
            "reason": "REFERENCE_RETRY_FAILED",
            "metadata": {
                "detectedAt": row.get("detectedAt"),
                "retryScheduledAt": row.get("retryScheduledAt"),
                "retryAttemptedAt": row.get("retryAttemptedAt"),
                "retryResult": row.get("retryResult"),
                "lastSourceTimestampMs": row.get("lastSourceTimestampMs"),
                "lastAgeMs": row.get("lastAgeMs"),
                "lastError": row.get("lastError"),
                "referenceDataStatus": row.get("status"),
            },
        }
        self._notify_reference_stale_failure(event)
        row["notificationSent"] = True
        row["notificationDispatchedAt"] = now
        self._append_reference_recovery_event(
            self._reference_recovery_event(symbol, row, "STALE_REFERENCE_NOTIFICATION_DISPATCHED")
        )

    def _record_reference_recovery(self, rows: dict) -> None:
        """Track stale/missing references and retry each affected symbol once after 5m."""
        now = legacy.base.now_ms()
        recovery = self._reference_recovery_state()
        errors = getattr(self, "_reference_fetch_errors", {})
        last_known = self.state.setdefault("v52ReferenceLastKnown", {})
        changed = False
        for symbol in legacy.base.SYMBOLS:
            row = recovery.get(symbol)
            reference = rows.get(symbol, (None, None, None))[2] if symbol in rows else None
            error = errors.get(symbol)
            age = reference_age_ms(reference.timestamp_ms, now) if reference is not None else None
            stale = reference is None or age > legacy.base.V11_MAX_DATA_AGE_MS
            if reference is not None:
                known = {
                    "price": reference.price,
                    "timestampMs": reference.timestamp_ms,
                    "source": reference.source,
                }
                if last_known.get(symbol) != known:
                    last_known[symbol] = known
                    changed = True
            if not stale and not error:
                if isinstance(row, dict) and row.get("status") != "FRESH":
                    row.update({"status": "RECOVERED", "recoveredAt": now, "lastAgeMs": age})
                    self._append_reference_recovery_event(
                        self._reference_recovery_event(symbol, row, "REFERENCE_RECOVERED", recoveredAgeMs=age)
                    )
                    changed = True
                continue

            if not isinstance(row, dict) or row.get("status") == "RECOVERED":
                row = {
                    "status": "UNAVAILABLE" if error else "STALE",
                    "detectedAt": now,
                    "retryScheduledAt": now + REFERENCE_STALE_RETRY_MS,
                    "retryAttemptedAt": None,
                    "retryResult": None,
                    "notificationSent": False,
                }
                recovery[symbol] = row
                self._append_reference_recovery_event(
                    self._reference_recovery_event(symbol, row, "REFERENCE_STALE_DETECTED")
                )
                changed = True

            if not (row.get("retryAttemptedAt") and row.get("status") == "RETRY_FAILED"):
                row["status"] = "UNAVAILABLE" if error else "STALE"
            row["lastObservedAt"] = now
            row["lastAgeMs"] = age
            row["lastError"] = str(error) if error else None
            if reference is not None:
                row["lastSourceTimestampMs"] = reference.timestamp_ms
                row["lastSource"] = reference.source
                last_known[symbol] = {
                    "price": reference.price,
                    "timestampMs": reference.timestamp_ms,
                    "source": reference.source,
                }
            changed = True

            if row.get("retryAttemptedAt") or now < int(row.get("retryScheduledAt") or 0):
                continue
            row["retryAttemptedAt"] = now
            try:
                retry = self.reference.quote(symbol)
                retry_age = reference_age_ms(retry.timestamp_ms, legacy.base.now_ms())
                if retry_age <= legacy.base.V11_MAX_DATA_AGE_MS and (
                    reference is None or retry.timestamp_ms > reference.timestamp_ms
                ):
                    row.update({
                        "status": "RECOVERED",
                        "retryResult": "FRESH",
                        "recoveredAt": now,
                        "lastAgeMs": retry_age,
                        "lastSourceTimestampMs": retry.timestamp_ms,
                        "lastSource": retry.source,
                    })
                    self._append_reference_recovery_event(
                        self._reference_recovery_event(symbol, row, "REFERENCE_RETRY_RECOVERED", retryAgeMs=retry_age)
                    )
                else:
                    row.update({"status": "RETRY_FAILED", "retryResult": "STALE"})
                    self._append_reference_recovery_event(
                        self._reference_recovery_event(symbol, row, "REFERENCE_RETRY_FAILED", retryAgeMs=retry_age)
                    )
                    self._notify_reference_recovery_failure(symbol, row)
            except Exception as retry_error:
                row.update({"status": "RETRY_FAILED", "retryResult": "UNAVAILABLE", "lastError": str(retry_error)})
                self._append_reference_recovery_event(
                    self._reference_recovery_event(symbol, row, "REFERENCE_RETRY_FAILED")
                )
                self._notify_reference_recovery_failure(symbol, row)
            changed = True

        if changed:
            self.save()

    def _fresh_aster_entry_book(self, candidate: dict) -> tuple[bool, dict]:
        symbol = str(candidate.get("symbol") or "").upper()
        try:
            book = self.aster.book(legacy.base.ASTER_SYMBOL[symbol], 20)
        except Exception as error:
            return False, {"status": "UNAVAILABLE", "error": str(error)}
        age = max(0, legacy.base.now_ms() - book.received_ms)
        detail = {
            "status": "FRESH" if age <= legacy.base.V13D_MAX_BOOK_AGE_MS else "STALE",
            "ageMs": age,
            "bid": book.bid,
            "ask": book.ask,
            "spreadBps": book.spread_bps,
        }
        if age > legacy.base.V13D_MAX_BOOK_AGE_MS:
            return False, detail
        if book.bid <= 0 or book.ask <= 0 or book.ask < book.bid:
            return False, {**detail, "status": "INVALID"}
        return True, detail

    def _pre_order_reference_check(self, candidate: dict) -> tuple[bool, dict]:
        candidate_status = str(candidate.get("referenceDataStatus") or "UNKNOWN").upper()
        symbol = str(candidate.get("symbol") or "").upper()
        try:
            reference = self.reference.quote(symbol)
            age = reference_age_ms(reference.timestamp_ms)
            current_status = "FRESH" if age <= legacy.base.V11_MAX_DATA_AGE_MS else "STALE"
            reference_detail = {"status": current_status, "ageMs": age, "source": reference.source}
        except Exception as error:
            current_status = "UNAVAILABLE"
            reference_detail = {"status": current_status, "error": str(error)}

        if current_status == "FRESH":
            return True, {"referenceDataStatus": current_status, **reference_detail, "staleFallbackUsed": False}
        if candidate_status not in {"STALE", "UNAVAILABLE"}:
            return False, {
                "referenceDataStatus": current_status,
                **reference_detail,
                "candidateReferenceDataStatus": candidate_status,
                "staleFallbackUsed": False,
                "reason": "REFERENCE_LOST_AFTER_FRESH_CANDIDATE",
            }
        aster_ready, aster_detail = self._fresh_aster_entry_book(candidate)
        policy = reference_entry_policy(current_status, aster_ready)
        return policy["allow"], {
            "referenceDataStatus": current_status,
            **reference_detail,
            "candidateReferenceDataStatus": candidate_status,
            "asterDataReady": aster_ready,
            "asterData": aster_detail,
            "staleFallbackUsed": policy["fallback"],
            "reason": policy["reason"],
        }

    def books_and_refs(self) -> dict:
        """Keep V52 alive on reference outages while preserving Aster/XYZ failures."""
        result = {}
        errors = {}
        with ThreadPoolExecutor(max_workers=10) as pool:
            jobs = {}
            for symbol in legacy.base.SYMBOLS:
                jobs[(symbol, "aster")] = pool.submit(self.aster.book, legacy.base.ASTER_SYMBOL[symbol], 20)
                jobs[(symbol, "xyz")] = pool.submit(self.xyz.book, legacy.base.XYZ_SYMBOL[symbol])
                jobs[(symbol, "ref")] = pool.submit(self.reference.quote, symbol)
            for symbol in legacy.base.SYMBOLS:
                aster = jobs[(symbol, "aster")].result()
                xyz = jobs[(symbol, "xyz")].result()
                try:
                    reference = jobs[(symbol, "ref")].result()
                except Exception as error:
                    errors[symbol] = str(error)
                    cached = (self.state.get("v52ReferenceLastKnown") or {}).get(symbol)
                    if isinstance(cached, dict) and cached.get("price") and cached.get("timestampMs"):
                        reference = legacy.base.ReferenceQuote(
                            symbol,
                            float(cached["price"]),
                            int(cached["timestampMs"]),
                            legacy.base.now_ms(),
                            str(cached.get("source") or "v52-state-cache"),
                        )
                    else:
                        continue
                result[symbol] = (aster, xyz, reference)
        self._reference_fetch_errors = errors
        return result

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
        if abs(self.v11_gross_cap - 1.5) > EPSILON:
            raise RuntimeError("V56 V11 Gross cap must be exactly 1.5")
        if abs(self.v50_gross_cap - 1.25) > EPSILON:
            raise RuntimeError("V56 V50 Gross cap must be exactly 1.25")
        self._account_critical_depth = 0

    def reset_days(self) -> None:
        super().reset_days()
        ny_day = str(self.state.get("nyDay") or "")
        entry_day = self.state.get("v50DailyEntriesDay")
        if entry_day != ny_day:
            self.state["v50DailyEntriesDay"] = ny_day
            # An absent day marker is an old-state migration; preserve the
            # already-counted attempts once. A known prior day always resets.
            self.state["v50DailyEntries"] = (
                min(V50_MAX_DAILY_ENTRIES, int(self.state.get("v50CompletedTrades", 0)))
                if entry_day is None
                else 0
            )
            self.save()
        else:
            self.state.setdefault("v50DailyEntries", int(self.state.get("v50CompletedTrades", 0)))

    def active_v50_slots(self) -> int:
        positions = self.positions()
        return sum(1 for slot in (V50_SLOT, V50_RANK2_SLOT) if slot in positions)

    def available_slot_gross(self, slot: str):
        available, snapshot = super().available_slot_gross(slot)
        if slot == V50_RANK2_SLOT:
            return min(available, V50_RANK2_REQUESTED_GROSS), snapshot
        return available, snapshot

    def v50_candidates(self, window: str, rows: dict, notional: float, max_candidates: int = 2):
        """Evaluate one frozen V50 signal snapshot and return ranked candidates.

        This deliberately mirrors the existing V50 gates. The only addition is
        returning the qualified ranking so rank 2 can be admitted as a separate
        P2 exposure. No signal is regenerated after the window snapshot.
        """
        signal = (self.state.get("v50SignalBasis") or {}).get(window) or {}
        if not signal:
            return [], {"ROUTER": ["MISSING_V50_SIGNAL_SNAPSHOT"]}

        eligible = []
        rejections = {}
        now = legacy.base.now_ms()
        reference_fetch_errors = getattr(self, "_reference_fetch_errors", {})
        active_symbols = {str(position.get("symbol")) for position in self.positions().values()}
        stock = legacy.legacy
        for symbol, (aster, _xyz, reference) in rows.items():
            basis = (aster.mid / reference.price - 1.0) * 10_000.0
            signal_basis = legacy.base.finite(signal.get(symbol), 0.0)
            side = "SELL" if basis > 0 else "BUY"
            exit_action = "BUY" if side == "SELL" else "SELL"
            cost, detail = self.estimate_v11_cost(aster, exit_action, notional)
            adverse = max(0.0, abs(basis) - abs(signal_basis))
            reference_age = reference_age_ms(reference.timestamp_ms, now)
            reference_status = (
                "UNAVAILABLE"
                if symbol in reference_fetch_errors
                else "FRESH" if reference_age <= legacy.base.V11_MAX_DATA_AGE_MS else "STALE"
            )
            reasons = []
            if symbol in active_symbols:
                reasons.append("SAME_SYMBOL_ACTIVE")
            if abs(basis) < V50_MIN_ENTRY_BASIS_BPS:
                reasons.append("BASIS_BELOW_65")
            if signal_basis * basis <= 0:
                reasons.append("SIGN_CHANGED")
            if adverse > stock.V50_MAX_ADVERSE_BASIS_MOVE_BPS:
                reasons.append("ADVERSE_BASIS_MOVE")
            if now - aster.received_ms > legacy.base.V11_MAX_DATA_AGE_MS or now - reference.received_ms > legacy.base.V11_MAX_DATA_AGE_MS:
                reasons.append("STALE_DATA")
            if abs(aster.received_ms - reference.received_ms) > legacy.base.V11_MAX_SOURCE_CLOCK_DIFF_MS:
                reasons.append("SOURCE_CLOCK_MISMATCH")
            if cost > stock.V50_MAX_ROUND_TRIP_COST_BPS:
                reasons.append("ROUND_TRIP_COST_OVER_60")
            net_edge = abs(basis) - stock.V50_CONVERGENCE_BPS - cost
            if net_edge < V50_MIN_NET_EDGE_BPS:
                reasons.append("NET_EDGE_BELOW_5")
            if aster.depth_usd(exit_action) < 2.0 * notional:
                reasons.append("DEPTH_BELOW_2X")
            if aster.spread_bps > legacy.base.V11_MAX_SPREAD_BPS:
                reasons.append("SPREAD_OVER_20")
            rejections[symbol] = reasons
            if not reasons:
                eligible.append({
                    "symbol": symbol,
                    "basisBps": basis,
                    "signalBasisBps": signal_basis,
                    "side": side,
                    "entryPrice": aster.bid if side == "BUY" else aster.ask,
                    "estimatedRoundTripCostBps": cost,
                    "estimatedNetEdgeBps": net_edge,
                    "adverseBasisMoveBps": adverse,
                    "costDetail": detail,
                    "referenceDataStatus": reference_status,
                    "referenceAgeMs": reference_age,
                    "route": f"POST_{window.replace(':', '')}",
                })

        eligible.sort(key=lambda row: (-abs(row["basisBps"]), row["symbol"]))
        ranked = []
        for rank, candidate in enumerate(eligible[:max_candidates], start=1):
            requested = v50_requested_gross(
                rank,
                candidate["basisBps"],
                candidate["estimatedNetEdgeBps"],
            )
            ranked.append({
                **candidate,
                "candidateRank": rank,
                "qualifiedRank": rank,
                "requestedGross": requested if requested is not None else (V50_RANK2_REQUESTED_GROSS if rank == 2 else V50_RANK1_REQUESTED_GROSS),
                "rankSizingEligible": requested is not None,
                "rankSizingReason": None if requested is not None else "RANK2_BELOW_85_BPS_OR_NET_EDGE_10",
            })
        return ranked, rejections

    def v50_candidate(self, window: str, rows: dict, notional: float):
        candidates, rejections = self.v50_candidates(window, rows, notional, max_candidates=2)
        selected = next((candidate for candidate in candidates if candidate.get("rankSizingEligible", True)), None)
        return selected, rejections

    def capture_v50_signal(self, window: str, rows: dict) -> None:
        super().capture_v50_signal(window, rows)
        telemetry = self.state.setdefault("v52Top2Telemetry", {}).setdefault(window, {})
        telemetry.update({
            "signalCaptureAttempted": True,
            "signalCaptureSucceeded": bool((self.state.get("v50SignalBasis") or {}).get(window)),
            "signalCapturedAt": legacy.base.now_ms(),
            "effectiveMinimumBasisBps": V50_MIN_ENTRY_BASIS_BPS,
            "effectiveMinimumNetEdgeBps": V50_MIN_NET_EDGE_BPS,
        })
        self.save()

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

    def _record_gate_diagnostics(
        self,
        strategy: str,
        candidate: dict | None,
        rejections: dict,
        *,
        window: str | None = None,
    ) -> None:
        """Persist daily V52 rejection counters without changing any gate result."""
        ny_day = str(self.state.get("nyDay") or dt.datetime.now(tz=legacy.base.NY).date().isoformat())
        diagnostics = self.state.get("v52GateDiagnostics")
        if not isinstance(diagnostics, dict) or diagnostics.get("nyDay") != ny_day:
            diagnostics = {
                "nyDay": ny_day,
                "decisions": 0,
                "acceptedCandidates": 0,
                "rejections": {},
                "byStrategy": {},
            }

        diagnostics["decisions"] = int(diagnostics.get("decisions", 0)) + 1
        if candidate:
            diagnostics["acceptedCandidates"] = int(diagnostics.get("acceptedCandidates", 0)) + 1

        rejection_counts = diagnostics.setdefault("rejections", {})
        strategy_counts = diagnostics.setdefault("byStrategy", {}).setdefault(
            strategy,
            {"decisions": 0, "acceptedCandidates": 0, "rejections": {}},
        )
        strategy_counts["decisions"] = int(strategy_counts.get("decisions", 0)) + 1
        if candidate:
            strategy_counts["acceptedCandidates"] = int(strategy_counts.get("acceptedCandidates", 0)) + 1

        strategy_rejections = strategy_counts.setdefault("rejections", {})
        for symbol, reasons in (rejections or {}).items():
            values = reasons if isinstance(reasons, (list, tuple)) else [reasons]
            for raw_reason in values:
                reason = str(raw_reason or "UNKNOWN_REJECTION")
                rejection_counts[reason] = int(rejection_counts.get(reason, 0)) + 1
                strategy_rejections[reason] = int(strategy_rejections.get(reason, 0)) + 1

        candidate_summary = None
        if candidate:
            candidate_summary = {
                "symbol": candidate.get("symbol"),
                "route": candidate.get("route"),
                "basisBps": candidate.get("basisBps"),
                "signalBasisBps": candidate.get("signalBasisBps"),
            }
        diagnostics["lastDecision"] = {
            "at": legacy.base.now_ms(),
            "strategy": strategy,
            "window": window,
            "candidate": candidate_summary,
        }
        self.state["v52GateDiagnostics"] = diagnostics
        self.save()
        self.log(
            "v52-gate-diagnostics",
            strategy=strategy,
            window=window,
            candidate=candidate_summary,
            dailyDecisions=diagnostics["decisions"],
            dailyAcceptedCandidates=diagnostics["acceptedCandidates"],
            dailyRejections=dict(sorted(rejection_counts.items())),
            v50MinimumEntryBasisBps=V50_MIN_ENTRY_BASIS_BPS,
            v50MinimumNetEdgeBps=V50_MIN_NET_EDGE_BPS,
            ordersSent=False,
        )

    def gross_snapshot(self) -> dict:
        """Use authenticated full-universe positions for the final V52 gross check."""
        if not self.live:
            return super().gross_snapshot()
        return self.gross_snapshot_from_rows(self.account_info(), self.aster.positions())

    def open_basis_position(self, slot: str, candidate: dict, target_gross: float) -> bool:
        reference_allowed, reference_check = self._pre_order_reference_check(candidate)
        if not reference_allowed:
            self.log(
                "v52-order-blocked",
                slot=slot,
                symbol=candidate.get("symbol"),
                orderBlockedReason=reference_check.get("reason") or "REFERENCE_DATA_NOT_READY",
                preOrderReferenceCheck=reference_check,
                orderSendAttempted=False,
                ordersSent=False,
            )
            return False
        candidate = {
            **candidate,
            "preOrderReferenceCheck": reference_check,
            "staleFallbackUsed": bool(reference_check.get("staleFallbackUsed")),
        }
        if slot == V11_SLOT:
            requested = v11_requested_gross(
                candidate.get("basisBps", 0.0),
                candidate.get("estimatedNetEdgeBps", 0.0),
            )
            if target_gross + EPSILON < requested:
                self.log(
                    "v56-v11-order-blocked",
                    symbol=candidate.get("symbol"),
                    requestedGross=requested,
                    availableGross=target_gross,
                    orderBlockedReason="INSUFFICIENT_AVAILABLE_GROSS",
                    orderSendAttempted=False,
                    ordersSent=False,
                )
                return False
            target_gross = requested
        elif slot in (V50_SLOT, V50_RANK2_SLOT):
            requested = float(candidate.get("requestedGross") or (
                V50_RANK2_REQUESTED_GROSS if slot == V50_RANK2_SLOT else V50_RANK1_REQUESTED_GROSS
            ))
            if not candidate.get("rankSizingEligible", True):
                self.log(
                    "v56-v50-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    requestedGross=requested,
                    orderBlockedReason=candidate.get("rankSizingReason") or "RANK_SIZING_REJECTED",
                    orderSendAttempted=False,
                    ordersSent=False,
                )
                return False
            if target_gross + EPSILON < requested:
                self.log(
                    "v56-v50-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    requestedGross=requested,
                    availableGross=target_gross,
                    orderBlockedReason="INSUFFICIENT_AVAILABLE_GROSS",
                    orderSendAttempted=False,
                    ordersSent=False,
                )
                return False
            target_gross = requested
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
            snapshot = self.gross_snapshot()
            lock_document = self.account_order_lock._owned()
            active_reservations = [
                row for row in lock_document.get("reservations", [])
                if row.get("status") == "RESERVED"
            ]
            reserved_gross = active_reserved_gross(lock_document)
            reserved_stock_gross = sum(
                legacy.base.finite(row.get("gross"))
                for row in active_reservations
                if str(row.get("strategyId") or "").startswith("V52:")
            )
            pending = self.state.get("pendingOrder")
            pending_gross = legacy.base.finite(pending.get("targetGross")) if isinstance(pending, dict) else 0.0
            global_before = snapshot["totalGross"] + reserved_gross + pending_gross
            stock_before = snapshot["stockGross"] + reserved_stock_gross + pending_gross
            global_after = global_before + float(target_gross)
            stock_after = stock_before + float(target_gross)
            self._last_reservation_telemetry = {
                "globalGrossBeforeReservation": global_before,
                "globalGrossAfterReservation": global_after,
                "stockGrossBeforeReservation": stock_before,
                "stockGrossAfterReservation": stock_after,
                "currentReservedGross": reserved_gross,
                "pendingReservations": pending_gross,
            }
            if pending_gross > EPSILON:
                self.log(
                    "v52-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    reason="UNRESOLVED_PENDING_ORDER",
                    orderBlockedReason="UNRESOLVED_PENDING_ORDER",
                    orderSendAttempted=False,
                    **self._last_reservation_telemetry,
                )
                return False
            if global_after > self.portfolio_gross_cap + self.gross_tolerance:
                self.log(
                    "v52-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    reason="INSUFFICIENT_AVAILABLE_GROSS",
                    orderBlockedReason="INSUFFICIENT_AVAILABLE_GROSS",
                    orderSendAttempted=False,
                    **self._last_reservation_telemetry,
                )
                return False
            if stock_after > self.stock_gross_cap + self.gross_tolerance:
                self.log(
                    "v52-order-blocked",
                    slot=slot,
                    symbol=candidate.get("symbol"),
                    reason="INSUFFICIENT_AVAILABLE_STOCK_GROSS",
                    orderBlockedReason="INSUFFICIENT_AVAILABLE_STOCK_GROSS",
                    orderSendAttempted=False,
                    **self._last_reservation_telemetry,
                )
                return False
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
                opened = super().open_basis_position(slot, candidate, target_gross)
                if opened:
                    position = self.positions().get(slot)
                    if position:
                        self._notify_fill({
                            "eventId": f"{position.get('entryClientOrderId')}:ENTRY:{position.get('entryClientOrderId')}",
                            "strategyId": str(position.get("strategy") or slot),
                            "eventType": "ENTRY_FILL",
                            "exchange": "Aster",
                            "symbol": position.get("symbol"),
                            "baseAsset": str(position.get("symbol") or "").replace("USDT", ""),
                            "quoteAsset": "USDT",
                            "positionSide": "LONG" if str(position.get("asterOpenSide")) == "BUY" else "SHORT",
                            "orderSide": position.get("asterOpenSide"),
                            "filledPrice": position.get("asterEntryPrice"),
                            "filledQuantity": position.get("asterQty"),
                            "quoteQuantity": legacy.base.finite(position.get("asterQty")) * legacy.base.finite(position.get("asterEntryPrice")),
                            "clientOrderId": position.get("entryClientOrderId"),
                            "executedAt": dt.datetime.fromtimestamp(legacy.base.finite(position.get("openedAt")) / 1000, tz=dt.timezone.utc).isoformat(),
                            "reason": str(candidate.get("reason") or "V52_ENTRY_FILLED"),
                            "metadata": {
                                "slot": slot,
                                "basisBps": candidate.get("basisBps"),
                                "signalBasisBps": candidate.get("signalBasisBps"),
                                "candidateRank": candidate.get("candidateRank"),
                                "qualifiedRank": candidate.get("qualifiedRank"),
                            },
                        })
                if opened and slot == V50_RANK2_SLOT:
                    position = self.positions().get(slot)
                    if position:
                        local = dt.datetime.now(tz=legacy.base.NY)
                        next_checkpoint = local.replace(minute=30, second=0, microsecond=0) + dt.timedelta(hours=1)
                        maximum_exit = min(
                            local + dt.timedelta(hours=legacy.legacy.V50_MAX_HOLDING_HOURS),
                            local.replace(hour=15, minute=30, second=0, microsecond=0),
                        )
                        position.update({
                            "checksCompleted": 0,
                            "nextCheckpointAt": int(next_checkpoint.timestamp() * 1000),
                            "maximumExitAt": int(maximum_exit.timestamp() * 1000),
                            "candidateRank": candidate.get("candidateRank", 2),
                            "qualifiedRank": candidate.get("qualifiedRank", 2),
                        })
                        self.save()
                return opened
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
            was_active = slot in self.positions()
            position_before = dict(self.positions().get(slot) or {})
            result = super().close_slot(slot, reason)
            if was_active and slot == V50_RANK2_SLOT and slot not in self.positions():
                self.state["v50CompletedTrades"] = int(self.state.get("v50CompletedTrades", 0)) + 1
                self.save()
            if was_active and slot not in self.positions():
                fill = getattr(self, "_last_fill", None) or {}
                if legacy.base.finite(fill.get("executedQty")) > 0:
                    self._notify_fill({
                        "eventId": f"{fill.get('clientId')}:EXIT:{fill.get('clientId')}",
                        "strategyId": str(position_before.get("strategy") or slot),
                        "eventType": "EXIT_FILL",
                        "exchange": "Aster",
                        "symbol": fill.get("symbol") or position_before.get("symbol"),
                        "baseAsset": str(fill.get("symbol") or position_before.get("symbol") or "").replace("USDT", ""),
                        "quoteAsset": "USDT",
                        "positionSide": "LONG" if str(position_before.get("asterOpenSide")) == "BUY" else "SHORT",
                        "orderSide": fill.get("side"),
                        "filledPrice": fill.get("averagePrice"),
                        "filledQuantity": fill.get("executedQty"),
                        "quoteQuantity": legacy.base.finite(fill.get("executedQty")) * legacy.base.finite(fill.get("averagePrice")),
                        "clientOrderId": fill.get("clientId"),
                        "executedAt": dt.datetime.fromtimestamp(legacy.base.finite(fill.get("executedAt")) / 1000, tz=dt.timezone.utc).isoformat(),
                        "reason": reason,
                        "metadata": {
                            "slot": slot,
                            "entryPrice": position_before.get("asterEntryPrice"),
                            "entryQuantity": position_before.get("asterQty"),
                            "positionId": position_before.get("positionId"),
                        },
                    })
            return result

    def flatten_all(self, reason: str) -> None:
        # Keep cancellation + all reduce-only close operations serialized as one
        # P1 critical section. close_slot() is re-entrant here.
        with self._account_critical(priority=1, wait_seconds=30.0, required=True):
            return super().flatten_all(reason)

    def v96_requires_margin(self) -> bool:
        return False

    def manage_positions(self, rows: dict) -> None:
        super().manage_positions(rows)
        rank2 = self.positions().get(V50_RANK2_SLOT)
        if not rank2:
            return
        now = legacy.base.now_ms()
        next_checkpoint = int(rank2.get("nextCheckpointAt") or 0)
        if now < next_checkpoint:
            return
        if now > next_checkpoint + 5 * 60_000:
            self.close_slot(V50_RANK2_SLOT, "MISSED_CHECKPOINT_FAIL_CLOSED")
            return
        symbol = str(rank2["symbol"])
        if symbol not in rows:
            self.close_slot(V50_RANK2_SLOT, "MISSING_REFERENCE_FAIL_CLOSED")
            return
        aster, _xyz, reference = rows[symbol]
        basis = (aster.mid / reference.price - 1.0) * 10_000.0
        entry = legacy.base.finite(rank2["entryBasisBps"])
        if abs(basis) <= legacy.legacy.V50_CONVERGENCE_BPS or basis * entry <= 0:
            self.close_slot(V50_RANK2_SLOT, "BASIS_CONVERGED")
            return
        if abs(basis) >= legacy.legacy.V50_BASIS_STOP_MULTIPLE * abs(entry):
            self.close_slot(V50_RANK2_SLOT, "BASIS_STOP")
            return
        checks = int(rank2.get("checksCompleted", 0)) + 1
        if checks >= legacy.legacy.V50_MAX_HOLDING_HOURS or now >= int(rank2.get("maximumExitAt") or 0) or legacy.base.ny_seconds() >= legacy.base.clock("15:30:00"):
            self.close_slot(V50_RANK2_SLOT, "TIME_4H")
            return
        rank2["checksCompleted"] = checks
        rank2["nextCheckpointAt"] = next_checkpoint + 60 * 60_000
        self.save()
        self.log("v50-checkpoint-hold", slot=V50_RANK2_SLOT, symbol=symbol, basisBps=basis, checksCompleted=checks)

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

    def tick(self) -> None:
        """Evaluate V52 on its stock-risk contract and preserve every signal gate.

        The inherited V52 implementation incorrectly returned before market-data
        and signal evaluation whenever the V12+PENGU shared *crypto* daily-risk
        file was missing, stale or tripped. That file covers only V12 and PENGU.
        V52 keeps its own daily-loss latch, the shared Kill Switch, full-universe
        gross checks and the fresh Margin Guard at order time.
        """
        self.reset_days()
        kill = self.kill_switch()
        if kill:
            self.flatten_all(str(kill.get("reason") or "KILL_SWITCH"))
            return
        if self.enforce_daily_loss():
            latch = self.state.get("v52StrategyDailyLossLatch") or {}
            self.log(
                "v52-entry-held-v52-daily-risk",
                reason=latch.get("tripReason") or "V52_DAILY_RISK_BLOCKED",
                failClosed=bool(latch.get("failClosed")),
                ordersSent=False,
            )
            return
        if self.kill_switch():
            self.flatten_all("DAILY_LOSS")
            return

        self.update_history()
        local = dt.datetime.now(tz=legacy.base.NY)
        if local.weekday() >= 5:
            return
        sec = legacy.base.ny_seconds(local)
        if not self.positions() and not (legacy.base.clock("09:59:50") <= sec <= legacy.base.clock("15:30:30")):
            return

        rows = self.books_and_refs()
        self._record_reference_recovery(rows)
        missing_references = sorted(set(legacy.base.SYMBOLS) - set(rows))
        if missing_references:
            self.log(
                "v52-reference-data-unavailable",
                symbols=missing_references,
                errors=getattr(self, "_reference_fetch_errors", {}),
                ordersSent=False,
            )
            return
        self._record_reference_active()
        if self.v96_requires_margin():
            if self.positions():
                self.flatten_all("V96_MARGIN_PRIORITY")
            return

        if not self.state.get("v11SignalBasis") and legacy.base.clock("09:59:55") <= sec <= legacy.base.clock("10:00:20"):
            self.record_v11_signal(rows)
        for window in V50_WINDOWS:
            entry = legacy.base.clock(window + ":00")
            if entry - 10 <= sec < entry:
                self.capture_v50_signal(window, rows)

        self.manage_positions(rows)

        if not self.state.get("v11Attempted") and legacy.base.clock("10:30:00") <= sec <= legacy.base.clock("10:30:20"):
            self.state["v11Attempted"] = True
            self.save()
            gross, snapshot = self.available_slot_gross(V11_SLOT)
            self.v11_notional = gross * snapshot["equityUsd"]
            candidate, rejections = (
                (None, {"ROUTER": ["NO_GROSS_CAPACITY"]})
                if gross <= 0
                else self.v11_candidates(rows)
            )
            self.log(
                "v52-v11-decision",
                candidate=candidate,
                rejections=rejections,
                allocatedGross=gross,
                grossSnapshot=snapshot,
            )
            self._record_gate_diagnostics(V11_SLOT, candidate, rejections)
            if candidate:
                self.open_basis_position(V11_SLOT, candidate, gross)

        attempted = self.state.setdefault("v50Attempted", {})
        for window in V50_WINDOWS:
            entry = legacy.base.clock(window + ":00")
            if attempted.get(window) or not (entry <= sec <= entry + 20):
                continue
            attempted[window] = True
            self.save()
            if int(self.state.get("v50CompletedTrades", 0)) >= legacy.legacy.V50_MAX_DAILY_TRADES or V50_SLOT in self.positions():
                continue
            gross, snapshot = self.available_slot_gross(V50_SLOT)
            notional = gross * snapshot["equityUsd"]
            candidate, rejections = (
                (None, {"ROUTER": ["NO_GROSS_CAPACITY"]})
                if gross <= 0
                else self.v50_candidate(window, rows, notional)
            )
            self.log(
                "v52-v50-decision",
                window=window,
                candidate=candidate,
                rejections=rejections,
                allocatedGross=gross,
                grossSnapshot=snapshot,
            )
            self._record_gate_diagnostics(V50_SLOT, candidate, rejections, window=window)
            if candidate:
                self.open_basis_position(V50_SLOT, candidate, gross)


def self_test() -> None:
    assert reference_age_ms(1_000, 31_001) == 30_001
    assert reference_entry_policy("FRESH", False) == {"allow": True, "fallback": False, "reason": "REFERENCE_FRESH"}
    assert reference_entry_policy("STALE", True)["fallback"] is True
    assert reference_entry_policy("STALE", False)["allow"] is False
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
    assert V50_MIN_ENTRY_BASIS_BPS == 65.0
    assert V50_MIN_NET_EDGE_BPS == 5.0
    assert V50_RANK1_REQUESTED_GROSS == 1.0
    assert V50_RANK1_STRONG_REQUESTED_GROSS == 1.25
    assert V50_RANK2_REQUESTED_GROSS == 0.25
    assert V50_MAX_CONCURRENT_POSITIONS == 2
    assert V50_MAX_DAILY_ENTRIES == 3
    assert V50_MAX_HOLDING_HOURS == 4
    assert V50_BASIS_STOP_MULTIPLE == 1.75
    assert V50_MAX_ADVERSE_BASIS_MOVE_BPS == 10.0
    assert v50_requested_gross(1, 65, 5) == 1.0
    assert v50_requested_gross(1, 100, 15) == 1.25
    assert v50_requested_gross(2, 85, 10) == 0.25
    assert v50_requested_gross(2, 84.99, 10) is None
    assert v11_requested_gross(50, 0) == 0.75
    assert v11_requested_gross(80, 10) == 1.0
    assert v11_requested_gross(110, 20) == 1.25
    assert v11_requested_gross(140, 30) == 1.5
    assert legacy.legacy.V50_MIN_ENTRY_BASIS_BPS == 65.0
    assert legacy.legacy.V50_MIN_NET_EDGE_BPS == 5.0
    try:
        engine.gross_snapshot_from_rows(account, rows + [{"symbol": "UNKNOWNUSDT", "positionAmt": "1", "markPrice": "1"}])
    except RuntimeError as error:
        assert "Unknown non-flat Aster symbol" in str(error)
    else:
        raise AssertionError("Unknown non-flat symbols must fail closed")

    class FakeAster:
        def positions(self):
            return rows

    engine.live = True
    engine.aster = FakeAster()
    engine.account_info = lambda: account
    live_snapshot = engine.gross_snapshot()
    assert abs(live_snapshot["cryptoNotionalUsd"] - 50.0) < EPSILON
    assert abs(live_snapshot["stockNotionalUsd"] - 500.0) < EPSILON

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

    diagnostics_log = []
    engine.state = {"nyDay": "2026-08-24"}
    engine.save = lambda: None
    engine.log = lambda event, **payload: diagnostics_log.append((event, payload))
    engine._record_gate_diagnostics(
        V50_SLOT,
        None,
        {"META": ["SPREAD_OVER_20", "DEPTH_BELOW_2X"], "MSFT": ["SPREAD_OVER_20"]},
        window="11:30",
    )
    diag = engine.state["v52GateDiagnostics"]
    assert diag["decisions"] == 1
    assert diag["acceptedCandidates"] == 0
    assert diag["rejections"]["SPREAD_OVER_20"] == 2
    assert diag["rejections"]["DEPTH_BELOW_2X"] == 1
    assert diagnostics_log[-1][0] == "v52-gate-diagnostics"

    # A missing/stale V12+PENGU crypto-risk document must no longer stop V52
    # before V52 market-data/signal processing. This is an offline no-order test.
    progress = {"history": 0}
    engine.live = True
    engine.state = {}
    engine.reset_days = lambda: None
    engine.kill_switch = lambda: None
    engine.flatten_all = lambda _reason: None
    engine.enforce_daily_loss = lambda: False
    engine.update_history = lambda: progress.__setitem__("history", progress["history"] + 1)
    engine.positions = lambda: {}
    engine.tick()
    assert progress["history"] == 1

    assert len(V12_CRYPTO_SYMBOLS) == 15
    assert V50_WINDOWS == ("11:30", "12:30", "13:30")
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
