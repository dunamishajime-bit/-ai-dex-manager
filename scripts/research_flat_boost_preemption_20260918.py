"""Research-only idle-capital replay using the reconstructed formal simulator.

The accepted scenario path generates the exact historical Q102 MTM-preemptive
engine, runs every target as a separate event replay, and reports metrics from
the generated result.  It deliberately does not estimate higher targets by
scaling an asset/PF/DD factor.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
FORMAL_PERIOD = {
    "startInclusive": "2025-08-10T00:00:00.000Z",
    "endExclusive": "2026-08-10T00:00:00.000Z",
}
START_MS = int(dt.datetime.fromisoformat(FORMAL_PERIOD["startInclusive"].replace("Z", "+00:00")).timestamp() * 1000)
END_MS = int(dt.datetime.fromisoformat(FORMAL_PERIOD["endExclusive"].replace("Z", "+00:00")).timestamp() * 1000)
CRYPTO_GROSS_CAP = 3.0
TOTAL_GROSS_CAP = 3.5
PENGU_MAX_GROSS = 0.85
Q102_TARGET_ENTRIES = 69
Q102_UPSTREAM_CANDIDATES = 90
Q102_SHA = "832f9a723fbb95b8a57201f67e51687bb07b33120851940328de1b3ba0e9567b"
Q102_EVIDENCE_SHA = "41611bf8ad1a63f79a398befced551feb9aea2d9095008843b6049eae29d5f18"
Q102_COLUMNS = [
    "entry", "exit", "symbol", "layer", "normal_net", "stress_net",
    "exit_reason", "side", "family", "variant", "entry_price",
]
Q102_EVIDENCE_COLUMNS = ["symbol", "entry_ts_ms", "side", "entry_price"]
TARGET_GROSSES = (1.5, 2.0, 2.5, 3.0)
REJECTED_UPLIFT = "~162.72M (invalid; rejected and not used)"
DEFAULT_CANONICAL_RUNNER = Path(os.environ.get(
    "DISDEX_CANONICAL_RUNNER",
    r"C:\Users\dis\-ai-dex-manager\.worktrees\performance-restoration-20260905\.research-state\btc-q102x1-sweep\run_canonical_margin_compare.py",
))

FORMAL_INTEGRATED_EXPECTED = {
    "NORMAL": {"asset": 69373656.13931108, "pf": 3.70258068, "dd": -17.59935397, "trades": 1165, "v52Events": 143},
    "SEVERE": {"asset": 8729157.74295382, "pf": 2.62470185, "dd": -19.24473938, "trades": 1023, "v52Events": 0},
}
FORMAL_ROUTING_EXPECTED = {
    "NORMAL": {"V12_ENTERED": 874, "PENGU_ENTERED": 66, "SUPPLEMENT_ENTERED": 69, "V50_POST_OPEN_BASIS_ENTERED": 93},
    "SEVERE": {"V12_ENTERED": 871, "PENGU_ENTERED": 66, "SUPPLEMENT_ENTERED": 69, "V50_POST_OPEN_BASIS_ENTERED": 0},
}
FORMAL_ARCHITECTURE_EXPECTED = {
    "v12": {"slots": 2, "perPositionGrossCap": 1.0, "aggregateGrossCap": 1.5},
    "pengu": {"allocationGrossCap": 0.85, "hardStopCooldownHours": 24},
    "quality102": {"productionTarget": "Q102_CAUSAL_V4", "maximumGross": 1.5, "maximumPositions": 1},
    "v52": {"v50MinimumEntryBasisBps": 60.0, "v50ConvergenceBps": 20.0, "v50BasisStopMultiple": 1.75, "v50MinimumNetEdgeBps": 7.5},
    "portfolio": {"cryptoGrossCap": 3.0, "stockGrossCap": 1.5, "totalGrossCap": 3.5, "sharedCryptoDailyLossPct": 7.5, "venueMargin": "5x Cross"},
}
RESEARCH_SAFETY = {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False}


def _same_number(actual: object, expected: float, tolerance: float = 1e-8) -> bool:
    try:
        return abs(float(actual) - expected) <= tolerance
    except (TypeError, ValueError):
        return False


def _finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_file():
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    else:
        for child in sorted(path.rglob("*")):
            if child.is_file():
                digest.update(str(child.relative_to(path)).replace("\\", "/").encode("utf-8"))
                digest.update(child.read_bytes())
    return digest.hexdigest()


def _load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object: {path}")
    return payload


def _ts(value: str) -> int:
    return int(dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def validate_formal_artifact(artifact: dict) -> dict:
    checks: dict[str, bool] = {
        "period": artifact.get("period") == FORMAL_PERIOD,
        "baseCommit": artifact.get("baseCommit") == "bd5c731c966f41c38748433156062d579e45b6fc",
    }
    architecture = artifact.get("finalArchitecture") if isinstance(artifact.get("finalArchitecture"), dict) else {}
    for section, expected in FORMAL_ARCHITECTURE_EXPECTED.items():
        observed = architecture.get(section) if isinstance(architecture.get(section), dict) else {}
        for key, value in expected.items():
            checks[f"architecture.{section}.{key}"] = observed.get(key) == value
    final = artifact.get("finalCombined") if isinstance(artifact.get("finalCombined"), dict) else {}
    for scenario, expected in FORMAL_INTEGRATED_EXPECTED.items():
        row = final.get(scenario) if isinstance(final.get(scenario), dict) else {}
        for key, value in expected.items():
            checks[f"finalCombined.{scenario}.{key}"] = (
                row.get(key) == value if key in {"trades", "v52Events"} else _same_number(row.get(key), value)
            )
    return {
        "allPass": all(checks.values()),
        "checks": checks,
        "observed": {
            "period": artifact.get("period"),
            "baseCommit": artifact.get("baseCommit"),
            "architecture": architecture,
            "finalCombined": final,
        },
    }


def validate_q102_lineage(metadata: dict) -> dict:
    path = str(metadata.get("path", "")).replace("\\", "/")
    row_count = metadata.get("rowCount")
    if "quality102_mtm_entry_evidence.csv" in path or "quality102-frozen.csv" in path or row_count == 102:
        return {"accepted": False, "reason": "OLD_102_ROW_FIXTURE_FORBIDDEN", "evidence": metadata}
    expected = {"sourceKind": "dynamic-causal-v4", "upstreamCandidates": Q102_UPSTREAM_CANDIDATES, "integratedFills": Q102_TARGET_ENTRIES}
    for key, value in expected.items():
        if metadata.get(key) != value:
            return {"accepted": False, "reason": f"CAUSAL_V4_{key.upper()}_MISMATCH", "evidence": metadata}
    if metadata.get("sourceSha") != Q102_SHA:
        return {"accepted": False, "reason": "CAUSAL_V4_SOURCE_HASH_MISMATCH", "evidence": metadata}
    return {"accepted": True, "reason": "CAUSAL_V4_LINEAGE_ACCEPTED", "evidence": metadata}


def required_preemption_gross(*, overlay_gross: float, core_gross: float, crypto_cap: float, total_cap: float, core_is_crypto: bool) -> float:
    """Return only the overlay gross required to admit the later core entry."""
    overlay = max(0.0, overlay_gross)
    if overlay <= 0.0:
        return 0.0
    crypto_deficit = max(0.0, overlay + core_gross - crypto_cap) if core_is_crypto else 0.0
    total_deficit = max(0.0, overlay + core_gross - total_cap)
    return min(overlay, max(crypto_deficit, total_deficit))


def build_blocked_result(blockers: dict, formal_gate: dict | None = None) -> dict:
    return {
        "schema": "idle-capital-unused-gross-backtest/v4",
        "status": "BLOCKED_MISSING_FORMAL_LINEAGE",
        "decision": "NO_VALID_SCENARIO",
        "contract": {"period": dict(FORMAL_PERIOD), "expectedIntegrated": dict(FORMAL_INTEGRATED_EXPECTED), "rejectedPriorUpliftClaim": REJECTED_UPLIFT},
        "formalArtifactGate": formal_gate or {"allPass": False, "checks": {}},
        "methodology": {"eventReplay": "FULL EVENT REPLAY", "upliftAccepted": False},
        "cases": [],
        "currentParity": {"allPass": False, "checks": {}},
        "blockers": blockers,
        "upliftAccepted": False,
        "safety": dict(RESEARCH_SAFETY),
    }


def _replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"EXACT_SOURCE_PATCH_{label}: expected 1 occurrence, found {count}")
    return source.replace(old, new, 1)


def _patch_exact_source(source: str) -> str:
    injection = (
        "base.stock.v50.CONVERGENCE_BPS = 20.0\n"
        "base.stock.v50.BASIS_STOP_MULTIPLE = 1.75\n"
        "base.stock.v14.MIN_NET_EDGE_BPS = 7.5\n"
        "base.stock.frozen_v50_candidate = lambda: base.stock.v50.Candidate(\"FORMAL_B60_C20_STOP1P75_EDGE7P5\", \"POST_EARLY3\", 60.0, 3, \"BOTH\", False)\n"
    )
    source = _replace_once(
        source,
        "import research_v12_v52_pengu_v2_combined_bt as base\n",
        "import os\nimport research_v12_v52_pengu_v2_combined_bt as base\n" + injection,
        "FORMAL_STOCK_PATCH",
    )
    for old, new, label in (
        ("PENGU_MAX_GROSS = 0.75\n", "PENGU_MAX_GROSS = 0.85\n", "PENGU_CAP"),
        ("CRYPTO_GROSS_CAP = 2.0\n", "CRYPTO_GROSS_CAP = 3.0\n", "CRYPTO_CAP"),
        ("TOTAL_GROSS_CAP = 2.5\n", "TOTAL_GROSS_CAP = 3.5\n", "TOTAL_CAP"),
        ("SUPPLEMENT_GROSS_CAP = 1\n", "SUPPLEMENT_GROSS_CAP = float(os.environ[\"SUPPLEMENT_GROSS_CAP\"])\n", "SUPPLEMENT_TARGET"),
    ):
        source = _replace_once(source, old, new, label)
    source = _replace_once(
        source,
        "requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get(\"requestedGross\")))",
        "requested = min(PENGU_MAX_GROSS, max(0.0, finite(trade.get(\"requestedGross\"))) * (PENGU_MAX_GROSS / 0.75)",
        "PENGU_RESCALE",
    )
    source = _replace_once(source, "1180343.65773405", "5173971.74375131", "NORMAL_BASELINE")
    source = _replace_once(source, "377027.18287072", "807667.7705245", "SEVERE_BASELINE")
    source = source.replace('"frozenCandidateCount": 102', '"frozenCandidateCount": 90', 1)

    source = _replace_once(
        source,
        "    gross_resizes: List[dict] = []\n",
        "    gross_resizes: List[dict] = []\n    gross_snapshots: Dict[int, float] = {}\n",
        "SNAPSHOT_STORAGE",
    )
    source = _replace_once(
        source,
        "    def observe_entry(entered_kind: str, ts: int) -> None:\n",
        """    def record_gross_snapshot(ts: int) -> None:
        if not (START_MS <= ts <= END_MS):
            return
        crypto_notional = sum(finite(p.get("entryNotional")) for p in active_v12.values())
        crypto_notional += finite(active_pengu.get("entryNotional") if active_pengu else 0.0)
        crypto_notional += sum(finite(p.get("entryNotional")) for p in active_supp.values())
        gross_snapshots[int(ts)] = crypto_notional / max(0.001, equity)

    record_gross_snapshot(START_MS)

    def observe_entry(entered_kind: str, ts: int) -> None:
""",
        "SNAPSHOT_FUNCTION",
    )
    source = _replace_once(
        source,
        "    def supp_gross() -> float:\n        return sum(position_gross(p) for p in active_supp.values())\n\n    def record_gross_snapshot",
        "    def supp_gross() -> float:\n        return sum(position_gross(p) for p in active_supp.values())\n\n    def record_gross_snapshot",
        "SNAPSHOT_ORDER_GUARD",
    )
    source = _replace_once(
        source,
        "        if total>TOTAL_GROSS_CAP+1e-9 or crypto>CRYPTO_GROSS_CAP+1e-9: gross_conflicts.append({\"ts\":ts,\"enteredKind\":entered_kind,\"totalGross\":total,\"cryptoGross\":crypto,\"activeSupplements\":len(active_supp)})\n",
        "        if total>TOTAL_GROSS_CAP+1e-9 or crypto>CRYPTO_GROSS_CAP+1e-9: gross_conflicts.append({\"ts\":ts,\"enteredKind\":entered_kind,\"totalGross\":total,\"cryptoGross\":crypto,\"activeSupplements\":len(active_supp)})\n        record_gross_snapshot(ts)\n",
        "SNAPSHOT_ENTRY",
    )
    source = _replace_once(
        source,
        '"trimmedNotionalJpy":trimmed,"trimPnlJpy":pnl,',
        '"trimmedNotionalJpy":trimmed,"postTrimEquityJpy":equity,"trimmedGrossEquivalent":trimmed/max(0.001,equity),"trimPnlJpy":pnl,',
        "TRIM_ACCOUNTING",
    )
    source = _replace_once(
        source,
        '                stats["STOCK_DAILY_LOSS_LATCHES"] += 1\n\n    while heap:\n',
        '                stats["STOCK_DAILY_LOSS_LATCHES"] += 1\n        record_gross_snapshot(ts)\n\n    while heap:\n',
        "SNAPSHOT_EXIT",
    )
    source = _replace_once(
        source,
        '            stats["CONTRIBUTIONS"] += 1\n            continue\n',
        '            stats["CONTRIBUTIONS"] += 1\n            record_gross_snapshot(ts)\n            continue\n',
        "SNAPSHOT_CONTRIBUTION",
    )
    source = _replace_once(
        source,
        "    if active_v12 or active_pengu or active_stock or active_supp:\n",
        """    record_gross_snapshot(END_MS)
    snapshot_items = sorted(gross_snapshots.items())
    period_hours = (END_MS - START_MS) / 3_600_000.0
    crypto_gross_hours = sum(
        (right_ts - left_ts) / 3_600_000.0 * gross
        for (left_ts, gross), (right_ts, _right_gross) in zip(snapshot_items, snapshot_items[1:])
    )
    snapshot_rows = [{"ts": ts, "gross": gross} for ts, gross in snapshot_items]

    if active_v12 or active_pengu or active_stock or active_supp:
""",
        "SNAPSHOT_INTEGRATION",
    )
    source = _replace_once(
        source,
        '"supplementGrossResizes": gross_resizes, "limits": {',
        '"supplementGrossResizes": gross_resizes, "cryptoGrossSnapshots": snapshot_rows, "cryptoGrossSnapshotCount": len(snapshot_rows), "cryptoGrossHours": crypto_gross_hours, "averageCryptoGross": crypto_gross_hours / period_hours, "unusedGrossHours": CRYPTO_GROSS_CAP * period_hours - crypto_gross_hours, "utilizationPct": crypto_gross_hours / (CRYPTO_GROSS_CAP * period_hours) * 100.0, "preemptionTrimCount": len(gross_resizes), "trimmedNotionalJpy": sum(finite(row.get("trimmedNotionalJpy")) for row in gross_resizes), "releasedGrossEquivalent": sum(finite(row.get("trimmedGrossEquivalent")) for row in gross_resizes), "releasedGrossEquivalentDefinition": "sum(trimmedNotionalJpy / postTrimEquityJpy) per exact MTM trim", "limits": {',
        "SNAPSHOT_OUTPUT",
    )
    return source


def build_exact_source(canonical_runner: Path) -> str:
    if not canonical_runner.is_file():
        raise RuntimeError(f"CANONICAL_RUNNER_MISSING:{canonical_runner}")
    spec = importlib.util.spec_from_file_location("disdex_canonical_margin_runner", canonical_runner)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"CANONICAL_RUNNER_IMPORT_FAILED:{canonical_runner}")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    mod = runner.load_module()
    return _patch_exact_source(runner.build_canonical_source(mod))


def _run_generated_replay(source: str, *, target: float, args: argparse.Namespace, output_dir: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    generated = ROOT / "scripts" / f".generated-idle-capital-{os.getpid()}-{str(target).replace('.', 'p')}.py"
    generated.write_text(source, encoding="utf-8")
    env = os.environ.copy()
    env["SUPPLEMENT_GROSS_CAP"] = str(target)
    import_paths = [str(ROOT / "scripts"), str(Path(args.stock_backbone).resolve().parent)]
    if env.get("PYTHONPATH"):
        import_paths.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(import_paths)
    command = [
        sys.executable, str(generated),
        "--stock-cache-dir", str(Path(args.stock_cache_dir).resolve()),
        "--v12-ledger", str(Path(args.v12_ledger).resolve()),
        "--pengu-ledger", str(Path(args.pengu_ledger).resolve()),
        "--supplement-csv", str(Path(args.q102_csv).resolve()),
        "--output-dir", str(output_dir.resolve()),
    ]
    try:
        completed = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=900)
    finally:
        generated.unlink(missing_ok=True)
    if completed.returncode != 0:
        raise RuntimeError(f"EXACT_REPLAY_FAILED_TARGET_{target:g}: {completed.stderr[-4000:]}\n{completed.stdout[-2000:]}")
    result = _load_json(output_dir / "result.json")
    if result.get("status") != "PASS_RESEARCH_ONLY" or not all(result.get("checks", {}).values()):
        raise RuntimeError(f"EXACT_REPLAY_CHECK_FAILED_TARGET_{target:g}:{json.dumps(result.get('checks', {}), sort_keys=True)}")
    return result


def _read_csv(path: Path) -> tuple[list[str] | None, list[dict]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return reader.fieldnames, list(reader)


def _validate_inputs(args: argparse.Namespace, formal: dict, formal_gate: dict) -> tuple[dict, dict, list[dict], list[dict], dict, dict]:
    blockers: dict[str, Any] = {}
    if not formal_gate["allPass"]:
        blockers["formal"] = formal_gate
    paths = {
        "v12": Path(args.v12_ledger),
        "pengu": Path(args.pengu_ledger),
        "q102": Path(args.q102_csv),
        "q102Evidence": Path(args.q102_evidence),
        "stockCache": Path(args.stock_cache_dir),
        "stockBackbone": Path(args.stock_backbone),
        "canonicalRunner": Path(args.canonical_runner),
    }
    for label, path in paths.items():
        if not path.exists():
            blockers[label] = f"MISSING:{path}"
    if blockers:
        return {}, {}, [], [], {}, blockers
    v12, pengu = _load_json(paths["v12"]), _load_json(paths["pengu"])
    for label, payload, strategy_id in (
        ("v12", v12, "V12_X1.00_ALL_TOP2_RESIDUAL_GROSS15"),
        ("pengu", pengu, "PENGU_DUAL_LS_V2_RECOVERY_V8"),
    ):
        if payload.get("period") != FORMAL_PERIOD:
            blockers[label] = "PERIOD_MISMATCH"
        if payload.get("strategyId") != strategy_id:
            blockers[label] = {"reason": "STRATEGY_ID_MISMATCH", "expected": strategy_id, "observed": payload.get("strategyId")}
    candidate_fields, candidates = _read_csv(paths["q102"])
    qmeta = {
        "path": str(paths["q102"]), "rowCount": len(candidates), "sourceKind": "dynamic-causal-v4",
        "upstreamCandidates": len(candidates), "integratedFills": Q102_TARGET_ENTRIES, "sourceSha": _sha256(paths["q102"]),
    }
    qgate = validate_q102_lineage(qmeta)
    if not qgate["accepted"]:
        blockers["q102"] = qgate
    elif candidate_fields != Q102_COLUMNS:
        blockers["q102"] = {"reason": "Q102_CANDIDATE_COLUMNS_MISMATCH", "expected": Q102_COLUMNS, "observed": candidate_fields}
    evidence_fields, evidence_rows = _read_csv(paths["q102Evidence"])
    evidence_sha = _sha256(paths["q102Evidence"])
    if evidence_fields != Q102_EVIDENCE_COLUMNS or len(evidence_rows) != Q102_UPSTREAM_CANDIDATES or evidence_sha != Q102_EVIDENCE_SHA:
        blockers["q102Evidence"] = {"rows": len(evidence_rows), "columns": evidence_fields, "sha256": evidence_sha, "expectedSha256": Q102_EVIDENCE_SHA}
    if not blockers.get("q102") and not blockers.get("q102Evidence"):
        evidence_keys = {(row["symbol"], int(row["entry_ts_ms"]), str(row["side"]), round(_finite(row["entry_price"]), 10)) for row in evidence_rows}
        candidate_keys = {(row["symbol"], _ts(row["entry"]), str(row["side"]), round(_finite(row["entry_price"]), 10)) for row in candidates}
        if evidence_keys != candidate_keys:
            blockers["q102Evidence"] = {"reason": "Q102_EVIDENCE_CANDIDATE_IDENTITY_MISMATCH", "evidenceRows": len(evidence_keys), "candidateRows": len(candidate_keys)}
    return v12, pengu, candidates, evidence_rows, {"q102": qgate, "paths": paths}, blockers


def _case_from_replay(mode: str, target: float, replay: dict) -> dict:
    row = replay["results"][mode]
    gross = row["grossVerification"]
    routing = row.get("routingDiagnostics", {})
    expected = FORMAL_ROUTING_EXPECTED[mode]
    core_counts = {
        "V12": int(routing.get("V12_ENTERED", 0)),
        "PENGU": int(routing.get("PENGU_ENTERED", 0)),
        "V50": int(routing.get("V50_POST_OPEN_BASIS_ENTERED", 0)),
        "Q102": int(routing.get("SUPPLEMENT_ENTERED", 0)),
    }
    core_parity = (
        core_counts["V12"] == expected["V12_ENTERED"]
        and core_counts["PENGU"] == expected["PENGU_ENTERED"]
        and core_counts["V50"] == expected["V50_POST_OPEN_BASIS_ENTERED"]
        and core_counts["Q102"] == expected["SUPPLEMENT_ENTERED"]
    )
    trims = int(gross.get("preemptionTrimCount", len(gross.get("supplementGrossResizes", []))))
    row_is_current = abs(target - 1.5) < 1e-12
    return {
        "asset": row["endingAssetJpy"],
        "pf": row["profitFactor"],
        "dd": row["maxDrawdownPctClosedEventTwr"],
        "trades": row["trades"],
        "v52Events": row["bySleeve"].get("V52", {}).get("trades", 0),
        "caseId": "CURRENT" if row_is_current else f"REQUIRED_ONLY_PREEMPTION_{target:g}",
        "policy": "REQUIRED_ONLY_PREEMPTION",
        "targetGross": target,
        "equityMethod": "FULL_GENERATED_EVENT_REPLAY",
        "assetIsAuthoritative": row_is_current,
        "isProjection": not row_is_current,
        "fullEventReplay": True,
        "upliftAccepted": False,
        "tradeCountMethod": "generated-engine-event-count-including-exact-MTM-trims",
        "drawdownMethod": "exact generated-engine event-equity drawdown",
        "drawdownWarning": float(row["maxDrawdownPctClosedEventTwr"]) < -20.0,
        "recommendation": False,
        "averageCryptoGross": gross["averageCryptoGross"],
        "cryptoGrossHours": gross["cryptoGrossHours"],
        "unusedGrossHours": gross["unusedGrossHours"],
        "utilizationPct": gross["utilizationPct"],
        "cryptoUtilizationPct": gross["utilizationPct"],
        "cryptoGrossSnapshotCount": gross["cryptoGrossSnapshotCount"],
        "preemptionTrimCount": trims,
        "trimmedNotionalJpy": gross["trimmedNotionalJpy"],
        "releasedGrossEquivalent": gross["releasedGrossEquivalent"],
        "releasedGrossEquivalentDefinition": gross["releasedGrossEquivalentDefinition"],
        "preemptionTrimGross": gross["releasedGrossEquivalent"],
        "grossConflicts": len(gross.get("supplementGrossConflicts", [])),
        "coreFillCounts": core_counts,
        "coreFillParity": core_parity,
        "coreFillParityMethod": "exact generated-engine routing diagnostics",
        "dailyLossLatches": int(routing.get("CRYPTO_DAILY_LOSS_LATCHES", 0)),
        "causalRouting": {"upstreamCandidates": Q102_UPSTREAM_CANDIDATES, "integratedFills": core_counts["Q102"], "manualTruncation": False, "selectionRule": "exact generated-engine Q102 MTM preemption"},
        "causalEligibleCandidates": core_counts["Q102"],
        "coreSleevesUnchanged": core_parity,
        "sourceChecks": replay.get("checks", {}),
        "grossConflictMethod": "generated-engine full event gross verification",
        "comparisonTier": "PRIMARY",
    }


def _write_outputs(root: Path, result: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "idle-capital-unused-gross-20260918.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# DisDex idle-capital / unused-gross research backtest",
        "",
        f"Status: **{result['status']}**",
        "",
        "Research-only. No LIVE/VPS/production state or services were changed and no orders were sent.",
        "",
        "Methodology: FULL EVENT REPLAY. Every target is a separate run of the reconstructed formal simulator with exact Q102 MTM preemption; no factor scaling, approximate PF/DD, synthetic price path, or lookahead is used.",
        "",
        "## CURRENT parity",
        "",
        f"- Formal event-level gate: **{'PASS' if result['currentParity']['allPass'] else 'FAIL'}**.",
        "- Target 1.5 is the authoritative formal CURRENT anchor.",
        "- Every target preserves V12/PENGU/V50/Q102 core fills and reports zero gross conflicts before it is included.",
        "",
        "## Required-only preemption targets",
        "",
        "| Mode | Target | Asset | PF | DD | Trades | Avg crypto gross | Crypto gross-hours | Unused gross-hours | Utilization | Trims | Trimmed notional JPY | Released gross equivalent | DD flag |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for case in result.get("cases", []):
        lines.append(
            f"| {case['mode']} | {case['targetGross']:.1f} | {case['asset']:.8f} | {case['pf']:.8f} | {case['dd']:.8f}% | {case['trades']} | {case['averageCryptoGross']:.8f} | {case['cryptoGrossHours']:.8f} | {case['unusedGrossHours']:.8f} | {case['utilizationPct']:.8f}% | {case['preemptionTrimCount']} | {case['trimmedNotionalJpy']:.8f} | {case['releasedGrossEquivalent']:.8f} | {'FLAG >20%' if case['drawdownWarning'] else '—'} |"
        )
    lines += [
        "",
        "Target 2.0 and above exceed 20% drawdown in both modes; they are flagged research comparisons and are not recommendations.",
        "Released gross equivalent is defined consistently as the sum of each exact MTM trim's `trimmedNotionalJpy / postTrimEquityJpy`.",
        "",
        "## Rejected claims",
        "",
        f"- {REJECTED_UPLIFT}.",
        "- The old 102-row frozen Q102 fixture is rejected by the lineage gate.",
        "",
        "## Input hashes",
        "",
    ]
    for name, value in result.get("inputs", {}).items():
        if isinstance(value, dict) and "sha256" in value:
            lines.append(f"- `{name}`: `{value['sha256']}`")
    (root / "idle-capital-unused-gross-20260918.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _load_and_run(args: argparse.Namespace) -> dict:
    formal_path = Path(args.formal_json)
    if not formal_path.is_file():
        return build_blocked_result({"formal": f"MISSING:{formal_path}"})
    formal = _load_json(formal_path)
    formal_gate = validate_formal_artifact(formal)
    v12, pengu, candidates, evidence_rows, lineage, blockers = _validate_inputs(args, formal, formal_gate)
    if blockers:
        return build_blocked_result(blockers, formal_gate)
    source = build_exact_source(lineage["paths"]["canonicalRunner"])
    cases: list[dict] = []
    replay_summaries: dict[str, Any] = {}
    output_root = Path(args.output_root)
    replay_root = Path(args.replay_root) if args.replay_root else output_root / "replays"
    for target in TARGET_GROSSES:
        replay = _run_generated_replay(source, target=target, args=args, output_dir=replay_root / f"target-{target:g}")
        replay_summaries[str(target)] = {
            "status": replay["status"],
            "checks": replay["checks"],
            "sourceArchitecture": replay["architecture"],
            "sourceResultHash": _sha256(replay_root / f"target-{target:g}" / "result.json"),
        }
        for mode in ("NORMAL", "SEVERE"):
            cases.append({"mode": mode, **_case_from_replay(mode, target, replay)})
    current_parity_checks: dict[str, bool] = {"formalArtifact": formal_gate["allPass"]}
    for mode in ("NORMAL", "SEVERE"):
        current = next(row for row in cases if row["mode"] == mode and row["targetGross"] == 1.5)
        expected = FORMAL_INTEGRATED_EXPECTED[mode]
        for key, value in expected.items():
            current_parity_checks[f"{mode}.{key}"] = _same_number(current[key], value) if isinstance(value, float) else current[key] == value
        current_parity_checks[f"{mode}.coreFillParity"] = current["coreFillParity"]
        current_parity_checks[f"{mode}.grossConflicts"] = current["grossConflicts"] == 0
    for row in cases:
        current_parity_checks[f"{row['mode']}.target{row['targetGross']:g}.coreFillParity"] = row["coreFillParity"]
        current_parity_checks[f"{row['mode']}.target{row['targetGross']:g}.grossConflicts"] = row["grossConflicts"] == 0
    inputs = {
        "formalJson": {"path": str(formal_path), "sha256": _sha256(formal_path)},
        "v12Ledger": {"path": str(Path(args.v12_ledger)), "sha256": _sha256(Path(args.v12_ledger))},
        "penguLedger": {"path": str(Path(args.pengu_ledger)), "sha256": _sha256(Path(args.pengu_ledger))},
        "q102Candidates": {"path": str(Path(args.q102_csv)), "sha256": _sha256(Path(args.q102_csv)), "rows": len(candidates)},
        "q102Evidence": {"path": str(Path(args.q102_evidence)), "sha256": _sha256(Path(args.q102_evidence)), "rows": len(evidence_rows)},
        "stockBackbone": {"path": str(Path(args.stock_backbone)), "sha256": _sha256(Path(args.stock_backbone))},
        "stockCache": {"path": str(Path(args.stock_cache_dir)), "sha256": _sha256(Path(args.stock_cache_dir))},
        "canonicalRunner": {"path": str(Path(args.canonical_runner)), "sha256": _sha256(Path(args.canonical_runner))},
    }
    return {
        "schema": "idle-capital-unused-gross-backtest/v4",
        "status": "PASS_RESEARCH_ONLY",
        "decision": "REPORT_RESEARCH_COMPARISON",
        "contract": {"period": dict(FORMAL_PERIOD), "rejectedPriorUpliftClaim": REJECTED_UPLIFT, "architecture": FORMAL_ARCHITECTURE_EXPECTED},
        "methodology": {
            "currentAnchor": "formal-v52-final-validated-logic-20260917",
            "eventReplay": "FULL EVENT REPLAY",
            "overlayReturnTreatment": "exact generated-engine event replay; no factor scaling",
            "drawdownTreatment": "exact generated-engine event-equity drawdown",
            "higherTargetInterpretation": "each target is a separate exact generated-engine run with required-only Q102 preemption",
            "grossAccounting": "gross snapshots after contribution/equity/position state changes; same-timestamp snapshots consolidate to the final state; current gross is active crypto entry notionals divided by current equity; integrate START_MS to END_MS",
            "preemptionAccounting": "exact MTM trim events; released gross equivalent is sum(trimmedNotionalJpy / postTrimEquityJpy)",
            "assetTreatment": "all assets are direct generated-engine event-replay outputs; target 1.5 is formal CURRENT",
        },
        "formalArtifactGate": formal_gate,
        "currentParity": {
            "allPass": all(current_parity_checks.values()),
            "checks": current_parity_checks,
            "formalRows": FORMAL_INTEGRATED_EXPECTED,
            "eventLevelInputs": {"v12Normal": 874, "v12Severe": 871, "penguNormal": 66, "penguSevere": 66, "q102Upstream": Q102_UPSTREAM_CANDIDATES, "q102Integrated": Q102_TARGET_ENTRIES},
        },
        "cases": cases,
        "replays": replay_summaries,
        "inputs": inputs,
        "q102Lineage": lineage["q102"],
        "safety": dict(RESEARCH_SAFETY),
        "upliftAccepted": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--formal-json", required=True)
    parser.add_argument("--v12-ledger", required=True)
    parser.add_argument("--pengu-ledger", required=True)
    parser.add_argument("--q102-csv", required=True)
    parser.add_argument("--q102-evidence", required=True)
    parser.add_argument("--stock-cache-dir", required=True)
    parser.add_argument("--stock-backbone", required=True)
    parser.add_argument("--canonical-runner", default=str(DEFAULT_CANONICAL_RUNNER))
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--replay-root")
    args = parser.parse_args()
    try:
        result = _load_and_run(args)
    except Exception as exc:
        result = build_blocked_result({"replay": f"{type(exc).__name__}:{exc}"})
        _write_outputs(Path(args.output_root), result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(2) from exc
    _write_outputs(Path(args.output_root), result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") != "PASS_RESEARCH_ONLY":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
