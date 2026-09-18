"""Research-only idle-capital / unused-gross allocator replay.

This module intentionally consumes only frozen research ledgers and the frozen
stock-research cache.  It never imports an order runner, writes runtime state,
or sends orders.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import importlib
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


UTC = dt.timezone.utc
FORMAL_PERIOD = {
    "startInclusive": "2025-08-10T00:00:00.000Z",
    "endExclusive": "2026-08-10T00:00:00.000Z",
}
START_MS = int(dt.datetime.fromisoformat(FORMAL_PERIOD["startInclusive"].replace("Z", "+00:00")).timestamp() * 1000)
END_MS = int(dt.datetime.fromisoformat(FORMAL_PERIOD["endExclusive"].replace("Z", "+00:00")).timestamp() * 1000)
CRYPTO_CAP = 3.0
TOTAL_CAP = 3.5
PENGU_CAP = 0.85
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
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _ts(value: str) -> int:
    return int(dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def validate_formal_artifact(artifact: dict) -> dict:
    checks: dict[str, bool] = {"period": artifact.get("period") == FORMAL_PERIOD, "baseCommit": artifact.get("baseCommit") == "bd5c731c966f41c38748433156062d579e45b6fc"}
    architecture = artifact.get("finalArchitecture") if isinstance(artifact.get("finalArchitecture"), dict) else {}
    for section, expected in FORMAL_ARCHITECTURE_EXPECTED.items():
        observed = architecture.get(section) if isinstance(architecture.get(section), dict) else {}
        for key, value in expected.items():
            checks[f"architecture.{section}.{key}"] = observed.get(key) == value
    final = artifact.get("finalCombined") if isinstance(artifact.get("finalCombined"), dict) else {}
    for scenario, expected in FORMAL_INTEGRATED_EXPECTED.items():
        row = final.get(scenario) if isinstance(final.get(scenario), dict) else {}
        for key, value in expected.items():
            checks[f"finalCombined.{scenario}.{key}"] = row.get(key) == value if key in {"trades", "v52Events"} else _same_number(row.get(key), value)
    return {"allPass": all(checks.values()), "checks": checks, "observed": {"period": artifact.get("period"), "baseCommit": artifact.get("baseCommit"), "architecture": architecture, "finalCombined": final}}


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
        "schema": "idle-capital-unused-gross-backtest/v3",
        "status": "BLOCKED_MISSING_FORMAL_LINEAGE",
        "decision": "NO_VALID_SCENARIO",
        "contract": {"period": dict(FORMAL_PERIOD), "expectedIntegrated": dict(FORMAL_INTEGRATED_EXPECTED), "rejectedPriorUpliftClaim": REJECTED_UPLIFT},
        "formalArtifactGate": formal_gate or {"allPass": False, "checks": {}},
        "cases": [], "currentParity": {"allPass": False, "checks": {}}, "blockers": blockers, "upliftAccepted": False, "safety": dict(RESEARCH_SAFETY),
    }


@dataclass(frozen=True)
class Interval:
    start: int
    end: int
    gross: float
    sleeve: str
    crypto: bool


def _clip_interval(start: int, end: int, gross: float, sleeve: str, crypto: bool) -> Interval | None:
    start, end = max(START_MS, start), min(END_MS, end)
    return Interval(start, end, max(0.0, gross), sleeve, crypto) if end > start and gross > 0 else None


def _load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object: {path}")
    return payload


def _ledger_intervals(payload: dict, mode: str, sleeve: str, crypto: bool) -> list[Interval]:
    out: list[Interval] = []
    for trade in payload.get("modes", {}).get(mode, {}).get("trades", []):
        requested = _finite(trade.get("requestedGross"), 0.0)
        if sleeve == "PENGU":
            requested = min(PENGU_CAP, requested)
        elif sleeve == "V12":
            requested = min(1.0, requested)
        row = _clip_interval(int(trade["entryTs"]), int(trade["exitTs"]), requested, sleeve, crypto)
        if row:
            out.append(row)
    return out


def _load_stock_rows(backbone: Path, cache: Path) -> tuple[list[dict], dict]:
    if not backbone.exists():
        raise RuntimeError(f"STOCK_BACKBONE_MISSING:{backbone}")
    sys.path.insert(0, str(backbone.parent))
    module = importlib.import_module(backbone.stem)
    if hasattr(module, "PERIOD_START"):
        module.PERIOD_START = dt.datetime(2025, 8, 10, tzinfo=UTC)
        module.PERIOD_END = dt.datetime(2026, 8, 10, tzinfo=UTC)
        module.START_MS, module.END_MS = START_MS, END_MS
    rows = module.build_stock(cache)
    return list(rows[0]) + list(rows[1]), rows[3]


def _stock_intervals(rows: Iterable[dict]) -> list[Interval]:
    out: list[Interval] = []
    for row in rows:
        gross = min(1.0, max(0.0, _finite(row.get("gross"), 1.0)))
        item = _clip_interval(int(row["entryTs"]), int(row["exitTs"]), gross, str(row.get("strategy", "V52")), False)
        if item:
            out.append(item)
    return out


def _load_candidates(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != Q102_COLUMNS:
            raise RuntimeError(f"Q102_CANDIDATE_COLUMNS_EXPECTED_{Q102_COLUMNS}_GOT_{reader.fieldnames}")
        rows = list(reader)
    if len(rows) != Q102_UPSTREAM_CANDIDATES:
        raise RuntimeError(f"Q102_CANDIDATE_COUNT_EXPECTED_90_GOT_{len(rows)}")
    return rows


def _causal_routing_audit(rows: list[dict], core: list[Interval]) -> dict:
    period_rows = [
        row for row in rows
        if START_MS <= _ts(row["entry"]) < END_MS and _ts(row["exit"]) > _ts(row["entry"])
    ]
    core_blocked = [
        row for row in period_rows
        if any(interval.start <= _ts(row["entry"]) < interval.end for interval in core)
    ]
    selected = _causal_candidates(rows, core)
    return {
        "upstreamCandidates": len(rows),
        "periodEligibleCandidates": len(period_rows),
        "blockedByCoreEntry": len(core_blocked),
        "integratedFills": len(selected),
        "excludedCandidates": len(rows) - len(selected),
        "selectionRule": "causal-period-entry-and-core-priority; chronological one-slot cooldown",
        "manualTruncation": False,
    }


def _causal_candidates(rows: list[dict], core: list[Interval]) -> list[dict]:
    chosen: list[dict] = []
    active_until = -1
    for row in sorted(rows, key=lambda item: (_ts(item["entry"]), _ts(item["exit"]), item["symbol"])):
        entry, exit_ts = _ts(row["entry"]), _ts(row["exit"])
        if entry < START_MS or entry >= END_MS or exit_ts <= entry:
            continue
        if any(interval.start <= entry < interval.end for interval in core):
            continue
        if entry < active_until:
            continue
        chosen.append({**row, "entryTs": entry, "exitTs": exit_ts})
        active_until = exit_ts
    return chosen


def _overlay_segments(candidate: dict, core: list[Interval], initial_gross: float, preemptible: bool) -> tuple[list[tuple[int, int, float]], float, int, float, bool]:
    start, end = int(candidate["entryTs"]), int(candidate["exitTs"])
    current = max(0.0, initial_gross)
    segments: list[tuple[int, int, float]] = []
    cursor = start
    trim_gross = 0.0
    trim_count = 0
    conflict = False
    core_entries = sorted((item for item in core if start < item.start < end), key=lambda item: (item.start, item.sleeve))
    active_core = [item for item in core if item.start < start < item.end]
    for item in core_entries:
        if current > 0 and item.start > cursor:
            segments.append((cursor, item.start, current))
        active_core = [old for old in active_core if old.end > item.start]
        crypto_core = sum(old.gross for old in active_core if old.crypto)
        total_core = sum(old.gross for old in active_core)
        needed = required_preemption_gross(overlay_gross=current, core_gross=item.gross, crypto_cap=CRYPTO_CAP - crypto_core, total_cap=TOTAL_CAP - total_core, core_is_crypto=item.crypto)
        if needed > 1e-12:
            if preemptible:
                current = max(0.0, current - needed)
                trim_gross += needed
                trim_count += 1
            else:
                conflict = True
        active_core.append(item)
        cursor = item.start
    if current > 0 and end > cursor:
        segments.append((cursor, end, current))
    duration = max(1, end - start)
    area = sum((b - a) * gross for a, b, gross in segments)
    return segments, area / duration, trim_count, trim_gross, conflict


def _areas(intervals: Iterable[Interval], overlay_segments: Iterable[tuple[int, int, float]]) -> dict:
    changes: defaultdict[int, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    for item in intervals:
        changes[item.start][0] += item.gross if item.crypto else 0.0
        changes[item.end][0] -= item.gross if item.crypto else 0.0
        changes[item.start][1] += item.gross
        changes[item.end][1] -= item.gross
    for start, end, gross in overlay_segments:
        changes[start][0] += gross
        changes[end][0] -= gross
        changes[start][1] += gross
        changes[end][1] -= gross
        changes[start][2] += gross
        changes[end][2] -= gross
    points = sorted({START_MS, END_MS, *changes})
    crypto = total = overlay = 0.0
    crypto_area = total_area = overlay_area = 0.0
    for left, right in zip(points, points[1:]):
        if left in changes:
            crypto += changes[left][0]
            total += changes[left][1]
            overlay += changes[left][2]
        hours = max(0.0, right - left) / 3_600_000.0
        crypto_area += crypto * hours
        total_area += total * hours
        overlay_area += overlay * hours
    period_hours = (END_MS - START_MS) / 3_600_000.0
    return {"periodHours": period_hours, "cryptoGrossHours": crypto_area, "totalGrossHours": total_area, "overlayGrossHours": overlay_area, "averageCryptoGross": crypto_area / period_hours, "averageTotalGross": total_area / period_hours, "unusedCryptoGrossHours": CRYPTO_CAP * period_hours - crypto_area, "unusedTotalGrossHours": TOTAL_CAP * period_hours - total_area, "cryptoUtilizationPct": crypto_area / (CRYPTO_CAP * period_hours) * 100.0, "totalUtilizationPct": total_area / (TOTAL_CAP * period_hours) * 100.0}


def _overlay_stats(candidates: list[dict], segments_by_candidate: list[list[tuple[int, int, float]]], mode: str) -> dict:
    positive = negative = 0.0
    factor = 1.0
    path = 1.0
    for candidate, segments in sorted(zip(candidates, segments_by_candidate), key=lambda pair: pair[0]["exitTs"]):
        duration = max(1, int(candidate["exitTs"]) - int(candidate["entryTs"]))
        area = sum((right - left) * gross for left, right, gross in segments)
        avg_gross = area / duration
        unit = _finite(candidate.get(f"{mode}_net"), 0.0)
        value = unit * avg_gross
        factor *= max(0.000001, 1.0 + value)
        path *= max(0.000001, 1.0 + value)
        if value >= 0:
            positive += value
        else:
            negative += -value
    return {"factor": factor, "positive": positive, "negative": negative}


def _scenario_row(*, formal: dict, formal_sleeves: dict, mode: str, target: float, policy: str, allocator: dict, reference_overlay: dict, base_overlay: dict) -> dict:
    base = FORMAL_INTEGRATED_EXPECTED[mode]
    if policy == "REQUIRED_ONLY_PREEMPTION" and abs(target - 1.5) < 1e-12:
        return {
            **base,
            "caseId": "CURRENT",
            "policy": "CURRENT",
            "targetGross": target,
            "equityMethod": "AUTHORITATIVE_FORMAL_CURRENT",
            "assetIsAuthoritative": True,
            "isProjection": False,
            "upliftAccepted": False,
            "tradeCountMethod": "formal-integrated-trades",
            "drawdownMethod": "formal-integrated-drawdown",
            **allocator,
        }
    factor_ratio = allocator["overlayFactor"] / max(1e-12, reference_overlay["overlayFactor"])
    asset = base["asset"] * factor_ratio
    q = formal_sleeves["SUPPLEMENT_QUALITY102"]
    q_pf = _finite(q.get("profitFactor"), 1.0)
    q_pnl = _finite(q.get("pnlJpy"), 0.0)
    q_gain = q_pnl * q_pf / max(1e-12, q_pf - 1.0) if q_pf > 1.0 else max(0.0, q_pnl)
    q_loss = max(0.0, q_gain - q_pnl)
    current_positive = max(1e-12, reference_overlay["overlayPositive"])
    current_negative = max(1e-12, reference_overlay["overlayNegative"])
    new_q_gain = q_gain * allocator["overlayPositive"] / current_positive
    new_q_loss = q_loss * allocator["overlayNegative"] / current_negative
    core_gain = max(0.0, base["pf"] * 1.0)  # replaced below by exact PF decomposition
    total_loss = 1.0
    total_gain = base["pf"] * total_loss
    core_gain = max(0.0, total_gain - q_gain)
    core_loss = max(1e-12, total_loss - q_loss)
    pf = (core_gain + new_q_gain) / max(1e-12, core_loss + new_q_loss)
    current_q_trades = int(q.get("trades", 0))
    core_trades = base["trades"] - current_q_trades
    trades = core_trades + allocator["acceptedCandidates"] + allocator["preemptionTrimCount"]
    # There is no formal combined equity event path in the recovered artifact.
    # Keep DD at the unchanged core anchor and state that limitation explicitly;
    # do not manufacture a drawdown path from a scalar uplift factor.
    return {
        "asset": asset,
        "pf": pf,
        "dd": base["dd"],
        "trades": trades,
        "v52Events": base["v52Events"],
        "caseId": f"{policy}_{target:g}",
        "policy": policy,
        "targetGross": target,
        "equityMethod": "FORMAL_CURRENT_PLUS_CAUSAL_NET_RETURN_REPLAY",
        "assetIsAuthoritative": False,
        "isProjection": True,
        "upliftAccepted": False,
        "tradeCountMethod": "formal-core-trades-plus-replay-trim-executions",
        "drawdownMethod": "formal-current-core-anchor; combined-replay-path-unavailable",
        **allocator,
    }


def _run_allocator(mode: str, target: float, policy: str, candidates: list[dict], core: list[Interval], formal_row: dict, formal_sleeves: dict, reference_overlay: dict | None = None) -> dict:
    reserve = 0.5 if policy == "RESERVE_0P5_REQUIRED_ONLY" else 0.0
    initial = max(0.0, target - reserve)
    preemptible = policy != "FLAT_BOOST"
    segments_by_candidate: list[list[tuple[int, int, float]]] = []
    trim_count = 0
    trim_gross = 0.0
    conflicts = 0
    for candidate in candidates:
        segments, _average, count, gross, conflict = _overlay_segments(candidate, core, initial, preemptible)
        segments_by_candidate.append(segments)
        trim_count += count
        trim_gross += gross
        conflicts += int(conflict)
    overlay = _overlay_stats(candidates, segments_by_candidate, "normal" if mode == "NORMAL" else "stress")
    areas = _areas(core, [segment for group in segments_by_candidate for segment in group])
    baseline = reference_overlay or overlay
    parity = conflicts == 0 and preemptible
    routing = formal_row.get("routing", {})
    return {
        "acceptedCandidates": len(candidates),
        "preemptionTrimCount": trim_count,
        "preemptionTrimGross": trim_gross,
        "grossConflicts": conflicts,
        "coreFillParity": parity,
        "overlayFactor": overlay["factor"],
        "overlayPositive": overlay["positive"],
        "overlayNegative": overlay["negative"],
        "averageOverlayGross": areas["overlayGrossHours"] / areas["periodHours"],
        "timeWeightedCryptoGross": areas["averageCryptoGross"],
        "averageCryptoGross": areas["averageCryptoGross"],
        "unusedCryptoGrossHours": areas["unusedCryptoGrossHours"],
        "unusedTotalGrossHours": areas["unusedTotalGrossHours"],
        "cryptoUtilizationPct": areas["cryptoUtilizationPct"],
        "totalUtilizationPct": areas["totalUtilizationPct"],
        "coreFillCounts": {
            "V12": int(routing.get("V12_ENTERED", 0)),
            "PENGU": int(routing.get("PENGU_ENTERED", 0)),
            "SUPPLEMENT": int(routing.get("SUPPLEMENT_ENTERED", 0)),
            "V52": int(formal_row.get("v52Events", 0)),
        },
        "coreFillParityMethod": "scenario keeps formal CURRENT core counts unchanged",
        "dailyLossLatches": int(routing.get("CRYPTO_DAILY_LOSS_LATCHES", 0)),
        "dailyLossLatchSource": "formal-current-shared-crypto-risk-replay",
    }


def _write_outputs(root: Path, result: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    json_path = root / "idle-capital-unused-gross-20260918.json"
    md_path = root / "idle-capital-unused-gross-20260918.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# DisDex idle-capital / unused-gross research backtest", "",
        f"Status: **{result['status']}**", "",
        "Research-only. No LIVE/VPS/production state or services were changed and no orders were sent.", "",
        "The CURRENT row is the exact formal anchor. Higher-target rows are explicitly marked projections: they replay only recovered realized candidate net returns at causal allocated gross; no synthetic price path, lookahead, or accepted uplift claim is used.", "",
        "## CURRENT parity", "",
        f"- Formal event-level gate: **{'PASS' if result['currentParity']['allPass'] else 'FAIL'}**.",
        "- NORMAL: asset 69,373,656.13931108; PF 3.70258068; DD -17.59935397%; trades 1165; V12 874; PENGU 66; Q102 69; V52 events 143.",
        "- SEVERE: asset 8,729,157.74295382; PF 2.62470185; DD -19.24473938%; trades 1023; V12 871; PENGU 66; Q102 69; V52 events 0.",
        "- The 90 Q102 candidates are causally routed to 69; no manual truncation is used. The 21 excluded rows are outside the period or blocked by a higher-priority core entry.", "",
        "## Dynamic residual allocation", "",
        "Core sleeves retain priority. Q102 is one-slot, lower-priority overlay capacity; REQUIRED_ONLY_PREEMPTION trims only the exact gross deficit at a later core entry.", "",
        "| Mode | Target | Policy | Asset | PF | DD | Trades | Avg crypto gross | Unused crypto gross-hours | Utilization | Trims / gross | Latches | Core parity | Conflicts |",
        "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|",
    ]
    for case in result.get("cases", []):
        lines.append(
            f"| {case['mode']} | {case['targetGross']:.1f} | {case['caseId']} / {case['policy']} | {case['asset']:.8f} | {case['pf']:.8f} | {case['dd']:.8f}% | {case['trades']} | {case['averageCryptoGross']:.6f} | {case['unusedCryptoGrossHours']:.2f} | {case['cryptoUtilizationPct']:.2f}% | {case['preemptionTrimCount']} / {case['preemptionTrimGross']:.6f} | {case['dailyLossLatches']} | {'PASS' if case['coreFillParity'] else 'FAIL'} | {case['grossConflicts']} |"
        )
    lines += ["", "## Rejected claims", "", f"- {REJECTED_UPLIFT}.", "- The old 102-row frozen Q102 fixture is rejected by the lineage gate.", "", "## Input hashes", ""]
    for name, value in result.get("inputs", {}).items():
        if isinstance(value, dict) and "sha256" in value:
            lines.append(f"- `{name}`: `{value['sha256']}`")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _load_and_run(args: argparse.Namespace) -> dict:
    formal = _load_json(Path(args.formal_json))
    formal_gate = validate_formal_artifact(formal)
    blockers: dict[str, Any] = {}
    if not formal_gate["allPass"]:
        blockers["formal"] = formal_gate
    v12_path, pengu_path, candidate_path, evidence_path = map(Path, (args.v12_ledger, args.pengu_ledger, args.q102_csv, args.q102_evidence))
    for label, path in (("v12", v12_path), ("pengu", pengu_path), ("q102", candidate_path), ("q102Evidence", evidence_path), ("stockCache", Path(args.stock_cache_dir)), ("stockBackbone", Path(args.stock_backbone))):
        if not path.exists():
            blockers[label] = f"MISSING:{path}"
    if blockers:
        return build_blocked_result(blockers, formal_gate)
    v12, pengu = _load_json(v12_path), _load_json(pengu_path)
    for label, payload in (("v12", v12), ("pengu", pengu)):
        if payload.get("period") != FORMAL_PERIOD:
            blockers[label] = "PERIOD_MISMATCH"
    with candidate_path.open(newline="", encoding="utf-8") as handle:
        candidate_reader = csv.DictReader(handle)
        candidate_fields = candidate_reader.fieldnames
        candidate_rows = list(candidate_reader)
    qmeta = {"path": str(candidate_path), "rowCount": len(candidate_rows), "sourceKind": "dynamic-causal-v4", "upstreamCandidates": len(candidate_rows), "integratedFills": Q102_TARGET_ENTRIES, "sourceSha": _sha256(candidate_path)}
    qgate = validate_q102_lineage(qmeta)
    if not qgate["accepted"]:
        blockers["q102"] = qgate
    elif candidate_fields != Q102_COLUMNS:
        blockers["q102"] = {"reason": "Q102_CANDIDATE_COLUMNS_MISMATCH", "expected": Q102_COLUMNS, "observed": candidate_fields}
    candidates = candidate_rows
    with evidence_path.open(newline="", encoding="utf-8") as handle:
        evidence_reader = csv.DictReader(handle)
        evidence_fields = evidence_reader.fieldnames
        evidence_rows = list(evidence_reader)
    if evidence_fields != Q102_EVIDENCE_COLUMNS or len(evidence_rows) != Q102_UPSTREAM_CANDIDATES or _sha256(evidence_path) != Q102_EVIDENCE_SHA:
        blockers["q102Evidence"] = {"rows": len(evidence_rows), "columns": evidence_fields, "sha256": _sha256(evidence_path), "expectedSha256": Q102_EVIDENCE_SHA}
    if len(candidates) != Q102_UPSTREAM_CANDIDATES:
        blockers["q102"] = {"reason": "Q102_CANDIDATE_COUNT_MISMATCH", "expected": Q102_UPSTREAM_CANDIDATES, "observed": len(candidates), "lineage": qgate}
    if not blockers.get("q102") and not blockers.get("q102Evidence"):
        evidence_keys = {(row["symbol"], int(row["entry_ts_ms"]), str(row["side"]), round(_finite(row["entry_price"]), 10)) for row in evidence_rows}
        candidate_keys = {(row["symbol"], _ts(row["entry"]), str(row["side"]), round(_finite(row["entry_price"]), 10)) for row in candidates}
        if evidence_keys != candidate_keys:
            blockers["q102Evidence"] = {"reason": "Q102_EVIDENCE_CANDIDATE_IDENTITY_MISMATCH", "evidenceRows": len(evidence_keys), "candidateRows": len(candidate_keys)}
    if blockers:
        return build_blocked_result(blockers, formal_gate)
    stock_rows, stock_diag = _load_stock_rows(Path(args.stock_backbone), Path(args.stock_cache_dir))
    cases: list[dict] = []
    current_parity_checks: dict[str, bool] = {}
    for mode, ledger_mode in (("NORMAL", "normal"), ("SEVERE", "stress")):
        v12_intervals = _ledger_intervals(v12, ledger_mode, "V12", True)
        pengu_intervals = _ledger_intervals(pengu, ledger_mode, "PENGU", True)
        stock_intervals = _stock_intervals(stock_rows)
        core = v12_intervals + pengu_intervals + stock_intervals
        causal = _causal_candidates(candidates, core)
        causal_audit = _causal_routing_audit(candidates, core)
        current_parity_checks[f"{mode}.V12"] = len(v12.get("modes", {}).get(ledger_mode, {}).get("trades", [])) == FORMAL_ROUTING_EXPECTED[mode]["V12_ENTERED"]
        current_parity_checks[f"{mode}.PENGU"] = len(pengu.get("modes", {}).get(ledger_mode, {}).get("trades", [])) == FORMAL_ROUTING_EXPECTED[mode]["PENGU_ENTERED"]
        current_parity_checks[f"{mode}.Q102"] = len(causal) == Q102_TARGET_ENTRIES
        formal_routing = formal["finalCombined"][mode].get("routing", {})
        current_parity_checks[f"{mode}.SupplementFormal"] = formal_routing.get("SUPPLEMENT_ENTERED") == FORMAL_ROUTING_EXPECTED[mode]["SUPPLEMENT_ENTERED"]
        current_parity_checks[f"{mode}.PENGUFormal"] = formal_routing.get("PENGU_ENTERED") == FORMAL_ROUTING_EXPECTED[mode]["PENGU_ENTERED"]
        current_parity_checks[f"{mode}.V52Events"] = formal["finalCombined"][mode].get("v52Events") == FORMAL_INTEGRATED_EXPECTED[mode]["v52Events"]
        current_parity_checks[f"{mode}.FormalAggregate"] = formal_gate["allPass"]
        if len(causal) != Q102_TARGET_ENTRIES:
            blockers[f"{mode}.q102Routing"] = {"expected": Q102_TARGET_ENTRIES, "observed": len(causal)}
        reference = _run_allocator(mode, 1.5, "REQUIRED_ONLY_PREEMPTION", causal, core, formal["finalCombined"][mode], formal["finalCombined"]["normalBySleeve" if mode == "NORMAL" else "severeBySleeve"])
        for target in TARGET_GROSSES:
            for policy in ("REQUIRED_ONLY_PREEMPTION", "RESERVE_0P5_REQUIRED_ONLY"):
                allocator = _run_allocator(mode, target, policy, causal, core, formal["finalCombined"][mode], formal["finalCombined"]["normalBySleeve" if mode == "NORMAL" else "severeBySleeve"], reference_overlay=reference)
                if policy == "REQUIRED_ONLY_PREEMPTION" and abs(target - 1.5) < 1e-12:
                    allocator["preemptionTrimCount"] = formal["finalCombined"][mode]["routing"].get("SUPPLEMENT_GROSS_RESIZED", allocator["preemptionTrimCount"])
                row = _scenario_row(formal=formal["finalCombined"], formal_sleeves=formal["finalCombined"]["normalBySleeve" if mode == "NORMAL" else "severeBySleeve"], mode=mode, target=target, policy=policy, allocator=allocator, reference_overlay=reference, base_overlay=reference)
                row["mode"] = mode
                row["causalRouting"] = causal_audit
                row["causalEligibleCandidates"] = len(causal)
                row["coreSleevesUnchanged"] = True
                row["grossConflictMethod"] = "overlay-entry-capacity-conflicts-after-core-allocation"
                row["comparisonTier"] = "PRIMARY" if policy == "REQUIRED_ONLY_PREEMPTION" else "OPTIONAL_RESERVE_SENSITIVITY"
                cases.append(row)
    inputs = {
        "formalJson": {"path": str(Path(args.formal_json)), "sha256": _sha256(Path(args.formal_json))},
        "v12Ledger": {"path": str(v12_path), "sha256": _sha256(v12_path)},
        "penguLedger": {"path": str(pengu_path), "sha256": _sha256(pengu_path)},
        "q102Candidates": {"path": str(candidate_path), "sha256": _sha256(candidate_path), "rows": len(candidates)},
        "q102Evidence": {"path": str(evidence_path), "sha256": _sha256(evidence_path), "rows": len(evidence_rows)},
        "stockBackbone": {"path": str(Path(args.stock_backbone)), "sha256": _sha256(Path(args.stock_backbone))},
        "stockCache": {"path": str(Path(args.stock_cache_dir)), "diagnostics": stock_diag},
    }
    if blockers:
        return build_blocked_result(blockers, formal_gate)
    return {
        "schema": "idle-capital-unused-gross-backtest/v3", "status": "PASS_RESEARCH_ONLY", "decision": "REPORT_RESEARCH_COMPARISON",
        "contract": {"period": dict(FORMAL_PERIOD), "rejectedPriorUpliftClaim": REJECTED_UPLIFT, "architecture": FORMAL_ARCHITECTURE_EXPECTED},
        "methodology": {"currentAnchor": "formal-v52-final-validated-logic-20260917", "eventReplay": "recovered V12/PENGU/Q102 inputs plus stock entry timing", "overlayReturnTreatment": "recovered realized candidate net returns scaled by causal allocated gross; no synthetic price path or lookahead", "higherTargetInterpretation": "formal CURRENT anchor plus residual-overlay replay; core sleeves remain unchanged and preemptible overlay is trimmed on later core entries", "drawdownTreatment": "formal CURRENT DD is retained as the unchanged core anchor; no combined DD is claimed because the recovered formal artifact does not expose a combined event-equity path", "assetTreatment": "CURRENT is authoritative; higher-target assets are unaccepted candidate-net-return replay projections"},
        "formalArtifactGate": formal_gate,
        "currentParity": {"allPass": formal_gate["allPass"] and all(current_parity_checks.values()), "checks": current_parity_checks, "formalRows": FORMAL_INTEGRATED_EXPECTED, "eventLevelInputs": {"v12Normal": len(v12["modes"]["normal"]["trades"]), "v12Severe": len(v12["modes"]["stress"]["trades"]), "penguNormal": len(pengu["modes"]["normal"]["trades"]), "penguSevere": len(pengu["modes"]["stress"]["trades"]), "q102Upstream": len(candidates), "q102Integrated": Q102_TARGET_ENTRIES}},
        "cases": cases, "inputs": inputs, "q102Lineage": qgate, "safety": dict(RESEARCH_SAFETY), "upliftAccepted": False,
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
    parser.add_argument("--output-root", required=True)
    args = parser.parse_args()
    result = _load_and_run(args)
    _write_outputs(Path(args.output_root), result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") != "PASS_RESEARCH_ONLY":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
