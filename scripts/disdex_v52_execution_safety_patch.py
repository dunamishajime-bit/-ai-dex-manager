from __future__ import annotations

import copy
import dataclasses
import datetime as dt
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, Optional, Tuple

import disdex_v11eq_aster_only_live_engine as legacy

base = legacy.base

V11_SLOT = "V11_EQ"
V50_SLOT = "V50_POST_OPEN_BASIS"
V50_MIN_ENTRY_BASIS_BPS = 75.0
V50_CONVERGENCE_BPS = 15.0
V50_MAX_ADVERSE_BASIS_MOVE_BPS = 10.0
V50_MAX_ROUND_TRIP_COST_BPS = 60.0
V50_MIN_NET_EDGE_BPS = 10.0

STRATEGY_ID = "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96"
TRANSIENT_KINDS = {"TRANSIENT_PUBLIC_DATA", "TRANSIENT_REFERENCE_DATA"}
URGENT_EXIT_REASONS = {
    "BASIS_STOP",
    "MISSED_CHECKPOINT_FAIL_CLOSED",
    "FINAL_1530",
    "V96_MARGIN_PRIORITY",
    "DAILY_LOSS",
    "KILL_SWITCH",
    "FATAL_TICK_ERROR",
    "DATA_FAILURE_GRACE_EXCEEDED",
}


def _finite(value: Any, fallback: float = 0.0) -> float:
    result = base.finite(value, fallback)
    if not math.isfinite(result):
        return fallback
    return result


def _request_json(
    url: str,
    *,
    category: str,
    method: str = "GET",
    params: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 10.0,
) -> Any:
    if category not in base._API_COOLDOWN_UNTIL_MS:
        raise RuntimeError(f"Unknown API category: {category}")
    with base._ASTER_RATE_LIMIT_LOCK:
        current = base.now_ms()
        until = int(base._API_COOLDOWN_UNTIL_MS[category])
        if current < until:
            remaining = until - current
            raise RuntimeError(
                f"{base.transient_error_class(category, 429)}: "
                f"{category} cooldown active ({remaining}ms remaining)"
            )

    encoded = None
    target = url
    if params:
        data = urllib.parse.urlencode(
            {
                key: str(value).lower() if isinstance(value, bool) else str(value)
                for key, value in params.items()
                if value is not None
            }
        )
        if method.upper() == "GET":
            target = f"{url}{'&' if '?' in url else '?'}{data}"
        else:
            encoded = data.encode()

    request = urllib.request.Request(
        target,
        data=encoded,
        method=method.upper(),
        headers={"User-Agent": "DisDex-V52-Safety/1.0", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        if error.code == 429:
            retry_after = _finite(
                error.headers.get("Retry-After"),
                base.ASTER_429_COOLDOWN_MS / 1000.0,
            )
            cooldown = max(
                base.ASTER_429_COOLDOWN_MS,
                int(retry_after * 1000),
            )
            with base._ASTER_RATE_LIMIT_LOCK:
                base._API_COOLDOWN_UNTIL_MS[category] = max(
                    int(base._API_COOLDOWN_UNTIL_MS[category]),
                    base.now_ms() + cooldown,
                )
        kind = base.transient_error_class(category, error.code)
        raise RuntimeError(
            f"{kind}: {category} HTTP {error.code} {target}: {body[:500]}"
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        kind = base.transient_error_class(category, 503)
        raise RuntimeError(f"{kind}: {category} request failed: {error}") from error


class V52AsterClient(base.AsterClient):
    """Aster client with explicit signed-request rate-limit isolation."""

    def _signed(self, method: str, path: str, params: Dict[str, Any]) -> Any:
        if self._signer is None:
            raise RuntimeError("Aster signed method called without live credentials")
        signed = {
            **params,
            "recvWindow": params.get("recvWindow", self.recv_window),
            "nonce": self._next_nonce(),
            "user": self.user_address,
            "signer": self._signer.address,
        }
        message = urllib.parse.urlencode(
            {
                key: str(value).lower() if isinstance(value, bool) else str(value)
                for key, value in signed.items()
                if value is not None
            }
        )
        from eth_account.messages import encode_typed_data

        signable = encode_typed_data(
            full_message={
                "domain": {
                    "name": "AsterSignTransaction",
                    "version": "1",
                    "chainId": 1666,
                    "verifyingContract": "0x0000000000000000000000000000000000000000",
                },
                "types": {
                    "EIP712Domain": [
                        {"name": "name", "type": "string"},
                        {"name": "version", "type": "string"},
                        {"name": "chainId", "type": "uint256"},
                        {"name": "verifyingContract", "type": "address"},
                    ],
                    "Message": [{"name": "msg", "type": "string"}],
                },
                "primaryType": "Message",
                "message": {"msg": message},
            }
        )
        signature = self._signer.sign_message(signable).signature.hex()
        return _request_json(
            f"{self.base_url}{path}",
            category="ASTER_SIGNED",
            method=method,
            params={**signed, "signature": signature},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=self.timeout,
        )


def _error_kind(error: Exception) -> str:
    text = str(error).upper()
    for kind in (
        "TRANSIENT_PUBLIC_DATA",
        "TRANSIENT_REFERENCE_DATA",
        "SIGNED_API_FAILURE",
        "ORDER_EXECUTION_UNKNOWN",
        "STATE_RECONCILIATION_FAILURE",
        "GROSS_SAFETY_FAILURE",
    ):
        if kind in text:
            return kind
    if "UNKNOWN" in text and "ORDER" in text:
        return "ORDER_EXECUTION_UNKNOWN"
    if "RECONCIL" in text or "MISMATCH" in text or "PENDING" in text:
        return "STATE_RECONCILIATION_FAILURE"
    if "GROSS" in text or "BALANCE" in text or "EQUITY" in text:
        return "GROSS_SAFETY_FAILURE"
    return "PROGRAMMING_ERROR"


def _is_urgent(reason: str) -> bool:
    return reason in URGENT_EXIT_REASONS or reason.startswith("STATE_INCONSISTENCY")


def _augment_candidate(
    candidate: Optional[dict],
    *,
    slot: str,
    expected_notional: float,
    expected_gross: float,
    window: Optional[str] = None,
) -> Optional[dict]:
    if not candidate:
        return candidate
    candidate = dict(candidate)
    candidate["strategy"] = slot
    candidate["slot"] = slot
    candidate["expectedNotionalUsd"] = expected_notional
    candidate["notionalUsd"] = expected_notional
    candidate["expectedGross"] = expected_gross
    if window is not None:
        candidate["entryWindow"] = window
    cost = _finite(candidate.get("estimatedRoundTripCostBps"))
    convergence = (
        V50_CONVERGENCE_BPS if slot == V50_SLOT else base.V11_CONVERGENCE_BPS
    )
    candidate.setdefault(
        "estimatedNetEdgeBps",
        abs(_finite(candidate.get("basisBps"))) - convergence - cost,
    )
    return candidate


def _install_instance_defaults(self: Any) -> None:
    self.last_book_event = getattr(
        self,
        "last_book_event",
        {symbol: 0 for symbol in base.SYMBOLS},
    )
    self.data_failure_grace_ms = base.int_env(
        "DISDEX_V52_DATA_FAILURE_GRACE_MS",
        15_000,
    )
    self.entry_recheck_interval_ms = base.int_env(
        "DISDEX_V52_ENTRY_RECHECK_INTERVAL_MS",
        750,
    )


def _patched_init(original: Callable[..., None]) -> Callable[..., None]:
    def init(self: Any, mode: str) -> None:
        original(self, mode)
        old_client = self.aster
        replacement = V52AsterClient(self.live)
        replacement._rules = copy.deepcopy(getattr(old_client, "_rules", {}))
        replacement._exchange_info_loaded_at = int(
            getattr(old_client, "_exchange_info_loaded_at", 0)
        )
        replacement._cache = copy.deepcopy(getattr(old_client, "_cache", {}))
        self.aster = replacement
        _install_instance_defaults(self)

    return init


def _execution_capacity_gross(self: Any, snapshot: dict, slot: str) -> float:
    equity = _finite(snapshot.get("equityUsd"))
    wallet = _finite(snapshot.get("crossWalletBalanceUsd"), equity)
    available = _finite(snapshot.get("availableBalanceUsd"), wallet)
    unrealized = _finite(snapshot.get("unrealizedPnlUsd"))
    if equity <= 0 or wallet < 0 or available < 0:
        raise RuntimeError("GROSS_SAFETY_FAILURE: invalid Aster balance snapshot")
    if available > max(equity, wallet + max(0.0, unrealized)) * 1.5 + 1.0:
        raise RuntimeError(
            "GROSS_SAFETY_FAILURE: availableBalance is outside a reasonable range"
        )

    reserve = max(
        self.minimum_entry_usd,
        equity
        * base.float_env("DISDEX_V52_CASH_RESERVE_PCT", 10.0)
        / 100.0,
    )
    fee_headroom = max(
        0.0,
        equity
        * base.float_env("DISDEX_V52_ENTRY_FEE_HEADROOM_PCT", 0.10)
        / 100.0,
    )
    slippage_headroom = max(
        0.0,
        equity
        * base.float_env("DISDEX_V52_ENTRY_SLIPPAGE_HEADROOM_PCT", 0.15)
        / 100.0,
    )
    leverage = max(1.0, base.float_env("DISDEX_V52_LEVERAGE", 1.0))
    spendable_margin = max(
        0.0,
        available - reserve - fee_headroom - slippage_headroom,
    )
    balance_capacity = spendable_margin * leverage / equity
    balance_capacity = max(0.0, balance_capacity)

    snapshot.update(
        {
            "signalGross": 1.0,
            "balanceCapacityGross": balance_capacity,
            "reserveCapacityGross": balance_capacity,
            "costCapacityGross": balance_capacity,
            "equityUsd": equity,
            "walletBalanceUsd": wallet,
            "crossWalletBalanceUsd": wallet,
            "availableBalanceUsd": available,
            "reportedAvailableBalanceUsd": available,
            "reconstructedAvailableBalanceUsd": None,
            "effectiveAvailableBalanceUsd": available,
            "unrealizedPnlUsd": unrealized,
            "reserveUsd": reserve,
            "feeHeadroomUsd": fee_headroom,
            "slippageHeadroomUsd": slippage_headroom,
            "requiredInitialMarginUsd": 0.0,
            "availableBalanceSource": "ASTER_REPORTED_FREE_MARGIN",
            "currentCryptoNotionalUsd": _finite(snapshot.get("cryptoNotionalUsd")),
            "currentStockNotionalUsd": _finite(snapshot.get("stockNotionalUsd")),
            "currentCryptoGross": _finite(snapshot.get("cryptoGross")),
            "currentStockGross": _finite(snapshot.get("stockGross")),
            "currentTotalGross": _finite(snapshot.get("totalGross")),
            "scaleReason": (
                "BALANCE_RESERVE_COST"
                if balance_capacity < 1.0
                else "NONE"
            ),
        }
    )
    return balance_capacity


def _available_slot_gross(self: Any, slot: str) -> Tuple[float, dict]:
    snapshot = self.gross_snapshot()
    if slot in self.positions() or self.v96_requires_margin():
        snapshot.update(
            {
                "slotCapacityGross": 0.0,
                "stockCapacityGross": max(
                    0.0,
                    self.stock_gross_cap - snapshot["stockGross"],
                ),
                "portfolioCapacityGross": max(
                    0.0,
                    self.portfolio_gross_cap - snapshot["totalGross"],
                ),
                "finalExecutionGross": 0.0,
                "executionGross": 0.0,
                "scaleReason": (
                    "SLOT_OCCUPIED"
                    if slot in self.positions()
                    else "V96_MARGIN_PRIORITY"
                ),
            }
        )
        return 0.0, snapshot

    signal_gross = self.v11_gross_cap if slot == V11_SLOT else self.v50_gross_cap
    balance_capacity = self.execution_capacity_gross(snapshot, slot)
    slot_capacity = signal_gross
    stock_capacity = max(
        0.0,
        self.stock_gross_cap - _finite(snapshot.get("stockGross")),
    )
    portfolio_capacity = max(
        0.0,
        self.portfolio_gross_cap - _finite(snapshot.get("totalGross")),
    )
    final_gross = max(
        0.0,
        min(
            signal_gross,
            balance_capacity,
            slot_capacity,
            stock_capacity,
            portfolio_capacity,
        ),
    )
    snapshot.update(
        {
            "signalGross": signal_gross,
            "slotCapacityGross": slot_capacity,
            "stockCapacityGross": stock_capacity,
            "portfolioCapacityGross": portfolio_capacity,
            "finalExecutionGross": final_gross,
            "executionGross": final_gross,
            "projectedCryptoGross": _finite(snapshot.get("cryptoGross")),
            "projectedStockGross": _finite(snapshot.get("stockGross")) + final_gross,
            "projectedTotalGross": _finite(snapshot.get("totalGross")) + final_gross,
        }
    )
    if final_gross + 1e-12 < signal_gross and snapshot.get("scaleReason") == "NONE":
        snapshot["scaleReason"] = "SLOT_OR_PORTFOLIO_CAPACITY"
    return final_gross, snapshot


def _v11_candidates(original: Callable[..., Any]) -> Callable[..., Any]:
    def wrapped(self: Any, rows: Any):
        candidate, rejections = original(self, rows)
        equity = self.portfolio_equity()
        gross = self.v11_notional / equity if equity > 0 else 0.0
        return (
            _augment_candidate(
                candidate,
                slot=V11_SLOT,
                expected_notional=self.v11_notional,
                expected_gross=gross,
            ),
            rejections,
        )

    return wrapped


def _v50_candidate(original: Callable[..., Any]) -> Callable[..., Any]:
    def wrapped(self: Any, window: str, rows: Any, notional: float):
        candidate, rejections = original(self, window, rows, notional)
        equity = self.portfolio_equity()
        gross = notional / equity if equity > 0 else 0.0
        return (
            _augment_candidate(
                candidate,
                slot=V50_SLOT,
                expected_notional=notional,
                expected_gross=gross,
                window=window,
            ),
            rejections,
        )

    return wrapped


def _validate_reference(self: Any, symbol: str, quote: Any, book: Any) -> None:
    now = base.now_ms()
    timestamp = int(getattr(quote, "timestamp_ms", 0) or 0)
    received = int(getattr(quote, "received_ms", 0) or 0)
    fallback = bool(getattr(self.reference, "last_timestamp_fallback", False))
    if fallback:
        self.log(
            "reference-timestamp-fallback",
            symbol=symbol,
            sourceTimestampMs=timestamp,
            receivedMs=received,
        )
    if timestamp <= 0:
        raise RuntimeError("TRANSIENT_REFERENCE_DATA: reference timestamp missing")
    if timestamp > now + 250:
        raise RuntimeError("TRANSIENT_REFERENCE_DATA: reference timestamp is in future")
    if now - timestamp > base.V11_MAX_DATA_AGE_MS:
        raise RuntimeError("TRANSIENT_REFERENCE_DATA: reference source timestamp stale")
    if received > 0 and received - timestamp > base.V11_MAX_DATA_AGE_MS:
        raise RuntimeError("TRANSIENT_REFERENCE_DATA: reference delivery latency exceeded")
    if abs(int(book.event_ms) - timestamp) > base.V11_MAX_SOURCE_CLOCK_DIFF_MS:
        raise RuntimeError("TRANSIENT_REFERENCE_DATA: source clock mismatch")


def _recheck_entry_conditions(
    self: Any,
    candidate: dict,
    slot: Optional[str] = None,
    actual_notional_usd: Optional[float] = None,
    *,
    full: bool = False,
) -> dict:
    slot = str(slot or candidate.get("slot") or candidate.get("strategy") or V11_SLOT)
    if slot not in {V11_SLOT, V50_SLOT}:
        raise RuntimeError(f"ENTRY_RECHECK_FAILED: unknown slot {slot}")
    symbol = str(candidate["symbol"])
    book = self.aster.book(base.ASTER_SYMBOL[symbol], 20)
    quote = self.reference.quote(symbol)
    _validate_reference(self, symbol, quote, book)

    basis = (book.mid / quote.price - 1.0) * 10_000.0
    signal_basis = _finite(
        candidate.get("signalBasisBps"),
        _finite(candidate.get("basisBps")),
    )
    threshold = (
        V50_MIN_ENTRY_BASIS_BPS
        if slot == V50_SLOT
        else base.V11_MIN_BASIS_BPS
    )
    if abs(basis) < threshold:
        raise RuntimeError(
            f"ENTRY_RECHECK_FAILED: {slot} basis below {threshold:.0f}bps"
        )
    if signal_basis * basis <= 0:
        raise RuntimeError("ENTRY_RECHECK_FAILED: basis sign changed")

    adverse = max(0.0, abs(basis) - abs(signal_basis))
    adverse_limit = (
        V50_MAX_ADVERSE_BASIS_MOVE_BPS
        if slot == V50_SLOT
        else base.V11_MAX_ADVERSE_BASIS_MOVE_BPS
    )
    if adverse > adverse_limit:
        raise RuntimeError("ENTRY_RECHECK_FAILED: adverse basis move")

    notional = max(
        1.0,
        _finite(
            actual_notional_usd,
            _finite(
                candidate.get("expectedNotionalUsd"),
                _finite(candidate.get("notionalUsd"), self.v11_notional),
            ),
        ),
    )
    side = str(candidate.get("side"))
    exit_action = "BUY" if side == "SELL" else "SELL"
    cost, detail = self.estimate_v11_cost(book, exit_action, notional)
    convergence = (
        V50_CONVERGENCE_BPS if slot == V50_SLOT else base.V11_CONVERGENCE_BPS
    )
    max_cost = (
        V50_MAX_ROUND_TRIP_COST_BPS
        if slot == V50_SLOT
        else base.V11_MAX_ROUND_TRIP_COST_BPS
    )
    min_edge = (
        V50_MIN_NET_EDGE_BPS
        if slot == V50_SLOT
        else base.V11_MIN_NET_EDGE_BPS
    )
    net_edge = abs(basis) - convergence - cost
    if cost > max_cost:
        raise RuntimeError("ENTRY_RECHECK_FAILED: round-trip cost limit")
    if net_edge < min_edge:
        raise RuntimeError("ENTRY_RECHECK_FAILED: net edge below 10bps")
    if book.depth_usd(exit_action) < base.V11_MIN_DEPTH_MULTIPLE * notional:
        raise RuntimeError("ENTRY_RECHECK_FAILED: depth below 2x")
    if book.spread_bps > base.V11_MAX_SPREAD_BPS:
        raise RuntimeError("ENTRY_RECHECK_FAILED: spread over 20bps")

    if slot == V11_SLOT and full:
        rows = self.books_and_refs()
        current = {
            name: (row[0].mid / row[2].price - 1.0) * 10_000.0
            for name, row in rows.items()
        }
        top1 = sorted(
            base.SYMBOLS,
            key=lambda name: (-abs(current[name]), name),
        )[0]
        if top1 != symbol:
            raise RuntimeError("ENTRY_RECHECK_FAILED: V11 no longer Top1")

    requested_gross = _finite(candidate.get("expectedGross"))
    if requested_gross > 0:
        available, gross_snapshot = self.available_slot_gross(slot)
        if available + self.gross_tolerance < requested_gross:
            raise RuntimeError("GROSS_SAFETY_FAILURE: execution Gross capacity fell")
    else:
        gross_snapshot = self.gross_snapshot()

    result = {
        "slot": slot,
        "symbol": symbol,
        "basisBps": basis,
        "signalBasisBps": signal_basis,
        "notionalUsd": notional,
        "roundTripCostBps": cost,
        "netEdgeBps": net_edge,
        "costDetail": detail,
        "grossSnapshot": gross_snapshot,
    }
    self.log("entry-recheck-pass", **result)
    return result


def _recheck_callback(
    self: Any,
    candidate: dict,
    slot: str,
    notional: float,
) -> Callable[[], bool]:
    last_check = 0

    def callback() -> bool:
        nonlocal last_check
        now = base.now_ms()
        if now - last_check < self.entry_recheck_interval_ms:
            return True
        last_check = now
        self.recheck_entry_conditions(
            candidate,
            slot=slot,
            actual_notional_usd=notional,
            full=False,
        )
        return True

    return callback


def _verify_flat_and_clear_pending(
    self: Any,
    *,
    slot: str,
    symbol: str,
    client_id: str,
    reason: str,
) -> None:
    if not self.live:
        self._clear_pending()
        return
    aster_symbol = base.ASTER_SYMBOL[symbol]
    positions = self.aster.positions()
    actual = next(
        (
            _finite(row.get("positionAmt"))
            for row in positions
            if str(row.get("symbol")) == aster_symbol
        ),
        0.0,
    )
    orders = self.aster.open_orders(aster_symbol)
    related = [
        row
        for row in orders
        if (
            str(row.get("clientOrderId") or "") == client_id
            or str(row.get("clientOrderId") or "").startswith("stock-v52-")
        )
    ]
    self.log(
        "failed-entry-reconciliation",
        slot=slot,
        symbol=symbol,
        reason=reason,
        actualPositionQty=actual,
        relatedOpenOrders=related,
    )
    rules = self.aster.rules(aster_symbol)
    flat_tolerance = max(1e-12, _finite(rules.get("step")) / 2.0)
    if abs(actual) > flat_tolerance or related:
        self.state["manualReviewReason"] = (
            f"{slot} failed-entry reconciliation incomplete for {symbol}"
        )
        self.save()
        raise RuntimeError(
            "STATE_RECONCILIATION_FAILURE: "
            "failed entry could not be confirmed flat"
        )
    self.state.pop("manualReviewReason", None)
    self._clear_pending()


def _resolve_failed_entry_after_fill(
    self: Any,
    *,
    slot: str,
    candidate: dict,
    fill: Any,
    reason: str,
) -> None:
    symbol = str(candidate["symbol"])
    client_id = str(
        (self.state.get("pendingOrder") or {}).get("clientId")
        or getattr(fill, "client_id", "")
    )
    executed = _finite(getattr(fill, "executed_qty", 0.0))
    if executed > 0:
        market = self.flatten_aster_leg(
            symbol,
            str(candidate["side"]),
            executed,
            reason,
        )
        if market.fill_ratio < 0.99:
            raise RuntimeError(
                "ORDER_EXECUTION_UNKNOWN: failed-entry flatten incomplete"
            )
    _verify_flat_and_clear_pending(
        self,
        slot=slot,
        symbol=symbol,
        client_id=client_id,
        reason=reason,
    )


def _open_basis_position(
    self: Any,
    slot: str,
    candidate: dict,
    target_gross: float,
) -> bool:
    candidate = _augment_candidate(
        candidate,
        slot=slot,
        expected_notional=_finite(candidate.get("expectedNotionalUsd")),
        expected_gross=target_gross,
        window=candidate.get("entryWindow"),
    ) or candidate
    if slot in self.positions() or any(
        position.get("symbol") == candidate["symbol"]
        for position in self.positions().values()
    ):
        return False

    available_gross, snapshot = self.available_slot_gross(slot)
    final_gross = min(target_gross, available_gross)
    snapshot["requestedSignalGross"] = target_gross
    snapshot["finalExecutionGross"] = final_gross
    snapshot["executionGross"] = final_gross
    self.assert_gross_safe(snapshot)
    target_notional = final_gross * snapshot["equityUsd"]
    if target_notional < self.minimum_entry_usd:
        self.log(
            "v52-entry-skipped",
            slot=slot,
            reason="FINAL_NOTIONAL_BELOW_MINIMUM",
            grossSnapshot=snapshot,
        )
        return False

    candidate["expectedGross"] = final_gross
    candidate["expectedNotionalUsd"] = target_notional
    candidate["notionalUsd"] = target_notional
    self.recheck_entry_conditions(
        candidate,
        slot=slot,
        actual_notional_usd=target_notional,
        full=True,
    )

    symbol = str(candidate["symbol"])
    aster_symbol = base.ASTER_SYMBOL[symbol]
    side = str(candidate["side"])
    quantity = target_notional / _finite(candidate["entryPrice"])
    quantity, price = self.aster.normalize(
        aster_symbol,
        quantity,
        _finite(candidate["entryPrice"]),
        side,
    )
    client = self.client_id(slot, symbol, "OPEN")
    self._set_pending(
        {
            "slot": slot,
            "action": "OPEN",
            "symbol": symbol,
            "side": side,
            "quantity": quantity,
            "clientId": client,
            "candidate": candidate,
            "targetGross": final_gross,
            "price": price,
            "grossAudit": snapshot,
        }
    )
    try:
        initial = self.aster.place_limit(
            symbol=aster_symbol,
            side=side,
            quantity=quantity,
            price=price,
            client_id=client,
            post_only=True,
        )
    except RuntimeError as error:
        if "GTX" in str(error).upper():
            self.log(
                "v52-entry-post-only-rejected",
                slot=slot,
                symbol=symbol,
                error=str(error),
            )
            self._clear_pending()
            return False
        raise

    if not self.live:
        fill = initial
    elif initial.status in {"REJECTED", "EXPIRED"}:
        if "GTX" in str(initial.error or "").upper():
            self._clear_pending()
            return False
        raise RuntimeError(
            f"ORDER_EXECUTION_UNKNOWN: entry rejected: {initial.error or initial.status}"
        )
    else:
        try:
            fill = self.aster.poll_fill(
                aster_symbol,
                client,
                quantity,
                side,
                base.V11_ENTRY_TTL_MS,
                recheck=_recheck_callback(
                    self,
                    candidate,
                    slot,
                    target_notional,
                ),
            )
        except RuntimeError as error:
            if "ENTRY_RECHECK_FAILED_DURING_WAIT" not in str(error):
                raise
            try:
                raw = self.aster.get_order(aster_symbol, client)
                fill = self.aster._fill(raw, quantity, side, client)
            except Exception as status_error:
                self.state["manualReviewReason"] = (
                    f"{slot} entry recheck failed and order state is unknown: "
                    f"{status_error}"
                )
                self.save()
                raise RuntimeError(
                    "ORDER_EXECUTION_UNKNOWN: entry recheck cancel status unresolved"
                ) from status_error
            _resolve_failed_entry_after_fill(
                self,
                slot=slot,
                candidate=candidate,
                fill=fill,
                reason="ENTRY_RECHECK_FAILED_DURING_WAIT",
            )
            return False

    self.log(
        "v52-entry-result",
        slot=slot,
        candidate=candidate,
        targetGross=final_gross,
        grossSnapshot=snapshot,
        fill=dataclasses.asdict(fill),
    )
    if fill.status == "UNKNOWN":
        raise RuntimeError("ORDER_EXECUTION_UNKNOWN: entry order status unknown")
    if fill.fill_ratio < base.V11_MIN_FILL_RATIO:
        _resolve_failed_entry_after_fill(
            self,
            slot=slot,
            candidate=candidate,
            fill=fill,
            reason=f"{slot}_LOW_FILL",
        )
        return False
    try:
        self.recheck_entry_conditions(
            candidate,
            slot=slot,
            actual_notional_usd=target_notional,
            full=True,
        )
    except Exception as error:
        self.log(
            "v52-post-fill-recheck-failed",
            slot=slot,
            candidate=candidate,
            error=str(error),
        )
        _resolve_failed_entry_after_fill(
            self,
            slot=slot,
            candidate=candidate,
            fill=fill,
            reason="ENTRY_POST_FILL_RECHECK",
        )
        return False

    local = dt.datetime.now(tz=base.NY)
    next_checkpoint = (
        local.replace(minute=30, second=0, microsecond=0)
        + dt.timedelta(hours=1)
    )
    maximum_exit = min(
        local + dt.timedelta(hours=3),
        local.replace(hour=15, minute=30, second=0, microsecond=0),
    )
    position = {
        "strategy": slot,
        "symbol": symbol,
        "openedAt": base.now_ms(),
        "entryBasisBps": candidate["basisBps"],
        "signalBasisBps": candidate.get("signalBasisBps"),
        "asterOpenSide": side,
        "asterQty": fill.executed_qty,
        "asterEntryPrice": fill.average_price or price,
        "targetGross": final_gross,
        "route": candidate.get("route"),
        "grossAudit": snapshot,
    }
    if slot == V50_SLOT:
        position.update(
            {
                "checksCompleted": 0,
                "nextCheckpointAt": int(next_checkpoint.timestamp() * 1000),
                "maximumExitAt": int(maximum_exit.timestamp() * 1000),
            }
        )
    self.positions()[slot] = position
    self._clear_pending()
    self.save()
    self.log("v52-position-open", slot=slot, position=position)
    return True


def _market_expected_price(self: Any, position: dict, close_side: str) -> float:
    symbol = str(position["symbol"])
    try:
        book = self.aster.book(base.ASTER_SYMBOL[symbol], 20)
        return book.ask if close_side == "BUY" else book.bid
    except Exception as error:
        fallback = _finite(position.get("asterEntryPrice"))
        if fallback <= 0:
            raise RuntimeError(
                f"TRANSIENT_PUBLIC_DATA: no safe market price fallback: {error}"
            ) from error
        self.log(
            "market-price-fallback",
            symbol=symbol,
            closeSide=close_side,
            fallbackPrice=fallback,
            error=str(error),
        )
        return fallback


def _confirm_position_closed(
    self: Any,
    *,
    slot: str,
    symbol: str,
    pending_client_id: str,
) -> None:
    if not self.live:
        return
    aster_symbol = base.ASTER_SYMBOL[symbol]
    positions = self.aster.positions()
    quantity = next(
        (
            _finite(row.get("positionAmt"))
            for row in positions
            if str(row.get("symbol")) == aster_symbol
        ),
        0.0,
    )
    open_orders = self.aster.open_orders(aster_symbol)
    relevant = [
        row
        for row in open_orders
        if (
            str(row.get("clientOrderId") or "") == pending_client_id
            or str(row.get("clientOrderId") or "").startswith("stock-v52-")
        )
    ]
    rules = self.aster.rules(aster_symbol)
    tolerance = max(1e-12, _finite(rules.get("step")) / 2.0)
    if abs(quantity) > tolerance or relevant:
        raise RuntimeError(
            "STATE_RECONCILIATION_FAILURE: close could not be confirmed flat"
        )


def _close_slot(self: Any, slot: str, reason: str) -> None:
    position = self.positions().get(slot)
    if not position:
        return
    symbol = str(position["symbol"])
    aster_symbol = base.ASTER_SYMBOL[symbol]
    open_side = str(position["asterOpenSide"])
    close_side = "SELL" if open_side == "BUY" else "BUY"
    quantity = _finite(position["asterQty"])
    if quantity <= 0:
        raise RuntimeError("STATE_RECONCILIATION_FAILURE: invalid close quantity")

    urgent = _is_urgent(reason)
    expected = _market_expected_price(self, position, close_side)
    client = self.client_id(slot, symbol, "CLOSE-MARKET" if urgent else "CLOSE-LIMIT")
    self._set_pending(
        {
            "slot": slot,
            "action": "CLOSE",
            "symbol": symbol,
            "side": close_side,
            "quantity": quantity,
            "clientId": client,
            "reason": reason,
            "urgent": urgent,
        }
    )

    fill = None
    if urgent:
        fill = self.aster.place_market(
            symbol=aster_symbol,
            side=close_side,
            quantity=quantity,
            expected_price=expected,
            client_id=client,
            reduce_only=True,
        )
    else:
        book = self.aster.book(aster_symbol, 20)
        passive_price = base.passive_exit_price(book, close_side)
        try:
            initial = self.aster.place_limit(
                symbol=aster_symbol,
                side=close_side,
                quantity=quantity,
                price=passive_price,
                client_id=client,
                reduce_only=True,
                post_only=True,
            )
        except RuntimeError as error:
            if "GTX" not in str(error).upper():
                raise
            self.log(
                "post-only-exit-rejected-fallback",
                slot=slot,
                symbol=symbol,
                reason=reason,
                error=str(error),
            )
            initial = None

        if initial is None:
            fill = None
        elif initial.status in {"REJECTED", "EXPIRED"}:
            if "GTX" in str(initial.error or "").upper():
                fill = None
            else:
                raise RuntimeError(
                    f"ORDER_EXECUTION_UNKNOWN: exit rejected: "
                    f"{initial.error or initial.status}"
                )
        elif not self.live:
            fill = initial
        else:
            fill = self.aster.poll_fill(
                aster_symbol,
                client,
                quantity,
                close_side,
                2000,
            )

    executed = _finite(getattr(fill, "executed_qty", 0.0)) if fill else 0.0
    if fill is not None and fill.status == "UNKNOWN":
        raise RuntimeError("ORDER_EXECUTION_UNKNOWN: exit order status unknown")
    remaining = max(0.0, quantity - executed)
    if remaining > 1e-12:
        fallback_client = self.client_id(slot, symbol, "CLOSE-TAKER")
        pending = self.state.get("pendingOrder") or {}
        pending.update(
            {
                "fallbackClientId": fallback_client,
                "fallbackQuantity": remaining,
                "fallbackAction": "MARKET_REDUCE_ONLY",
            }
        )
        self.state["pendingOrder"] = pending
        self.save()
        market = self.aster.place_market(
            symbol=aster_symbol,
            side=close_side,
            quantity=remaining,
            expected_price=expected,
            client_id=fallback_client,
            reduce_only=True,
        )
        if market.fill_ratio < 0.99:
            raise RuntimeError("ORDER_EXECUTION_UNKNOWN: close fallback incomplete")

    _confirm_position_closed(
        self,
        slot=slot,
        symbol=symbol,
        pending_client_id=client,
    )
    self.positions().pop(slot, None)
    if slot == V50_SLOT:
        self.state["v50CompletedTrades"] = int(
            self.state.get("v50CompletedTrades", 0)
        ) + 1
    self._clear_pending()
    self.save()
    self.log("v52-position-closed", slot=slot, symbol=symbol, reason=reason)


def _handle_transient_tick_error(self: Any, error: Exception, kind: str) -> bool:
    if self.state.get("pendingOrder"):
        return False
    now = base.now_ms()
    failure = self.state.get("transientDataFailure") or {}
    if failure.get("kind") != kind:
        failure = {"kind": kind, "startedAt": now, "count": 0}
    failure["count"] = int(failure.get("count", 0)) + 1
    failure["lastAt"] = now
    failure["error"] = str(error)
    self.state["transientDataFailure"] = failure
    self.save()

    if not self.positions():
        self.log("v52-transient-data-deferred", **failure, positions=0)
        return True

    elapsed = now - int(failure.get("startedAt") or now)
    if elapsed < self.data_failure_grace_ms:
        self.log(
            "v52-transient-data-grace",
            **failure,
            positions=len(self.positions()),
            elapsedMs=elapsed,
            graceMs=self.data_failure_grace_ms,
        )
        return True

    self.log(
        "v52-transient-data-grace-exceeded",
        **failure,
        positions=len(self.positions()),
        elapsedMs=elapsed,
        graceMs=self.data_failure_grace_ms,
    )
    self.flatten_all("DATA_FAILURE_GRACE_EXCEEDED")
    self.activate_kill_switch(
        f"V52 data failure grace exceeded: {kind}"
    )
    raise RuntimeError(
        f"{kind}: data failure grace exceeded after safe flatten"
    )


def _run(self: Any, daemon: bool) -> None:
    self.lock.acquire()
    try:
        self.reset_days()
        self.reconcile()
        self.log(
            "v52-runner-start",
            strategyId=STRATEGY_ID,
            caps={
                "crypto": self.crypto_gross_cap,
                "stock": self.stock_gross_cap,
                "portfolio": self.portfolio_gross_cap,
                "v11": self.v11_gross_cap,
                "v50": self.v50_gross_cap,
            },
        )
        while not self.stop_requested:
            started = base.now_ms()
            try:
                self.tick()
                if self.state.pop("transientDataFailure", None) is not None:
                    self.save()
                    self.log("v52-transient-data-recovered")
            except Exception as error:
                kind = _error_kind(error)
                self.log("v52-tick-error", error=str(error), errorKind=kind)
                if self.live:
                    if kind in TRANSIENT_KINDS and _handle_transient_tick_error(
                        self,
                        error,
                        kind,
                    ):
                        pass
                    else:
                        self.activate_kill_switch(
                            f"V52 fatal tick error [{kind}]: {error}"
                        )
                        self.flatten_all("FATAL_TICK_ERROR")
                        raise
            if not daemon:
                break
            active = (
                base.clock("09:59:50")
                <= base.ny_seconds()
                <= base.clock("15:30:30")
                or bool(self.positions())
            )
            interval = (
                250
                if active
                else base.int_env("DISDEX_STOCK_IDLE_INTERVAL_MS", 5000)
            )
            time.sleep(
                max(0, interval - (base.now_ms() - started)) / 1000.0
            )
    finally:
        self.lock.release()


def self_test() -> None:
    import inspect

    signed_source = inspect.getsource(V52AsterClient._signed)
    assert 'category="ASTER_SIGNED"' in signed_source
    assert base.api_category(
        "https://fapi.asterdex.com/fapi/v1/depth",
        None,
    ) == "ASTER_PUBLIC"
    assert base.api_category(
        "https://example-reference.invalid/quote",
        None,
    ) == "REFERENCE"

    dummy = object.__new__(V52AsterClient)
    dummy._signer = None
    try:
        dummy._signed("GET", "/fapi/v3/order", {})
    except RuntimeError as error:
        assert "without live credentials" in str(error)
    else:
        raise AssertionError("Signed request must require credentials")

    assert _error_kind(
        RuntimeError("TRANSIENT_REFERENCE_DATA: rate limited")
    ) == "TRANSIENT_REFERENCE_DATA"
    assert _error_kind(
        RuntimeError("ORDER_EXECUTION_UNKNOWN: unresolved")
    ) == "ORDER_EXECUTION_UNKNOWN"

    class FakeBook:
        bid = 99.9
        ask = 100.1

    assert base.passive_exit_price(FakeBook(), "SELL") == 100.1
    assert base.passive_exit_price(FakeBook(), "BUY") == 99.9
    print("V52 execution safety patch self-test: PASS")


def install_class(cls: Any) -> None:
    if getattr(cls, "_v52_execution_safety_installed", False):
        return
    cls.__init__ = _patched_init(cls.__init__)
    cls.execution_capacity_gross = _execution_capacity_gross
    cls.available_slot_gross = _available_slot_gross
    cls.v11_candidates = _v11_candidates(cls.v11_candidates)
    cls.v50_candidate = _v50_candidate(cls.v50_candidate)
    cls.recheck_entry_conditions = _recheck_entry_conditions
    cls.resolve_failed_entry_after_fill = _resolve_failed_entry_after_fill
    cls.open_basis_position = _open_basis_position
    cls.close_slot = _close_slot
    cls.run = _run
    cls._v52_execution_safety_installed = True


def main() -> int:
    self_test()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
