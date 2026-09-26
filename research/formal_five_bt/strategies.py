"""Fail-closed adapters over the audited production strategy functions."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any, Mapping

from .manifest import load_manifest


HERE = Path(__file__).resolve().parent
BRIDGE = HERE / "runtime_bridge.mjs"
EXPECTED_RUNTIME_SHA = "a09ea45ca3cbd72100f9eb0eaae499039c40b6a0"


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class Gate:
    name: str
    status: str
    reason: str
    details: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class DecisionTrace:
    strategy_id: str
    symbol: str
    signal_time_ms: int
    data_cutoff_ms: int
    gates: tuple[Gate, ...]
    order_intent: Mapping[str, Any] | None
    raw_result: Mapping[str, Any]
    source_runtime_sha: str
    input_sha256: str

    @property
    def eligible(self) -> bool:
        return bool(self.order_intent) and all(gate.status == "PASS" for gate in self.gates)


class RuntimeBridge:
    """Persistent, hash-verifying Node bridge into the captured live source."""

    def __init__(self, node: str = "node") -> None:
        manifest = load_manifest(HERE / "runtime_source_manifest.json")
        if manifest["runtime_sha"] != EXPECTED_RUNTIME_SHA:
            raise RuntimeError("AUDITED_RUNTIME_SHA_MISMATCH")
        self.runtime_sha = manifest["runtime_sha"]
        self._process = subprocess.Popen(
            [node, str(BRIDGE)],
            cwd=HERE.parents[1],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        response = self._request({"op": "list"})
        self._exports = response["result"]
        if self._exports.get("runtimeSha") != self.runtime_sha:
            self.close()
            raise RuntimeError("NODE_BRIDGE_RUNTIME_SHA_MISMATCH")

    def _request(self, request: Mapping[str, Any]) -> dict[str, Any]:
        if self._process.poll() is not None or self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("NODE_RUNTIME_BRIDGE_EXITED")
        self._process.stdin.write(_canonical_json(request) + "\n")
        self._process.stdin.flush()
        line = self._process.stdout.readline()
        if not line:
            error_text = self._process.stderr.read() if self._process.stderr else ""
            raise RuntimeError(f"NODE_RUNTIME_BRIDGE_NO_RESPONSE:{error_text[:240]}")
        response = json.loads(line)
        if response.get("ok") is not True:
            raise RuntimeError(f"LIVE_RUNTIME_CALL_FAILED:{response.get('error', 'unknown')}")
        return response

    def list_exports(self) -> dict[str, Any]:
        return dict(self._exports)

    def invoke(self, module: str, function: str, *args: Any) -> Any:
        return self._request({"op": "invoke", "module": module, "function": function, "args": list(args)})["result"]

    def v12_series(self, h1_by_symbol: Mapping[str, Any], start_ms: int, end_ms: int) -> Mapping[str, Any]:
        return self._request({"op": "v12Series", "h1BySymbol": h1_by_symbol, "startMs": start_ms, "endMs": end_ms})["result"]

    def pengu_series(self, history: Mapping[str, Any], now_ms: int) -> Any:
        return self._request({"op": "penguSeries", "history": history, "now": now_ms})["result"]

    def fet_series(self, rows: list[list[Any]], start_ms: int, end_ms: int) -> Any:
        return self._request({"op": "fetSeries", "rows": rows, "startMs": start_ms, "endMs": end_ms})["result"]

    def q102_series(self, candles_by_symbol: Mapping[str, Any], high_vol_symbols: list[str], symbols: list[str], start_ms: int, end_ms: int) -> Any:
        return self._request({"op": "q102Series", "candlesBySymbol": candles_by_symbol, "highVolSymbols": high_vol_symbols, "symbols": symbols, "startMs": start_ms, "endMs": end_ms})["result"]

    def plan_strict_portfolio(self, input: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._request({"op": "planStrictPortfolio", "input": input})["result"]

    def close(self) -> None:
        process = getattr(self, "_process", None)
        if process is None:
            return
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()

    def __enter__(self) -> "RuntimeBridge":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()


def _asof(history: Mapping[str, Any], portfolio: Mapping[str, Any]) -> int:
    value = history.get("decision_ts_ms", history.get("as_of_ms", portfolio.get("as_of_ms")))
    if not isinstance(value, int) or value <= 0:
        raise ValueError("decision timestamp must be a positive UTC epoch in milliseconds")
    return value


def _bar_time(bar: Mapping[str, Any]) -> int | None:
    for field in ("timestampMs", "openTime", "openTs", "ts"):
        value = bar.get(field)
        if isinstance(value, int):
            return value
    return None


def _gate(name: str, passed: bool | None, reason: str, **details: Any) -> Gate:
    return Gate(name, "UNVERIFIED" if passed is None else "PASS" if passed else "FAIL", reason, details)


def _trace(
    strategy: str,
    symbol: str,
    asof_ms: int,
    cutoff_ms: int,
    gates: list[Gate],
    intent: Mapping[str, Any] | None,
    raw: Mapping[str, Any],
    bridge: RuntimeBridge,
    source_input: Mapping[str, Any],
) -> DecisionTrace:
    if cutoff_ms > asof_ms:
        raise ValueError("FUTURE_DATA_CUTOFF")
    # Provenance is not strategy eligibility. Missing source rows block orders.
    data_gate = source_input.get("provenance_verified") is True
    result_gates = [*gates, _gate("SOURCE_PROVENANCE", data_gate, "source provenance verified" if data_gate else "SOURCE_PROVENANCE_NOT_VERIFIED")]
    if not data_gate:
        intent = None
    return DecisionTrace(
        strategy, symbol, asof_ms, cutoff_ms, tuple(result_gates), intent, raw,
        bridge.runtime_sha, _sha(source_input),
    )


def evaluate(
    strategy_id: str,
    symbol: str,
    history_asof: Mapping[str, Any],
    config: Mapping[str, Any],
    portfolio_state: Mapping[str, Any],
    *,
    bridge: RuntimeBridge,
) -> DecisionTrace:
    """Evaluate one strategy decision using only caller-provided as-of inputs.

    The adapters return an order intent only when the LIVE signal is present and
    all source provenance has been independently validated. Orders remain
    separate from fills and portfolio allocation.
    """
    strategy = strategy_id.strip().upper()
    asof_ms = _asof(history_asof, portfolio_state)
    if history_asof.get("source_cutoff_ms", asof_ms) > asof_ms:
        raise ValueError("INPUT_SOURCE_TIME_AFTER_DECISION")

    if strategy == "V12":
        universe = history_asof.get("bars_by_symbol")
        index = history_asof.get("index")
        if not isinstance(universe, Mapping) or not isinstance(index, int):
            raise ValueError("V12_HISTORY_REQUIRES_BARS_BY_SYMBOL_AND_INDEX")
        observation = bridge.invoke("v12", "buildV12DecisionObservation", universe, index, asof_ms)
        candidates = observation.get("candidates", []) if observation else []
        base = symbol.removesuffix("USDT")
        candidate = next((item for item in candidates if item.get("symbol", "").upper() == base), None)
        cutoff = min((_bar_time(item) for rows in universe.values() for item in rows if _bar_time(item) is not None), default=0)
        if observation:
            ref_ts = int(observation.get("referenceTs") or 0)
            cutoff = min(asof_ms, ref_ts)
        gates = [
            _gate("BTC_REGIME", bool(observation and observation.get("btcRegime") in {"LONG", "SHORT", "NEUTRAL"}), "LIVE V12 regime computed" if observation else "V12_HISTORY_OR_REGIME_UNAVAILABLE", btcRegime=observation.get("btcRegime") if observation else None),
            _gate("UNIVERSE_CANDIDATE", candidate is not None, candidate.get("signalReason", "V12_SYMBOL_NOT_A_CANDIDATE") if candidate else "V12_SYMBOL_NOT_A_CANDIDATE", candidate=candidate),
        ]
        if candidate:
            gates.append(_gate("ENTRY_QUALITY", candidate.get("entryGateReason") in {"ALLOW_STANDARD", "ALLOW_HC175"}, candidate.get("entryGateReason", "V12_ENTRY_GATE_MISSING"), rank=candidate.get("portfolioRank"), score=candidate.get("score"), volumeRatio=candidate.get("volumeRatio")))
        signal = next((row for row in bridge.invoke("v12", "buildV12Signals", universe, index) if row.get("symbol", "").upper() == base), None)
        intent = ({"side": signal["side"], "referenceTs": signal["referenceTs"], "entryTs": signal["entryTs"], "rank": signal["rank"], "signal": signal} if signal else None)
        return _trace(strategy, symbol, asof_ms, cutoff, gates, intent, {"runtime": observation, "signal": signal}, bridge, history_asof)

    if strategy == "PENGU":
        history = {key: history_asof[key] for key in ("pengu1h", "btc1h", "penguFunding") if key in history_asof}
        position = portfolio_state.get("position")
        options = dict(config.get("options", {}))
        signal = bridge.invoke("pengu", "buildPenguDualLsV2Signal", history, position, asof_ms, int(portfolio_state.get("cooldown_until_ms", 0)), options)
        cutoff = min(int(signal.get("diagnostics", {}).get("latestCompletedPenguTs") or asof_ms), asof_ms)
        diag = signal.get("diagnostics", {})
        gates = [
            _gate("COMPLETED_H1", diag.get("evaluatedDecisionBars", 0) > 0, signal.get("reason", "PENGU_HISTORY_UNAVAILABLE"), diagnostics=diag),
            _gate("QUARANTINE", not diag.get("cooldownBlocked", False), "PENGU_ROUTE_COOLDOWN" if diag.get("cooldownBlocked") else "PENGU_COOLDOWN_CLEAR"),
            _gate("DIRECTION_SIGNAL", signal.get("side") in (-1, 1), signal.get("reason", "PENGU_NO_SIGNAL"), side=signal.get("side"), entryVersion=signal.get("entryVersion")),
        ]
        intent = ({"side": "LONG" if signal["side"] > 0 else "SHORT", "targetGross": signal.get("targetGross"), "entryTs": signal.get("entryTs"), "signal": signal} if signal.get("side") else None)
        return _trace(strategy, symbol, asof_ms, cutoff, gates, intent, {"runtime": signal}, bridge, history_asof)

    if strategy == "Q102":
        history = history_asof.get("history")
        decision_ts = history_asof.get("decisionTs", asof_ms)
        high_vol = list(config.get("highVolSymbols", history_asof.get("highVolSymbols", [])))
        symbols = list(config.get("symbols", history_asof.get("symbols", [])))
        if not isinstance(history, Mapping) or not symbols:
            raise ValueError("Q102_HISTORY_AND_EXPLICIT_SYMBOLS_REQUIRED")
        snapshot = bridge.invoke("q102Observability", "buildQuality102CausalV4DecisionSnapshot", {
            "history": history,
            "decisionTs": decision_ts,
            "highVolSymbols": high_vol,
            "symbols": symbols,
            "runtimeCommitSha": bridge.runtime_sha,
        })
        item = next((row for row in snapshot.get("items", []) if row["symbol"].upper() == symbol.upper()), None)
        signal = bridge.invoke("q102Signal", "buildQuality102CausalV4Signal", {
            "history": history,
            "decisionTs": decision_ts,
            "sleeveOccupancy": {
                "activePosition": bool(portfolio_state.get("active_position")),
                "unresolvedPendingEntry": bool(portfolio_state.get("pending_entry")),
                "basePositionActive": bool(portfolio_state.get("base_position_active")),
            },
        }, {"highVolSymbols": high_vol} if high_vol else {})
        cutoff = min(int(signal.get("dataCutoffTs") or decision_ts), decision_ts)
        gates = [
            _gate("HISTORY_ASOF", cutoff <= decision_ts, "Q102 causal history cutoff verified", dataCutoffTs=cutoff),
            _gate("MODEL_CANDIDATE", bool(item and item.get("eligible")), item.get("reason", "Q102_SYMBOL_NOT_ELIGIBLE") if item else "Q102_SYMBOL_NOT_IN_UNIVERSE", item=item),
            _gate("ONE_SLOT_SELECTION", bool(item and item.get("selected")), "Q102 candidate selected" if item and item.get("selected") else (snapshot.get("selectedReason") or "Q102_NOT_SELECTED")),
        ]
        intent = ({"side": "LONG" if signal["side"] > 0 else "SHORT", "requestedGross": signal.get("requestedGross"), "family": signal.get("family"), "variant": signal.get("variant"), "signal": signal} if signal.get("side") and signal.get("symbol", "").upper() == symbol.upper() else None)
        return _trace(strategy, symbol, asof_ms, cutoff, gates, intent, {"runtime": signal, "snapshot": snapshot, "item": item}, bridge, history_asof)

    if strategy == "FET":
        raw_rows = history_asof.get("bars")
        if not isinstance(raw_rows, list):
            raise ValueError("FET_HISTORY_REQUIRES_RAW_ASTER_KLINES")
        normalized = bridge.invoke("fet", "normalizeFetH1", raw_rows, asof_ms)
        signal = bridge.invoke("fet", "buildFetBrk48Signal", normalized, asof_ms)
        completed = [bar for bar in normalized if bar.get("closeTs", asof_ms + 1) < asof_ms]
        cutoff = max((int(bar["closeTs"]) for bar in completed), default=0)
        hour = asof_ms // 3_600_000
        gates = [
            _gate("ENTRY_SCHEDULE", hour % 4 == 1, "LIVE FET decision schedule" if hour % 4 == 1 else "OUTSIDE_FET_ENTRY_SCHEDULE"),
            _gate("HISTORY_DEPTH", len(completed) >= 73, "72h volume and 48h breakout history" if len(completed) >= 73 else "FET_HISTORY_LT_73_BARS", completedBars=len(completed)),
            _gate("BREAKOUT_VOLUME_SIGNAL", signal is not None, "LIVE FET breakout and volume condition" if signal else "BREAKOUT_OR_VOLUME_GATE_FAILED"),
        ]
        intent = ({"side": "LONG", "entryTs": signal["entryTs"], "referenceTs": signal["referenceTs"], "hardStopPrice": signal["hardStopPrice"], "exitTs": signal["exitTs"], "signal": signal} if signal else None)
        return _trace(strategy, symbol, asof_ms, cutoff, gates, intent, {"runtime": signal}, bridge, history_asof)

    if strategy == "V52":
        # V52 has no side-effect-free exported signal module yet. Never synthesize
        # a trade when its exact quote/book candidate method cannot be replayed.
        return _trace(strategy, symbol, asof_ms, int(history_asof.get("source_cutoff_ms", 0)), [
            _gate("V52_LIVE_CANDIDATE", None, "V52_PYTHON_CANDIDATE_ADAPTER_NOT_VALIDATED"),
            _gate("NYSE_SESSION", None, "NYSE_SESSION_REQUIRES_SOURCE_ALIGNED_QUOTE"),
        ], None, {"runtime": None, "status": "NOT_VERIFIABLE"}, bridge, history_asof)

    raise ValueError(f"unsupported strategy id: {strategy_id}")
