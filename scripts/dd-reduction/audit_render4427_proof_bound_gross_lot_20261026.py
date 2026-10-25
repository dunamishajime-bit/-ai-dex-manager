"""Independent research-only audit; fetch pinned primary bytes and pure adapter into memory.

No Native8 import, live runner, order, filesystem writes, or economic BT.
Run in separate Python processes with -B, -B -O, -B -OO.
"""
import copy
import hashlib
import json
import urllib.request

REPO = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/"
PRIMARY_COMMIT = "939b59da49ce7960485a2004b0068dc63417ae82"
ADAPTER_COMMIT = "3b7280e492f61c72a7ad78c299e9916185a72af0"
PINS = {
    "lib/idle-quantity-feasibility.ts": "4d87b6456f75077aabb1db2422c960d95386ae6ffbb924b878d40a8eeeef664d",
    "lib/idle-priority-short-runner.ts": "0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33",
    "lib/idle-priority-short-live.ts": "185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c",
    "config/idlePriorityShortPolicy.ts": "6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
}
ADAPTER_PATH = "scripts/dd-reduction/render4427_proof_bound_gross_lot_research_20261026.py"
ADAPTER_SHA = "13b86ba498d61a00fcdbf6bd55b7ed110f2ab2e4c1fcbd7045d6051f6e5c78d6"

def fetch(ref, path, sha):
    with urllib.request.urlopen(REPO + ref + "/" + path, timeout=25) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != sha:
        raise RuntimeError("PIN_MISMATCH:" + path)
    return data

def main():
    primary = {path: hashlib.sha256(fetch(PRIMARY_COMMIT, path, pin)).hexdigest()
               for path, pin in PINS.items()}
    source = fetch(ADAPTER_COMMIT, ADAPTER_PATH, ADAPTER_SHA)
    ns = {"__name__": "render4427_pure_research"}
    exec(compile(source, "<pinned-research-adapter>", "exec", optimize=0), ns)
    assess = ns["assess_research_allocation"]
    digest = ns["canonical_sha"]
    owner, route = ns["OWNER"], ns["ROUTE"]

    def make():
        a = dict(owner=owner, route=route, symbol="RENDERUSDT",
                 requestedGross="0.25", admissionGross="0.25",
                 reservationGross="0.25", pendingGross="0.25",
                 maxEntryNotionalUsd="2500", equityUsd="10000",
                 referencePrice="100", normalizedQuantity="25",
                 normalizedNotional="2500", quantityStep="0.01",
                 minQuantity="0.01", maxQuantity="1000", minNotional="10")
        inv = dict(snapshot_root="synthetic-snapshot-A", source_id="SYNTHETIC_NOT_OPERATOR",
                   sequence=101, asof=900000, grossAvailable="0.30",
                   sameSymbolActive=False, pendingConflict=False,
                   cooldownActive=False, killSwitchActive=False,
                   dedupConflict=False, sharedRiskHealthy=True,
                   marginGuardHealthy=True, accountLockHealthy=True)
        proofs = [dict(code="G%02d" % i, source_id="SYNTHETIC_SOURCE",
                       sequence=101, asof=900000, snapshot_root="synthetic-snapshot-A",
                       passed=True) for i in range(13)]
        return {"allocation":a, "inventory":inv, "proofs":proofs}

    cases = [
        ("quarter_gross_valid", lambda x: None, "NEED_NATIVE_ALLOCATOR", True),
        ("quarter_gross_step_floor", lambda x: x["allocation"].update(referencePrice="103", quantityStep="0.1", normalizedQuantity="24.2", normalizedNotional="2492.6"), "NEED_NATIVE_ALLOCATOR", True),
        ("admission_gross_changed", lambda x: x["allocation"].update(admissionGross="0.125"), "GROSS_BINDING_MISMATCH", True),
        ("reservation_gross_changed", lambda x: x["allocation"].update(reservationGross="0.125"), "GROSS_BINDING_MISMATCH", True),
        ("pending_gross_changed", lambda x: x["allocation"].update(pendingGross="0.125"), "GROSS_BINDING_MISMATCH", True),
        ("max_notional_changed", lambda x: x["allocation"].update(maxEntryNotionalUsd="1250"), "ENTRY_CAP_GROSS_MISMATCH", True),
        ("gross_reduced_without_reproof", lambda x: x["allocation"].update(requestedGross="0.125"), "RESEARCH_GROSS_NOT_APPROVED", True),
        ("lot_quantity_changed", lambda x: x["allocation"].update(normalizedQuantity="25.01", normalizedNotional="2501"), "QUANTITY_NOT_PROOF_BOUND_FLOOR", True),
        ("lot_notional_changed", lambda x: x["allocation"].update(normalizedNotional="2490"), "QUANTITY_NOT_PROOF_BOUND_FLOOR", True),
        ("rounding_loss_gt_one_pct", lambda x: x["allocation"].update(quantityStep="2", normalizedQuantity="24", normalizedNotional="2400"), "GROSS_ROUNDING_BOUNDS", True),
        ("venue_max_quantity", lambda x: x["allocation"].update(maxQuantity="24"), "VENUE_QUANTITY_LIMIT", True),
        ("venue_min_notional", lambda x: x["allocation"].update(minNotional="3000"), "VENUE_MIN_NOTIONAL", True),
        ("stale_inventory", lambda x: x["inventory"].update(asof=1), "INVENTORY_IDENTITY_OR_FRESHNESS", True),
        ("mixed_proof_asof", lambda x: x["proofs"][0].update(asof=800000), "GATEPROOF_SNAPSHOT_MISMATCH", True),
        ("mixed_proof_sequence", lambda x: x["proofs"][0].update(sequence=100), "GATEPROOF_SNAPSHOT_MISMATCH", True),
        ("mixed_proof_root", lambda x: x["proofs"][0].update(snapshot_root="B"), "GATEPROOF_SNAPSHOT_MISMATCH", True),
        ("proof_count_12", lambda x: x["proofs"].pop(), "GATEPROOF_COUNT", True),
        ("duplicate_proof", lambda x: x["proofs"][1].update(code="G00"), "GATEPROOF_DUPLICATE", True),
        ("missing_proof_source", lambda x: x["proofs"][0].update(source_id=""), "GATEPROOF_SNAPSHOT_MISMATCH", True),
        ("route_unregistered", lambda x: x["allocation"].update(route="IDLE_RENDER_RELATIVE_SHORT"), "OWNER_ROUTE_SYMBOL_UNREGISTERED", True),
        ("same_symbol_active", lambda x: x["inventory"].update(sameSymbolActive=True), "EXPOSURE_OR_KILL_GATE", True),
        ("pending_conflict", lambda x: x["inventory"].update(pendingConflict=True), "EXPOSURE_OR_KILL_GATE", True),
        ("cooldown_active", lambda x: x["inventory"].update(cooldownActive=True), "EXPOSURE_OR_KILL_GATE", True),
        ("kill_switch_active", lambda x: x["inventory"].update(killSwitchActive=True), "EXPOSURE_OR_KILL_GATE", True),
        ("dedup_conflict", lambda x: x["inventory"].update(dedupConflict=True), "EXPOSURE_OR_KILL_GATE", True),
        ("shared_risk_unhealthy", lambda x: x["inventory"].update(sharedRiskHealthy=False), "SHARED_GUARD_UNHEALTHY", True),
        ("margin_guard_unhealthy", lambda x: x["inventory"].update(marginGuardHealthy=False), "SHARED_GUARD_UNHEALTHY", True),
        ("account_lock_unhealthy", lambda x: x["inventory"].update(accountLockHealthy=False), "SHARED_GUARD_UNHEALTHY", True),
        ("gross_capacity_insufficient", lambda x: x["inventory"].update(grossAvailable="0.24"), "GROSS_CAPACITY_UNAVAILABLE", True),
        ("independent_pin_tampered", lambda x: x["allocation"].update(pendingGross="0.1"), "MANIFEST_BYTES_MISMATCH", False),
    ]
    results = []
    for name, mutate, expected, repin in cases:
        obj = make()
        pinned = digest(obj)
        mutate(obj)
        if repin:
            pinned = digest(obj)  # Synthetic re-pin, NOT operator authenticity.
        verdict = assess(obj["allocation"], obj["inventory"], obj["proofs"], pinned, 1000000)
        observed = verdict["status"] if verdict["status"] != "REJECT" else verdict["reason"]
        if observed != expected or verdict["order_authorized"] is not False:
            raise RuntimeError("CASE_FAILED:" + name + ":" + observed + " expected " + expected)
        results.append({"case":name, "verdict":observed, "order_authorized":False})
    record = {"source_pins":primary, "adapter_sha256":ADAPTER_SHA,
              "cases":results, "case_count":len(results),
              "status":"SYNTHETIC_RESEARCH_ONLY",
              "native8_certified":False, "order_authorized":False}
    encoded = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    print(json.dumps({"cases":len(results), "audit_sha256":hashlib.sha256(encoded).hexdigest(),
                      "adapter_sha256":ADAPTER_SHA, "source_pins":primary,
                      "status":"SYNTHETIC_RESEARCH_ONLY"},sort_keys=True))
if __name__ == "__main__":
    main()
