#!/usr/bin/env python3
"""RESEARCH ONLY: static source-pinned IDLE route/idempotency identity boundary.
Reads three pinned GitHub source blobs. Does not import TS, trade, write files,
alter native allocation, or claim that a real route collision occurred.
"""
from __future__ import annotations
import hashlib
import json
import re
import urllib.request

REF = "031953373ec09e2902e0e6eefa0afb19e4d163f4"
BASE = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/" + REF + "/"
PINS = {
    "lib/idle-priority-short-live.ts": "185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c",
    "lib/idle-priority-short-runner.ts": "0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33",
    "config/idlePriorityShortPolicy.ts": "6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
}
RESEARCH_ROUTE = "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT"
INCUMBENT_ROUTE = "IDLE_RENDER_RELATIVE_SHORT"
SYMBOL = "RENDERUSDT"
TS = 1782176400000


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def fetch_pinned(path, expected):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "render4427-readonly-audit"})
    with urllib.request.urlopen(req, timeout=35) as stream:
        raw = stream.read()
    require(hashlib.sha256(raw).hexdigest() == expected, "SOURCE_SHA_DRIFT:" + path)
    return raw.decode("utf-8")


def source_assertions(sources):
    live = sources["lib/idle-priority-short-live.ts"]
    runner = sources["lib/idle-priority-short-runner.ts"]
    policy = sources["config/idlePriorityShortPolicy.ts"]
    match = re.search(
        r"export function deterministicIdleClientOrderId\b[\s\S]*?(?=export type IdleProtectionPlan)",
        live,
    )
    require(match is not None, "CLIENT_ID_FUNCTION_NOT_FOUND")
    fn = re.sub(r"\s+", "", match.group(0))
    require('["IDLE_PRIORITY_SHORT",input.action,input.symbol.toUpperCase(),input.signalTs].join("|")' in fn,
            "CLIENT_ID_HASH_INPUT_DRIFT")
    require('.digest("hex").slice(0,22)' in fn, "CLIENT_ID_DIGEST_DRIFT")
    require('return`idle-${input.action.toLowerCase()}-${digest}`.slice(0,36)' in fn,
            "CLIENT_ID_FORMAT_DRIFT")
    require("route" not in fn.lower() and "owner" not in fn.lower() and "gross" not in fn.lower(),
            "CLIENT_ID_IDENTITY_SCHEMA_CHANGED")
    normalized_runner = re.sub(r"\s+", "", runner)
    require('deterministicIdleClientOrderId({action:"ENTRY",symbol,signalTs:signal.features.signalTs})'
            in normalized_runner, "LIVE_ENTRY_CLIENT_ID_CALL_DRIFT")
    require("route:signal.route,clientOrderId,idempotencyKey:clientOrderId" in normalized_runner,
            "LIVE_PENDING_ROUTE_ID_SEPARATION_DRIFT")
    require('deterministicIdleClientOrderId({action:"EXIT",symbol:owned.symbol,signalTs:owned.signalTs})'
            in normalized_runner, "LIVE_EXIT_CLIENT_ID_CALL_DRIFT")
    require('deterministicIdleClientOrderId({action:"STOP",symbol:owned.symbol,signalTs:owned.signalTs+barTs})'
            in normalized_runner, "LIVE_STOP_CLIENT_ID_CALL_DRIFT")
    require(INCUMBENT_ROUTE in policy, "INCUMBENT_ROUTE_NOT_PRESENT")
    require(RESEARCH_ROUTE not in policy, "RESEARCH_ROUTE_NOW_PRESENT_REAUDIT_REQUIRED")
    return {
        "entry_client_id_function_called_in_tracked_live_runner": True,
        "route_stored_in_pending_but_not_client_order_id_hash": True,
        "incumbent_render_route_in_policy": True,
        "independent_research_route_absent_from_policy": True,
        "owner_route_not_in_hash_input": True,
    }


MODEL = """def modeled_id(action, symbol, signal_ts):
    import hashlib
    payload = '|'.join(('IDLE_PRIORITY_SHORT', action, symbol.upper(), str(signal_ts)))
    digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()[:22]
    return ('idle-' + action.lower() + '-' + digest)[:36]
"""


def synthetic_cases(optimize):
    ns = {}
    exec(compile(MODEL, "<pure-research-id-model>", "exec", optimize=optimize), ns)
    make = ns["modeled_id"]
    incumbent_id = make("ENTRY", SYMBOL, TS)
    independent_id = make("ENTRY", SYMBOL, TS)
    cases = {
        "same_symbol_same_signal_time_different_route_same_entry_id": incumbent_id == independent_id,
        "different_signal_time_changes_entry_id": incumbent_id != make("ENTRY", SYMBOL, TS + 300000),
        "different_symbol_changes_entry_id": incumbent_id != make("ENTRY", "DOTUSDT", TS),
        "different_action_changes_id": incumbent_id != make("EXIT", SYMBOL, TS),
        "stop_tp_actions_distinct": make("STOP", SYMBOL, TS) != make("TP", SYMBOL, TS),
        "id_within_36_character_limit": len(incumbent_id) <= 36,
        "symbol_case_is_normalized": incumbent_id == make("ENTRY", SYMBOL.lower(), TS),
    }
    require(all(cases.values()), "SYNTHETIC_ID_CASE_FAILED")
    return {"optimization": optimize, "checks": cases, "synthetic_id": incumbent_id}


def audit():
    sources = {path: fetch_pinned(path, pin) for path, pin in PINS.items()}
    anchors = source_assertions(sources)
    modes = [synthetic_cases(i) for i in (0, 1, 2)]
    require(modes[0]["checks"] == modes[1]["checks"] == modes[2]["checks"],
            "OPTIMIZATION_RESULT_DRIFT")
    return {
        "status": "RESEARCH_ONLY_ROUTE_BLIND_CLIENT_ORDER_ID_BOUNDARY",
        "source_commit": REF,
        "source_sha256": PINS,
        "source_assertions": anchors,
        "route_pair": [INCUMBENT_ROUTE, RESEARCH_ROUTE],
        "scenario": "SYNTHETIC_SAME_SYMBOL_SAME_SIGNAL_TIMESTAMP_ONLY",
        "optimization_modes": modes,
        "checks_per_process": sum(len(m["checks"]) for m in modes),
        "interpretation": "Same symbol/action/signal timestamp maps to one ID irrespective of route; this can be intentional same-symbol idempotency, not evidence of a live collision.",
        "required_integration": "Separate route/owner priority proof from symbol-time order dedup; preserve same-symbol lock and shared risk, never merely add route to the client order ID to permit parallel orders.",
        "native_owner_registered": False,
        "independent_trust_root_authenticated": False,
        "gate_proofs_authenticated": 0,
        "real_collision_observed": False,
        "native_order_authorized": False,
        "economic_backtest_performed": False,
        "live_modified": False,
    }


if __name__ == "__main__":
    report = audit()
    canonical = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    print(canonical.decode("utf-8"))
    print("CANONICAL_JSON_SHA256", hashlib.sha256(canonical).hexdigest())
