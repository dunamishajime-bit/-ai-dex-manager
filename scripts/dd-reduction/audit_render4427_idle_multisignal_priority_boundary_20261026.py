#!/usr/bin/env python3
"""Read-only, source-pinned audit of the legacy IDLE multi-signal selection boundary.
No target module import/exec, no order path, no filesystem writes.
"""
import hashlib
import json
import re
import urllib.request

REF = "939b59da49ce7960485a2004b0068dc63417ae82"
BASE = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/" + REF + "/"
PINS = {
    "lib/idle-priority-short-runner.ts": "0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33",
    "lib/idle-priority-short-live.ts": "185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c",
    "config/idlePriorityShortPolicy.ts": "6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
}

def require(condition, label):
    if not condition:
        raise RuntimeError(label)

def fetch_pinned():
    sources = {}
    for path, pin in PINS.items():
        with urllib.request.urlopen(BASE + path, timeout=25) as response:
            raw = response.read()
        require(hashlib.sha256(raw).hexdigest() == pin, "SOURCE_SHA_DRIFT:" + path)
        sources[path] = raw.decode("utf-8")
    return sources

def inspect(sources):
    runner = sources["lib/idle-priority-short-runner.ts"]
    live = sources["lib/idle-priority-short-live.ts"]
    policy = sources["config/idlePriorityShortPolicy.ts"]
    tick = runner.split("async tick():", 1)
    require(len(tick) == 2, "TICK_NOT_FOUND")
    tick = tick[1]
    start = tick.index("const rawGeneric =")
    end = tick.index("let aggregateResult:", start)
    selection = tick[start:end]
    require("const routeCandidates = rawGeneric" in selection, "ROUTE_FILTER_DRIFT")
    require("const lifecycleCandidates = routeCandidates.filter" in selection, "LIFECYCLE_FILTER_DRIFT")
    require("const signals = lifecycleCandidates" in selection, "SIGNAL_FILTER_DRIFT")
    require("if (signals.length > 1)" in selection, "MULTISIGNAL_GUARD_DRIFT")
    require("const requestedGross = signals.reduce((sum, signal) => sum + IDLE_PRIORITY_SHORT_POLICY.routes[signal.symbol].gross, 0);" in selection, "SUM_GROSS_DRIFT")
    require("fullCryptoGrossAvailable + EPSILON < requestedGross || fullTotalGrossAvailable + EPSILON < requestedGross" in selection, "CAPACITY_CHECK_DRIFT")
    require('reason: "IDLE_MULTI_SIGNAL_CAPACITY_AMBIGUOUS"' in selection, "ALL_REJECT_REASON_DRIFT")
    require('return { status: "held", message: "IDLE_MULTI_SIGNAL_CAPACITY_AMBIGUOUS"' in selection, "ALL_REJECT_RETURN_DRIFT")
    require(".sort(" not in selection and ".toSorted(" not in selection, "PRIORITY_SORT_CHANGED")
    after = tick[end:]
    require("for (const signal of signals)" in after, "SERIAL_SIGNAL_LOOP_DRIFT")
    require("const result = await this.enter(state, signal" in after, "SERIAL_ENTER_DRIFT")
    require("evaluateIdleLiveAdmission(baseInput)" in runner, "ADMISSION_CALL_DRIFT")
    require("const requestedGross = input.symbol ? IDLE_PRIORITY_SHORT_POLICY.routes[input.symbol].gross : 1;" in live, "LIVE_GROSS_DRIFT")
    require('RENDERUSDT: { route: "IDLE_RENDER_RELATIVE_SHORT"' in policy, "RENDER_POLICY_DRIFT")
    require("IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT" not in policy, "RESEARCH_ROUTE_ALREADY_REGISTERED")
    # Scope is this runner's import and entry path, not all Native8 code.
    require("strict_gate_proof" not in runner.lower() and "GateProof" not in runner, "PROOF_IMPORT_DRIFT")
    return {
        "all_or_nothing_capacity_guard": True,
        "selection_explicit_score_sort": False,
        "serial_loop_after_guard": True,
        "research_route_registered": False,
        "strict_gate_proof_in_runner": False,
    }

def modeled_guard(grosses, crypto_room, total_room):
    """Only the source-identified aggregate capacity condition; NOT a backtest."""
    if len(grosses) > 1 and (crypto_room + 1e-9 < sum(grosses) or total_room + 1e-9 < sum(grosses)):
        return "REJECT_ALL_IDLED_MULTI_SIGNAL_CAPACITY_AMBIGUOUS"
    return "CONTINUE_TO_PER_SIGNAL_CHECKS"

def scenarios():
    cases = [
        ("render_only", [0.25], 0.30, 0.30, "CONTINUE_TO_PER_SIGNAL_CHECKS"),
        ("render_plus_jup_insufficient_sum", [0.25, 1.0], 0.30, 0.30, "REJECT_ALL_IDLED_MULTI_SIGNAL_CAPACITY_AMBIGUOUS"),
        ("render_plus_dot_insufficient_sum", [0.25, 0.25], 0.30, 0.30, "REJECT_ALL_IDLED_MULTI_SIGNAL_CAPACITY_AMBIGUOUS"),
        ("render_plus_dot_full_room", [0.25, 0.25], 0.50, 0.50, "CONTINUE_TO_PER_SIGNAL_CHECKS"),
        ("render_plus_jup_full_room", [0.25, 1.0], 1.25, 1.25, "CONTINUE_TO_PER_SIGNAL_CHECKS"),
        ("crypto_room_only_short", [0.25, 1.0], 0.30, 2.0, "REJECT_ALL_IDLED_MULTI_SIGNAL_CAPACITY_AMBIGUOUS"),
        ("total_room_only_short", [0.25, 1.0], 2.0, 0.30, "REJECT_ALL_IDLED_MULTI_SIGNAL_CAPACITY_AMBIGUOUS"),
    ]
    out = {}
    for name, gross, crypto, total, expected in cases:
        actual = modeled_guard(gross, crypto, total)
        require(actual == expected, "MODEL_DRIFT:" + name)
        out[name] = {"grosses": gross, "crypto_room": crypto, "total_room": total, "result": actual}
    return out

def main():
    sources = fetch_pinned()
    result = {
        "scope": "read_only_source_pinned_legacy_idle_runner_not_native8_certification",
        "source_ref": REF,
        "pins": PINS,
        "static_checks": inspect(sources),
        "synthetic_capacity_scenarios": scenarios(),
        "live_order_authorized": False,
        "native8_gateproof_authenticated": False,
        "economic_backtest_performed": False,
    }
    canonical = json.dumps(result, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    print(json.dumps({"canonical_sha256": hashlib.sha256(canonical).hexdigest(), "audit": result}, sort_keys=True, ensure_ascii=False))

if __name__ == "__main__":
    main()
