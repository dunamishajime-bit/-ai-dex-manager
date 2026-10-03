"""Paired attribution for legacy diagnostic vs post-fee 5x-reserve-corrected 20 cases.

The report separates:
- direct Overlay modeled PnL (IDLE + RESIDUAL),
- signed Core strategy PnL change relative to CORE,
- residual path/compounding/FX effect needed to reconcile final-equity increment,
- execution-cost sensitivity,
- incremental effect of the post-fee margin guard.

All values remain H1 price-model diagnostics, not historical LIVE fills.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

CORE_STRATEGIES = {"V12", "PENGU", "Q102", "FET", "V52"}
OVERLAY_STRATEGIES = {"IDLE", "RESIDUAL"}


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def index(report: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    rows = {}
    for row in report["scenarios"]:
        key = (str(row["configuration"]), str(row["scenario_id"]))
        if key in rows:
            raise RuntimeError(f"DUPLICATE_SCENARIO:{key}")
        rows[key] = row
    if len(rows) != 20:
        raise RuntimeError(f"EXPECTED_20_SCENARIOS:{len(rows)}")
    return rows


def strategy_pnl(row: dict[str, Any], names: set[str]) -> float:
    pnl = row.get("strategy_pnl_jpy") or {}
    return sum(float(pnl.get(name, 0.0)) for name in names)


def write_json(path: Path, payload: Any) -> str:
    raw = (json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def paired_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    rows = index(report)
    output = []
    for (config, scenario), row in sorted(rows.items()):
        core = rows[("CORE", scenario)]
        final_delta = float(row["final_equity_jpy"]) - float(core["final_equity_jpy"])
        overlay_direct = strategy_pnl(row, OVERLAY_STRATEGIES)
        core_pnl_change = strategy_pnl(row, CORE_STRATEGIES) - strategy_pnl(core, CORE_STRATEGIES)
        residual = final_delta - overlay_direct - core_pnl_change
        output.append({
            "configuration": config,
            "scenario_id": scenario,
            "final_equity_jpy": float(row["final_equity_jpy"]),
            "closed_trades": int(row["closed_trades"]),
            "final_equity_increment_vs_core_jpy": final_delta,
            "overlay_direct_pnl_jpy": overlay_direct,
            "core_strategy_pnl_change_vs_core_jpy": core_pnl_change,
            "lost_core_pnl_jpy": max(0.0, -core_pnl_change),
            "gained_core_pnl_jpy": max(0.0, core_pnl_change),
            "path_compounding_fx_residual_jpy": residual,
            "strategy_pnl_jpy": row.get("strategy_pnl_jpy") or {},
            "strategy_trades": row.get("strategy_trades") or {},
        })
    return output


def cost_sensitivity(report: dict[str, Any]) -> list[dict[str, Any]]:
    rows = index(report)
    output = []
    for config in sorted({key[0] for key in rows}):
        base = rows[(config, "PRICE_MODEL_8BPS")]
        for scenario in ("PRICE_MODEL_10BPS", "PRICE_MODEL_20BPS", "PRICE_MODEL_30BPS"):
            row = rows[(config, scenario)]
            output.append({
                "configuration": config,
                "scenario_id": scenario,
                "reference_scenario_id": "PRICE_MODEL_8BPS",
                "final_equity_cost_effect_vs_8bps_jpy": float(row["final_equity_jpy"]) - float(base["final_equity_jpy"]),
                "closed_trade_change_vs_8bps": int(row["closed_trades"]) - int(base["closed_trades"]),
            })
    return output


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--legacy-manifest", type=Path, required=True)
    p.add_argument("--guarded-manifest", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args(argv)

    legacy = load(args.legacy_manifest.resolve())
    guarded = load(args.guarded_manifest.resolve())
    if legacy.get("postfee_margin_guard") not in (None, False):
        raise RuntimeError("LEGACY_REPORT_ALREADY_GUARDED")
    if guarded.get("postfee_margin_guard") is not True:
        raise RuntimeError("GUARDED_REPORT_FLAG_MISSING")
    old = index(legacy)
    new = index(guarded)

    guard_effect = []
    for key in sorted(old):
        before, after = old[key], new[key]
        guard_effect.append({
            "configuration": key[0],
            "scenario_id": key[1],
            "legacy_final_equity_jpy": float(before["final_equity_jpy"]),
            "guarded_final_equity_jpy": float(after["final_equity_jpy"]),
            "margin_guard_final_equity_delta_jpy": float(after["final_equity_jpy"]) - float(before["final_equity_jpy"]),
            "legacy_closed_trades": int(before["closed_trades"]),
            "guarded_closed_trades": int(after["closed_trades"]),
            "closed_trade_delta": int(after["closed_trades"]) - int(before["closed_trades"]),
            "strategy_pnl_delta_jpy": {
                name: float((after.get("strategy_pnl_jpy") or {}).get(name, 0.0))
                    - float((before.get("strategy_pnl_jpy") or {}).get(name, 0.0))
                for name in sorted(set((before.get("strategy_pnl_jpy") or {})) | set((after.get("strategy_pnl_jpy") or {})))
            },
        })

    payload = {
        "schema_version": 1,
        "status": "PAIRED_DIAGNOSTIC_NOT_LIVE_CERTIFICATION",
        "legacy_status": legacy.get("status"),
        "guarded_status": guarded.get("status"),
        "guarded_attribution": paired_rows(guarded),
        "guarded_cost_sensitivity_vs_8bps": cost_sensitivity(guarded),
        "postfee_margin_guard_effect": guard_effect,
        "definitions": {
            "overlay_direct_pnl_jpy": "IDLE + RESIDUAL modeled strategy PnL in the same scenario.",
            "core_strategy_pnl_change_vs_core_jpy": "signed change in V12/PENGU/Q102/FET/V52 modeled strategy PnL versus CORE at the same cost.",
            "path_compounding_fx_residual_jpy": "final-equity increment minus Overlay direct PnL minus signed Core PnL change; captures path sizing/compounding/FX translation residual rather than a standalone trade PnL.",
            "cost_effect_vs_8bps": "same configuration final-equity difference from its 8bps case.",
            "margin_guard_effect": "guarded minus legacy diagnostic with all other model inputs held fixed.",
        },
        "ruling": (
            "Attribution is paired on the same candidate/source tapes. It does not convert modeled H1 "
            "fills into historical LIVE execution evidence and does not fill missing account/filter/partial-fill history."
        ),
    }
    digest = write_json(args.output.resolve(), payload)
    print(json.dumps({
        "status": payload["status"],
        "rows": len(payload["guarded_attribution"]),
        "guard_effect_rows": len(guard_effect),
        "manifest_sha256": digest,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
