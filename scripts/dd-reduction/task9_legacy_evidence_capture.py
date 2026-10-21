"""Read-only research instrumentation of frozen full8 allocator decision events.

No insertion of synthetic orders, exits, prices or market marks. All extra
columns are observed at the native allocator's record_decision call.
"""
from __future__ import annotations

import hashlib

VERSION = "task9-canonical-source-evidence-v1"


def instrument(source: str) -> str:
    needle = "        candidate_decisions.append({\n"
    if source.count(needle) != 1:
        raise RuntimeError(f"DECISION_CAPTURE_ANCHOR_DRIFT:{source.count(needle)}")
    # Keep the source receipt at the actual portfolio decision timestamp.
    # Rejected quantity is a *hypothetical requested size*, not a modeled fill.
    # The source-priced quantity uses the contemporaneous portfolio equity,
    # not future realized PnL. The acceptance truth remains in decision status.
    code = '''        _task9_price = candidate.get("entry_price")
        _task9_requested_gross = candidate.get("requested_gross")
        _task9_requested_quantity = None
        if (status != "EXCLUDED_PREALLOCATION"
                and isinstance(_task9_price, (int, float)) and _task9_price > 0
                and isinstance(_task9_requested_gross, (int, float))
                and _task9_requested_gross > 0):
            _task9_requested_quantity = (
                _equity(wallet, active, market, ts)
                * _task9_requested_gross / _task9_price
            )
        _task9_qty = details.get("modeled_entry_quantity", _task9_requested_quantity)
        _task9_gross = details.get("accepted_gross", _task9_requested_gross)
        _task9_status = (
            "ACCEPTED" if status == "ACCEPTED_MODELED_ENTRY"
            else "NOT_APPLICABLE" if status == "EXCLUDED_PREALLOCATION"
            else "REJECTED"
        )
        candidate_decisions.append({
            "event_seq": len(candidate_decisions) + 1,
            "priority": PRIORITY.get(candidate["strategy_id"]),
            "entry_valid_until_ms": (
                int(candidate["entry_ts_ms"]) + HOUR
                if status != "EXCLUDED_PREALLOCATION" and candidate.get("entry_ts_ms") is not None
                else None
            ),
            "worst_case_gross": _task9_requested_gross,
            "entry_price": _task9_price,
            "asset_class": "NON_CRYPTO" if candidate["strategy_id"] == "V52" else "CRYPTO",
            "quantity": _task9_qty,
            "requested_quantity_modeled_not_filled": _task9_requested_quantity,
            "quantity_actual_fill": status == "ACCEPTED_MODELED_ENTRY",
            "quantity_provenance": (
                "MODEL_ACCEPTED_DECISION_AT_T" if status == "ACCEPTED_MODELED_ENTRY"
                else "CAUSAL_HYPOTHETICAL_REJECTED_AT_T"
            ),
            "validity": (
                "VALID" if candidate.get("status") == "MODELED_CLOSED_TRADE"
                else "UNKNOWN"
            ),
            "candidate_status": _task9_status,
            "source_frozen_model": True,
            "source_venue_signed": False,
'''
    source = source.replace(needle, code, 1)
    # Install a proposed STOP cooldown only when a previously admitted V12
    # position actually exits with the configured 5m modeled STOP. A rejected
    # proposal cannot start a cooldown, and PENGU is never changed.
    # This is a modeled H1 accounting lifecycle, NOT exchange fill proof.
    anchors = [
        ("    v12_last_stop_ts_by_symbol: dict[str, int] = defaultdict(int)\n",
         "    v12_last_stop_ts_by_symbol: dict[str, int] = defaultdict(int)\n"
         "    task9_stop_cooldown_by_symbol_side: dict[tuple[str, str], int] = defaultdict(int)\n"),
        ("            v12_cooldown_by_symbol[(str(position.get(\"route\") or \"CORE\"),symbol)] = ts + hours * HOUR\n",
         "            v12_cooldown_by_symbol[(str(position.get(\"route\") or \"CORE\"),symbol)] = ts + hours * HOUR\n"
         "            if str(reason).startswith(\"RESEARCH_INITIAL_ADVERSE_STOP_V12_SHORT_PCT2P5_12H_MFE1P0_R12\"):\n"
         "                k = (position[\"symbol\"], position[\"side\"])\n"
         "                task9_stop_cooldown_by_symbol_side[k] = max(\n"
         "                    task9_stop_cooldown_by_symbol_side[k], ts + 12 * HOUR\n"
         "                )\n"
         "                events.append({\n"
         "                    \"event_type\": \"TASK9_MODELED_STOP_COOLDOWN\",\n"
         "                    \"ts_ms\": ts, \"candidate_id\": position.get(\"candidate_id\"),\n"
         "                    \"strategy_id\": \"V12\", \"symbol\": position[\"symbol\"],\n"
         "                    \"side\": position[\"side\"],\n"
         "                    \"until_ts_ms\": task9_stop_cooldown_by_symbol_side[k],\n"
         "                    \"source_venue_signed\": False,\n"
         "                })\n"),
        ("                if strategy == \"V12\" and ts < v12_cooldown_by_symbol[(str(candidate.get(\"route\") or \"CORE\"),candidate[\"symbol\"])]:\n",
         "                if strategy == \"V12\" and ts < task9_stop_cooldown_by_symbol_side[(candidate[\"symbol\"], candidate[\"side\"])]:\n"
         "                    record_decision(candidate, \"REJECTED_PORTFOLIO\", \"V12:TASK9_ADVERSE_SIDE_COOLDOWN\", ts)\n"
         "                    rejected[\"V12:TASK9_ADVERSE_SIDE_COOLDOWN\"] += 1\n"
         "                    continue\n"
         "                if strategy == \"V12\" and ts < v12_cooldown_by_symbol[(str(candidate.get(\"route\") or \"CORE\"),candidate[\"symbol\"])]:\n"),
    ]
    for before, after in anchors:
        if source.count(before) != 1:
            vicinity = [l[:160] for l in source.splitlines() if (
                "v12_cooldown" in l or "V12_STOP" in l or "SYMBOL_COOLDOWN" in l
                or "def finalize_position" in l)]
            raise RuntimeError(
                f"TASK9_STOP_COOLDOWN_ANCHOR_DRIFT:{source.count(before)}:"
                f"{before[:65]}:actual={vicinity[:18]}"
            )
        source = source.replace(before, after, 1)
    # The original frozen core already builds an exact 8761-point H1 MTM
    # timeline from accepted quantities, fees, funding and the market.
    # Export that timeline in the same allocator pass, without recalculation.
    mtm_hooks = [
        ("    curve = []\n",
         "    curve = []\n    task9_mtm_trace = []\n"),
        ("        curve.append((ts, equity))\n",
         "        curve.append((ts, equity))\n"
         "        task9_mtm_trace.append({\n"
         "            \"timestamp_ms\": ts, \"wallet_jpy\": cash * rate_at(ts),\n"
         "            \"unrealized_pnl_jpy\": unrealized * rate_at(ts),\n"
         "            \"equity_jpy\": equity, \"peak_equity_jpy\": peak,\n"
         "            \"drawdown_pct\": 100.0 * dd,\n"
         "            \"open_position_count\": len(open_curve),\n"
         "        })\n"),
        ("        trade_rows = result.pop(\"trade_rows\")\n",
         "        task9_mtm_rows = result.pop(\"task9_mtm_trace\")\n"
         "        trade_rows = result.pop(\"trade_rows\")\n"),
        ("        (scenario_dir / \"portfolio-trades.jsonl\").write_text(\n",
         "        (scenario_dir / \"task9-mtm.jsonl\").write_text(\n"
         "            \"\".join(json.dumps(row, sort_keys=True, allow_nan=False) + \"\\n\" for row in task9_mtm_rows),\n"
         "            encoding=\"utf-8\")\n"
         "        (scenario_dir / \"portfolio-trades.jsonl\").write_text(\n"),
    ]
    for before, after in mtm_hooks:
        if source.count(before) != 1:
            raise RuntimeError(f"TASK9_MTM_CAPTURE_ANCHOR_DRIFT:{source.count(before)}:{before[:70]}")
        source = source.replace(before, after, 1)
    # Return the raw rows only through a private key, popped by the writer.
    # The public metrics.json and economic calculations remain identical.
    marker = '        "scenario_id": scenario_id,'
    if source.count(marker) != 1:
        raise RuntimeError("TASK9_MTM_RESULT_ANCHOR_DRIFT")
    source = source.replace(marker, marker + '\n        "task9_mtm_trace": task9_mtm_trace,', 1)
    return source


def install_legacy_capture(helper) -> None:
    # run_one installs sweep.patch immediately before compiling the original
    # allocator; wrapping that function adds only forensic columns.
    sweep = helper.base.sweep
    old_patch = sweep.patch
    if getattr(old_patch, "_task9_capture", False):
        return

    def evidence_patch(source, strict):
        original = old_patch(source, strict)
        return instrument(original)

    evidence_patch._task9_capture = True
    sweep.patch = evidence_patch
