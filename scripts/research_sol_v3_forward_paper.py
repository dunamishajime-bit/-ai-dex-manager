"""Cumulative forward-paper evaluator for frozen SOL V3.

Research only. The signal/lifecycle is imported from the frozen V3 unchanged.
The evaluation starts at 2026-07-01T00:00:00Z and advances only as genuinely
new completed UTC days become available. No parameter search or retuning.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_pair_specific_clean_sheet_v3 as v3

DATA_START = 1661990400000
OOS_START = 1782864000000
SYMBOLS = ("BTC", "ETH", "BNB", "SOL", "LINK", "AVAX")
CACHE_VERSION = "v3"
ARCH = "CONTRACTION_REACCEL_CAPTURE"
HOUR = 3_600_000


def parse_end() -> int:
    raw = os.environ.get("FORWARD_PAPER_END_TS", "").strip()
    if not raw:
        raise RuntimeError("FORWARD_PAPER_END_TS_REQUIRED")
    end = int(raw)
    if end <= OOS_START or end % (24 * HOUR) != 0:
        raise RuntimeError(f"INVALID_FORWARD_PAPER_END_TS:{end}")
    return end


def load_exact(end_ts: int) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[int, int]]]:
    root = Path.cwd() / ".cache" / "perp-research-usdm" / "consolidated"
    candles: dict[str, list[dict[str, Any]]] = {}
    expected_last = end_ts - HOUR
    for symbol in SYMBOLS:
        path = root / f"{symbol}USDT-{DATA_START}-{end_ts}-{CACHE_VERSION}.json"
        if not path.is_file():
            raise FileNotFoundError(f"FORWARD_PAPER_EXACT_CACHE_MISSING:{path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("candles") or []
        if not rows:
            raise RuntimeError(f"FORWARD_PAPER_EMPTY_CANDLES:{symbol}")
        last_ts = int(rows[-1]["ts"])
        if last_ts != expected_last:
            raise RuntimeError(f"FORWARD_PAPER_INCOMPLETE_DATA:{symbol}:last={last_ts}:expected={expected_last}")
        candles[symbol] = rows
    index = {
        symbol: {int(row["ts"]): i for i, row in enumerate(rows)}
        for symbol, rows in candles.items()
    }
    return candles, index


def evidence_gate(normal: dict[str, Any], stress: dict[str, Any], elapsed_days: int) -> dict[str, Any]:
    trades = int(normal.get("trades") or 0)
    if trades < 5:
        status = "INSUFFICIENT_FRESH_SAMPLE"
    else:
        supportive = bool(
            float(normal.get("returnPct") or 0.0) > 0.0
            and float(normal.get("pf") or 0.0) >= 1.05
            and float(normal.get("pfWithoutBest") or 0.0) >= 0.80
            and float(stress.get("returnPct") or 0.0) >= -2.0
            and float(stress.get("pf") or 0.0) >= 0.85
            and float(normal.get("maxDDPct") or 0.0) > -10.0
        )
        status = "SUPPORTIVE_FRESH_OOS" if supportive else "FRESH_OOS_NOT_SUPPORTED"
    maturity = "MATURE_FORWARD_SAMPLE" if elapsed_days >= 90 and trades >= 12 else "IMMATURE_FORWARD_SAMPLE"
    return {
        "status": status,
        "maturity": maturity,
        "predeclaredMinimumTrades": 5,
        "maturityMinimumDays": 90,
        "maturityMinimumTrades": 12,
        "liveEligible": False,
        "thresholdsUnchangedFromInitialFreshOos": True,
    }


def main() -> None:
    end_ts = parse_end()
    elapsed_days = int((end_ts - OOS_START) // (24 * HOUR))
    candles, index = load_exact(end_ts)

    v3._ctx_cache.clear()
    normal_records = v3.simulate("SOL", ARCH, candles, index, OOS_START, end_ts, v3.NORMAL_BPS, 0)
    v3._ctx_cache.clear()
    stress_records = v3.simulate("SOL", ARCH, candles, index, OOS_START, end_ts, v3.STRESS_BPS, v3.STRESS_DELAY)
    normal = v3.metric(normal_records)
    stress = v3.metric(stress_records)
    gate = evidence_gate(normal, stress, elapsed_days)

    output = {
        "researchLine": "SOL_V3_CUMULATIVE_FORWARD_PAPER",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "symbol": "SOL",
        "architecture": ARCH,
        "sourceV3BlobSha": "e53d04416309e7adc92cbef7f0230ea7f60b368d",
        "window": {
            "startTs": OOS_START,
            "endTsExclusive": end_ts,
            "elapsedDays": elapsed_days,
        },
        "antiOverfit": {
            "v3LogicFrozen": True,
            "parameterSearch": False,
            "sameRunRetuning": False,
            "nonSolStrategiesEvaluated": False,
            "forwardOnly": True,
        },
        "normal": normal,
        "stress": stress,
        "evidenceGate": gate,
        "normalTrades": normal_records,
        "stressTrades": stress_records,
    }

    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "sol-v3-forward-paper.json").write_text(json.dumps(output, indent=2, sort_keys=True), encoding="utf-8")
    lines = [
        "# SOL V3 Cumulative Forward Paper",
        "",
        "Frozen V3 logic. Research only; no production/VPS/LIVE changes.",
        "",
        f"- Forward days: {elapsed_days}",
        f"- Evidence: {gate['status']}",
        f"- Maturity: {gate['maturity']}",
        f"- Normal: trades={normal['trades']} return={normal['returnPct']:.4f}% PF={normal['pf']} PFwoBest={normal['pfWithoutBest']} DD={normal['maxDDPct']:.4f}%",
        f"- Stress: trades={stress['trades']} return={stress['returnPct']:.4f}% PF={stress['pf']} PFwoBest={stress['pfWithoutBest']} DD={stress['maxDDPct']:.4f}%",
        "- LIVE eligible: false",
    ]
    (root / "sol-v3-forward-paper.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "gate": gate, "normal": normal, "stress": stress}, indent=2))


if __name__ == "__main__":
    main()
