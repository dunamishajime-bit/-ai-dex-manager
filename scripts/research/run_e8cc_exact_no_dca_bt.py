"""Reproduce the e8cc Production economic contract on the canonical H1 sample.

This is a research-only, no-order harness.  It deliberately keeps the original
candidate/data provenance and separately binds that frozen stream to the e8cc
runtime with checked-in parity evidence.  It never relabels an old source SHA.

Primary contract:
  * 2025-08-10 through 2026-08-10
  * JPY 10,000 initial capital, no recurring contribution, compounding ON
  * 10bps primary cost; 20/30bps stress
  * current V4/TIME37/FET/Q102/PENGU sizing and asymmetric shared caps
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import math
import os
import statistics
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

TARGET_PRODUCTION_SHA = "e8cc2e73f8d3981d708ee52f013241597c038b10"
PERIOD_START_MS = 1754784000000
PERIOD_END_MS = 1786320000000
HOUR = 3_600_000
CASE = "V2_M150_D05_CORE_NATIVE"
TIME_STOP_FRACTION = 0.08

REPO = Path(__file__).resolve().parents[2]
DEFAULT_RESEARCH_ROOT = Path(os.environ.get(
    "V12_V4_RESEARCH_SOURCE_ROOT",
    r"C:\Users\dis\DisDex-five-improvements-20261008",
))
DEFAULT_MARKET_ROOT = Path(os.environ.get(
    "DISDEX_CANONICAL_MARKET_ROOT",
    r"C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted"
    r"\bt-v12-score100-volume080-normalonly-20260928"
    r"\market-Aster-H1-funding-and-manifests",
))

Q102_GROSS: dict[tuple[str, str], float] = {
    ("HIGH_VOL", "LONG"): 1.0,
    ("HIGH_VOL", "SHORT"): 0.6,
    ("REV", "LONG"): 1.5,
    ("REV", "SHORT"): 1.25,
    ("PB", "LONG"): 2.0,
    ("PB", "SHORT"): 2.5,
    ("MR", "LONG"): 0.75,
    ("MR", "SHORT"): 0.75,
    ("BRK", "LONG"): 0.75,
    ("BRK", "SHORT"): 0.75,
}

CURRENT_POLICY_PATHS = (
    "config/fetBrk48Runtime.ts",
    "config/disdexQuality102CausalV1Runtime.ts",
    "config/q102FamilySideGross.json",
    "config/penguDualLsV2Runtime.ts",
    "config/integratedProductionRiskPolicy.ts",
    "config/v12V4AdoptionRiskPolicy.ts",
    "lib/fet-brk48-signal.ts",
    "lib/v12-v4-production-lifecycle.ts",
    "lib/v12-v4-shared-reservations.ts",
    "lib/v12-v4-time-stop-approval.ts",
    "lib/v12-v4-v2-shadow.ts",
    "scripts/v12-v4-production-runner.ts",
)

PARITY_EVIDENCE_PATHS = (
    "docs/ops/v12-v4-cert-20261009/native-source-parity.json",
    "docs/ops/v12-v4-cert-20261009/native-route-exit-parity.json",
    "docs/research/results/v4-production-cert-20261009/exact-production-exit-catalog.json",
    "docs/research/results/v4-production-cert-20261009/bt-final-artifact-manifest.json",
)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def json_lines(path: Path) -> list[dict[str, Any]]:
    return [json.loads(row) for row in path.read_text(encoding="utf-8").splitlines() if row.strip()]


@dataclass(frozen=True)
class FetGate:
    accepted: bool
    reasons: tuple[str, ...]
    volume_ratio: float
    return_72h: float
    prior_48h_high: float


def load_fet_bars(path: Path) -> dict[int, dict[str, Any]]:
    rows = json_lines(path)
    out = {int(row["event_time_ms"]): row for row in rows}
    if len(out) != len(rows):
        raise RuntimeError("FET_H1_DUPLICATE_TIMESTAMP")
    return out


def evaluate_current_fet_gate(entry_ts_ms: int, bars: dict[int, dict[str, Any]]) -> FetGate:
    """Mirror config/fetBrk48Runtime.ts + lib/fet-brk48-signal.ts."""
    signal = bars.get(entry_ts_ms - HOUR)
    prior48 = [bars.get(entry_ts_ms - hours * HOUR) for hours in range(49, 1, -1)]
    prior72 = [bars.get(entry_ts_ms - hours * HOUR) for hours in range(73, 1, -1)]
    boundary = bars.get(entry_ts_ms - 73 * HOUR)
    if signal is None or boundary is None or any(row is None for row in prior48 + prior72):
        raise RuntimeError(f"FET_H1_GATE_COVERAGE_INCOMPLETE:{entry_ts_ms}")
    p48 = [row for row in prior48 if row is not None]
    p72 = [row for row in prior72 if row is not None]
    prior_high = max(float(row["high"]) for row in p48)
    median_volume = statistics.median(float(row["base_volume"]) for row in p72)
    volume_ratio = float(signal["base_volume"]) / median_volume if median_volume > 0 else 0.0
    boundary_close = float(boundary["close"])
    if boundary_close <= 0:
        raise RuntimeError(f"FET_H1_RETURN_BOUNDARY_INVALID:{entry_ts_ms}")
    ret72 = float(signal["close"]) / boundary_close - 1.0
    reasons: list[str] = []
    if not float(signal["close"]) > prior_high:
        reasons.append("BREAKOUT_NOT_CONFIRMED")
    if volume_ratio + 1e-12 < 1.2:
        reasons.append("VOLUME_BELOW_1P2")
    if volume_ratio - 10.0 > 1e-12:
        reasons.append("VOLUME_ABOVE_10")
    if ret72 + 1e-12 < 0.02:
        reasons.append("RETURN72_BELOW_2PCT")
    if ret72 - 0.15 > 1e-12:
        reasons.append("RETURN72_ABOVE_15PCT")
    return FetGate(not reasons, tuple(reasons), volume_ratio, ret72, prior_high)


def apply_time37_fixed_stop(
    candidate: dict[str, Any],
    bars: dict[int, dict[str, float]],
    route_kind: dict[str, str],
) -> tuple[dict[str, Any], bool]:
    if candidate.get("strategy_id") != "V12" or route_kind.get(str(candidate.get("route"))) != "TIME":
        return dict(candidate), False
    entry = float(candidate["entry_price"])
    start_ts = int(candidate["entry_ts_ms"])
    planned_exit = int(candidate["exit_ts_ms"])
    side = str(candidate["side"])
    direction = 1 if side == "LONG" else -1
    stop = entry * (1.0 - direction * TIME_STOP_FRACTION)
    if stop <= 0:
        raise RuntimeError("TIME37_STOP_NONPOSITIVE")
    for bar_ts in range(start_ts, planned_exit, HOUR):
        bar = bars.get(bar_ts)
        if bar is None:
            raise RuntimeError(f"TIME37_H1_GAP:{candidate['symbol']}:{bar_ts}")
        triggered = float(bar["low"]) <= stop if direction == 1 else float(bar["high"]) >= stop
        if not triggered:
            continue
        fill = min(stop, float(bar["open"])) if direction == 1 else max(stop, float(bar["open"]))
        updated = dict(candidate)
        updated.update({
            "exit_ts_ms": bar_ts + HOUR,
            "exit_price": fill,
            "exit_reason": "EMERGENCY_STOP_fixed_8pct",
            "unit_price_return": direction * (fill / entry - 1.0),
        })
        return updated, True
    return dict(candidate), False


def patch_current_admission_source(source: str) -> str:
    """Turn the V4 research allocator into the asymmetric e8cc authority model."""
    for old, new in (
        ("CRYPTO_CAP = 3.5", "CRYPTO_CAP = 3.0"),
        ("TOTAL_CAP = 4.75", "TOTAL_CAP = 4.25"),
    ):
        if source.count(old) != 1:
            raise RuntimeError(f"CURRENT_SOURCE_PATCH_ANCHOR_MISMATCH:{old}:{source.count(old)}")
        source = source.replace(old, new, 1)

    q102_hook = "                research_cap = _research_risk_cap(candidate, risk_caps)\n"
    if source.count(q102_hook) != 1:
        raise RuntimeError("CURRENT_Q102_GATE_PATCH_ANCHOR_MISMATCH")
    source = source.replace(q102_hook, q102_hook + (
        "                if strategy == \"Q102\" and str(candidate.get(\"family\") or \"\").upper() == \"BRK\":\n"
        "                    record_decision(candidate, \"REJECTED_RESEARCH_POLICY\", \"Q102:BRK_DISABLED_CURRENT_RUNTIME\", ts)\n"
        "                    rejected[\"Q102:BRK_DISABLED_CURRENT_RUNTIME\"] += 1\n"
        "                    continue\n"
        "                if strategy == \"V12\" and v4_max_drawdown > 0.21 + 1e-12:\n"
        "                    record_decision(candidate, \"REJECTED_PORTFOLIO\", \"V12:DD21_OPERATOR_LIMIT\", ts)\n"
        "                    rejected[\"V12:DD21_OPERATOR_LIMIT\"] += 1\n"
        "                    continue\n"
    ), 1)

    state_hook = "    candidate_i = deposit_i = 0\n"
    if source.count(state_hook) != 1:
        raise RuntimeError("CURRENT_DD21_STATE_PATCH_ANCHOR_MISMATCH")
    source = source.replace(state_hook, state_hook + (
        "    v4_risk_times = list(range(PERIOD_START_MS, PERIOD_END_MS, HOUR))\n"
        "    v4_risk_i = 0\n"
        "    v4_equity_peak = 0.0\n"
        "    v4_max_drawdown = 0.0\n"
    ), 1)
    loop_hook = (
        "        next_scheduled = scheduled[0][0] if scheduled else math.inf\n"
        "        ts = min(next_candidate, next_deposit, next_scheduled)\n"
    )
    if source.count(loop_hook) != 1:
        raise RuntimeError("CURRENT_DD21_LOOP_PATCH_ANCHOR_MISMATCH")
    source = source.replace(loop_hook, (
        "        next_scheduled = scheduled[0][0] if scheduled else math.inf\n"
        "        next_v4_risk = v4_risk_times[v4_risk_i] if v4_risk_i < len(v4_risk_times) else math.inf\n"
        "        ts = min(next_candidate, next_deposit, next_scheduled, next_v4_risk)\n"
    ), 1)
    candidate_hook = "        if candidate_i < len(candidate_times) and candidate_times[candidate_i] == ts:\n"
    if source.count(candidate_hook) != 1:
        raise RuntimeError("CURRENT_DD21_CANDIDATE_PATCH_ANCHOR_MISMATCH")
    source = source.replace(candidate_hook, (
        "        while v4_risk_i < len(v4_risk_times) and v4_risk_times[v4_risk_i] == ts:\n"
        "            v4_risk_equity = _equity(wallet, active, market, ts)\n"
        "            if v4_risk_equity > 0:\n"
        "                v4_equity_peak = max(v4_equity_peak, v4_risk_equity)\n"
        "                v4_max_drawdown = max(v4_max_drawdown, 1.0 - v4_risk_equity / v4_equity_peak)\n"
        "            v4_risk_i += 1\n\n"
        + candidate_hook
    ), 1)

    room_hook = "                requested = min(float(candidate[\"requested_gross\"]), research_cap)\n"
    if source.count(room_hook) != 1:
        raise RuntimeError("CURRENT_ASYMMETRIC_CAP_PATCH_ANCHOR_MISMATCH")
    source = source.replace(room_hook, (
        "                candidate_crypto_cap = 3.5 if strategy == \"V12\" else CRYPTO_CAP\n"
        "                candidate_total_cap = 4.75 if strategy == \"V12\" else TOTAL_CAP\n"
        + room_hook
    ), 1)
    crypto_count = source.count("CRYPTO_CAP - crypto_gross")
    total_count = source.count("TOTAL_CAP - total_gross")
    if crypto_count < 2 or total_count < 2:
        raise RuntimeError(f"CURRENT_ROOM_PATCH_ANCHOR_MISMATCH:{crypto_count}:{total_count}")
    source = source.replace("CRYPTO_CAP - crypto_gross", "candidate_crypto_cap - crypto_gross")
    source = source.replace("TOTAL_CAP - total_gross", "candidate_total_cap - total_gross")
    return source


def _git_bytes_at_target(path: str, target_sha: str) -> bytes:
    result = subprocess.run(
        ["git", "show", f"{target_sha}:{path}"], cwd=REPO, check=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return result.stdout


def _load_stack(research_root: Path) -> dict[str, Any]:
    scripts = research_root / "scripts" / "research"
    if not scripts.is_dir():
        raise RuntimeError(f"V4_RESEARCH_SOURCE_ROOT_MISSING:{scripts}")
    sys.path.insert(0, str(scripts))
    with contextlib.redirect_stdout(io.StringIO()):
        import run_v12_v4_priority_gross_v2_sweep as sweep  # type: ignore
        import run_v12_multilogic_v4_final1000 as final  # type: ignore
        import run_v12_multilogic_v4_minlift as mlift  # type: ignore
        import run_v12_multilogic_v4_stacking as v4  # type: ignore
        import run_v12_multilogic_v3 as v3  # type: ignore
        import run_v12_independent_sleeves as independent  # type: ignore
        import run_v12_multilogic_recovery as recovery  # type: ignore
    return {
        "sweep": sweep, "final": final, "mlift": mlift, "v4": v4,
        "v3": v3, "independent": independent, "recovery": recovery,
        "s": sweep.s, "base_patch": sweep.s.w.base.patch_admission,
    }


def _current_filter(
    base_filter: Callable[[list[dict[str, Any]], str], list[dict[str, Any]]],
    fet_bars: dict[int, dict[str, Any]],
    route_kind: dict[str, str],
    strategy_bars: dict[str, dict[int, dict[str, float]]],
    audit: dict[str, Any],
) -> Callable[[list[dict[str, Any]], str], list[dict[str, Any]]]:
    def wrapped(candidates: list[dict[str, Any]], case: str) -> list[dict[str, Any]]:
        selected = base_filter(candidates, case)
        output: list[dict[str, Any]] = []
        for source in selected:
            row = dict(source)
            strategy = str(row.get("strategy_id"))
            if strategy == "PENGU":
                row["requested_gross"] = 1.0
                audit["pengu_fixed_gross_rows"] += 1
            elif strategy == "Q102":
                key = (str(row.get("family") or "").upper(), str(row.get("side") or "").upper())
                if key not in Q102_GROSS:
                    raise RuntimeError(f"Q102_FAMILY_SIDE_GROSS_UNRESOLVED:{key}")
                row["requested_gross"] = Q102_GROSS[key]
                audit["q102_family_side_rows"]["|".join(key)] = audit["q102_family_side_rows"].get("|".join(key), 0) + 1
            elif strategy == "FET":
                gate = evaluate_current_fet_gate(int(row["entry_ts_ms"]), fet_bars)
                row["requested_gross"] = 1.0
                row["fet_current_gate"] = asdict(gate)
                if gate.accepted:
                    row["status"] = "MODELED_CLOSED_TRADE"
                    row.pop("exclusion_reason", None)
                    audit["fet_gate_accepted"] += 1
                else:
                    row["status"] = "FET_RESEARCH_GATE_BLOCKED"
                    row["exclusion_reason"] = "FET_CURRENT_VOL10_RET15:" + ",".join(gate.reasons)
                    audit["fet_gate_rejected"] += 1
            if strategy == "V12":
                bars = strategy_bars.get(str(row.get("symbol")))
                if bars is None:
                    raise RuntimeError(f"V12_TIME_BAR_SOURCE_MISSING:{row.get('symbol')}")
                row, changed = apply_time37_fixed_stop(row, bars, route_kind)
                if changed:
                    audit["time37_fixed8_stops"] += 1
                    route = str(row.get("route"))
                    audit["time37_routes"][route] = audit["time37_routes"].get(route, 0) + 1
            output.append(row)
        return output
    return wrapped


def _hash_tree(root: Path, patterns: Iterable[str] = ("*",)) -> list[dict[str, Any]]:
    files: set[Path] = set()
    for pattern in patterns:
        files.update(path for path in root.rglob(pattern) if path.is_file())
    return [
        {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size, "sha256": sha256_file(path)}
        for path in sorted(files)
    ]


def _monthly_rows(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    previous = float(metrics["initial_jpy"])
    rows = []
    for month, value in metrics["monthly_equity_jpy"].items():
        equity = float(value)
        rows.append({
            "month": month,
            "contribution_jpy": 0.0,
            "ending_equity_jpy": equity,
            "monthly_return_pct": (equity / previous - 1.0) * 100.0,
        })
        previous = equity
    return rows


def _canonical_hashes(root: Path) -> dict[str, dict[str, Any]]:
    files = []
    for pattern in ("**/crypto-price-model-candidates.jsonl", "**/portfolio-trades.jsonl",
                    "**/candidate-decisions.jsonl", "**/portfolio-events.jsonl",
                    "**/metrics.json", "current-contract-summary.json", "monthly-results.json"):
        files.extend(path for path in root.glob(pattern) if path.is_file())
    unique = sorted(set(files))
    return {path.relative_to(root).as_posix(): {"bytes": path.stat().st_size, "sha256": sha256_file(path)} for path in unique}


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.target_sha != TARGET_PRODUCTION_SHA:
        raise RuntimeError(f"TARGET_SHA_NOT_APPROVED:{args.target_sha}")
    research_root = Path(args.research_root).resolve()
    market_root = Path(args.market_root).resolve()
    output_root = Path(args.output_root).resolve()
    if output_root.exists() and any(output_root.iterdir()):
        raise RuntimeError(f"OUTPUT_ROOT_NOT_EMPTY:{output_root}")
    output_root.mkdir(parents=True, exist_ok=True)
    if not market_root.is_dir():
        raise RuntimeError(f"CANONICAL_MARKET_ROOT_MISSING:{market_root}")

    stack = _load_stack(research_root)
    s = stack["s"]
    sweep = stack["sweep"]
    final = stack["final"]
    v4 = stack["v4"]
    v3 = stack["v3"]
    independent = stack["independent"]
    recovery = stack["recovery"]
    mlift = stack["mlift"]

    s.w.OUT = output_root
    s.w.setup()
    v4.install_virtual_leg_study_adapter()
    final.install_final_routes()
    v3.stage3_transform = final.stage3_candidate_all
    v3.FAILED = recovery.failed_candidates()
    v3.v2.FAILED = v3.FAILED
    s.w.base.source_batch = independent.custom_source_batch
    s.w.base.read_table = v3.v2.read_table
    independent.ORIG_PATCH = stack["base_patch"]
    v3.CASE[CASE] = {"family_cap": 2.5, "gross": 0.10, "slots": 16}
    independent.ACTIVE_RECOVERY_CAP = 2.5
    mlift.MAX_LIFT_GROSS = 0.30

    def admission_patch(source: str, strict: Any) -> str:
        return patch_current_admission_source(sweep.patch(source, strict))

    s.w.base.patch_admission = admission_patch

    catalog = json.loads((REPO / "docs/research/results/v4-production-cert-20261009/exact-production-exit-catalog.json").read_text(encoding="utf-8"))
    route_kind = {str(row["route"]): str(row["spec"]["kind"]) for row in catalog}
    fet_bars = load_fet_bars(market_root / "normalized/aster/klines/FETUSDT.jsonl")
    strategy_bars = s.w.bars
    audit: dict[str, Any] = {
        "pengu_fixed_gross_rows": 0, "q102_family_side_rows": {},
        "fet_gate_accepted": 0, "fet_gate_rejected": 0,
        "time37_fixed8_stops": 0, "time37_routes": {},
    }
    base_filter = sweep.make_filter(CASE, sweep.CASES[CASE])
    s.w.base._study_filter = _current_filter(base_filter, fet_bars, route_kind, strategy_bars, audit)

    result = s.w.base.run_study(CASE, "10,20,30")
    case_root = output_root / "cases" / CASE
    run_root = case_root / "runs"
    scenario_reports = []
    monthly = {}
    for cost in (10, 20, 30):
        scenario_id = f"PRICE_MODEL_{cost}BPS"
        scenario_root = run_root / scenario_id
        metrics = json.loads((scenario_root / "metrics.json").read_text(encoding="utf-8"))
        trades = json_lines(scenario_root / "portfolio-trades.jsonl")
        decisions = json_lines(scenario_root / "candidate-decisions.jsonl")
        events = json_lines(scenario_root / "portfolio-events.jsonl")
        contributions = [row for row in events if row.get("event_type") == "MONTHLY_CONTRIBUTION"]
        if metrics.get("accounting_reconciliation", {}).get("status") != "PASS":
            raise RuntimeError(f"ACCOUNTING_RECONCILIATION_FAILED:{scenario_id}")
        if len(contributions) != 1 or not math.isclose(float(contributions[0].get("contribution_jpy", 0)), 10_000.0):
            raise RuntimeError(f"NO_DCA_CONTRIBUTION_CONTRACT_FAILED:{scenario_id}")
        if float(metrics.get("monthly_jpy", -1)) != 0 or float(metrics.get("contributed_jpy", -1)) != 10_000:
            raise RuntimeError(f"NO_DCA_METRICS_CONTRACT_FAILED:{scenario_id}")
        q102_brk_trades = [row for row in trades if row.get("strategy_id") == "Q102" and str(row.get("family") or "").upper() == "BRK"]
        if q102_brk_trades:
            raise RuntimeError(f"Q102_BRK_CURRENT_RUNTIME_VIOLATION:{scenario_id}:{len(q102_brk_trades)}")
        brk_rejections = [row for row in decisions if row.get("reason") == "Q102:BRK_DISABLED_CURRENT_RUNTIME"]
        if not brk_rejections:
            raise RuntimeError(f"Q102_BRK_DISABLE_NOT_EXERCISED:{scenario_id}")
        report = {
            "scenario_id": scenario_id,
            "round_trip_cost_bps": cost,
            "final_equity_jpy": metrics["final_equity_jpy"],
            "net_profit_jpy": metrics["net_profit_jpy"],
            "total_return_pct": (float(metrics["final_equity_jpy"]) / 10_000.0 - 1.0) * 100.0,
            "profit_factor": metrics["profit_factor"],
            "win_rate_pct": float(metrics["win_rate"]) * 100.0,
            "maximum_mtm_drawdown_pct": float(metrics["maximum_mtm_drawdown"]) * 100.0,
            "closed_trades": metrics["closed_trades"],
            "strategy_trades": metrics["strategy_trades"],
            "strategy_pnl_jpy": metrics["strategy_pnl_jpy"],
            "candidate_decision_counts": metrics["candidate_decision_counts"],
            "q102_brk_accepted": 0,
            "q102_brk_rejected": len(brk_rejections),
            "accounting_reconciliation": metrics["accounting_reconciliation"],
            "deposit_event_count": len(contributions),
            "contributed_jpy": metrics["contributed_jpy"],
            "historical_fill_verified": False,
        }
        scenario_reports.append(report)
        monthly[scenario_id] = _monthly_rows(metrics)

    summary = {
        "schema": "disdex/e8cc-current-contract-h1-no-dca-bt/v1",
        "status": "COMPLETE_CURRENT_SHA_POLICY_CERTIFIED_H1_CAUSAL_PRICE_MODEL_NOT_L2_VERIFIED",
        "target_production_sha": args.target_sha,
        "period": {"start_ms": PERIOD_START_MS, "end_ms": PERIOD_END_MS},
        "capital": {"initial_jpy": 10_000.0, "monthly_contribution_jpy": 0.0, "compounding": True},
        "primary_scenario": "PRICE_MODEL_10BPS",
        "stress_scenarios": ["PRICE_MODEL_20BPS", "PRICE_MODEL_30BPS"],
        "contract": {
            "v12_policy": CASE, "v12_gross": 3.0, "v12_recovery_gross": 2.5,
            "v12_crypto_entry_cap": 3.5, "v12_total_entry_cap": 4.75,
            "peer_crypto_entry_cap": 3.0, "peer_total_entry_cap": 4.25,
            "required_leverage": 5, "margin_type": "cross",
            "pengu_policy": "COMBINED_FILTERED_Q60_DD17_H72", "pengu_entry_gross": 1.0,
            "q102_brk_enabled": False, "fet_policy": "BRK48_VOL10_RET15", "fet_gross": 1.0,
            "time37_emergency_stop_fraction": TIME_STOP_FRACTION,
            "v12_maximum_drawdown_entry_limit": 0.21,
        },
        "candidate_policy_audit": audit,
        "scenarios": scenario_reports,
        "limitations": [
            "H1 causal price model; not historical L2 fill reconstruction.",
            "Historical venue minQty/minNotional/read-back latency and partial/unknown execution are not modeled.",
            "Candidate/data origin SHAs are preserved and bound to e8cc by parity evidence; they are not relabeled as e8cc.",
        ],
        "mutation": {"orders_sent": 0, "cancels_sent": 0, "position_changes_sent": 0},
    }
    (output_root / "current-contract-summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    (output_root / "monthly-results.json").write_text(json.dumps(monthly, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")

    origin_candidate = case_root / "candidates" / "crypto-price-model-candidates.jsonl"
    origin_shas = sorted({str(row.get("source_runtime_sha")) for row in json_lines(origin_candidate) if row.get("source_runtime_sha")})
    current_sources = []
    for path in CURRENT_POLICY_PATHS:
        payload = _git_bytes_at_target(path, args.target_sha)
        current_sources.append({"path": path, "bytes": len(payload), "sha256": sha256_bytes(payload)})
    parity = []
    for path in PARITY_EVIDENCE_PATHS:
        payload = _git_bytes_at_target(path, args.target_sha)
        parity.append({"path": path, "bytes": len(payload), "sha256": sha256_bytes(payload)})
    market_files = _hash_tree(market_root / "normalized/aster", ("*.jsonl", "*.json"))
    v52_root = market_root.parents[1] / "v52-SHA-verified-original-ledger"
    if not v52_root.is_dir():
        # The frozen study locates V52 next to the market archive, not inside it.
        v52_root = Path(r"C:\tmp\bt-v12-score100-volume080-normalonly-20260928\extracted\bt-v12-score100-volume080-normalonly-20260928\v52-SHA-verified-original-ledger")
    provenance = {
        "schema": "disdex/e8cc-current-contract-bt-provenance/v1",
        "target_production_sha": args.target_sha,
        "candidate_origin_runtime_shas": origin_shas,
        "candidate_ledger": {"path": origin_candidate.relative_to(output_root).as_posix(), "bytes": origin_candidate.stat().st_size, "sha256": sha256_file(origin_candidate)},
        "current_policy_sources_at_target_sha": current_sources,
        "parity_evidence_at_target_sha": parity,
        "research_source_root": str(research_root),
        "research_python_sources": _hash_tree(research_root / "scripts/research", ("*.py",)),
        "market_root": str(market_root),
        "market_files": market_files,
        "v52_ledger_root": str(v52_root),
        "v52_files": _hash_tree(v52_root) if v52_root.is_dir() else [],
        "source_binding": "ORIGIN_PRESERVED_PLUS_CURRENT_SHA_PARITY_EVIDENCE",
    }
    (output_root / "provenance-manifest.json").write_text(json.dumps(provenance, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    hashes = _canonical_hashes(output_root)
    (output_root / "canonical-hashes.json").write_text(json.dumps(hashes, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-sha", default=TARGET_PRODUCTION_SHA)
    parser.add_argument("--research-root", default=str(DEFAULT_RESEARCH_ROOT))
    parser.add_argument("--market-root", default=str(DEFAULT_MARKET_ROOT))
    parser.add_argument("--output-root", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    completed = run(parse_args())
    primary = next(row for row in completed["scenarios"] if row["scenario_id"] == completed["primary_scenario"])
    print("E8CC_CURRENT_SHA_NO_DCA_BT_PASS", json.dumps(primary, sort_keys=True, ensure_ascii=False), flush=True)
