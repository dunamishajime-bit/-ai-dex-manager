"""Fresh untouched OOS evaluation for frozen SOL Clean-sheet V3.

Research only. This script imports the already-frozen V3 signal/lifecycle and
runs it without modification on 2026-07-01T00:00:00Z through
2026-08-15T00:00:00Z (exclusive), a period not used to design V3.

The other five symbols are loaded only because V3's causal context uses market
breadth/reference features. No non-SOL strategy is evaluated here.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import research_pair_specific_clean_sheet_v3 as v3

DATA_START = 1661990400000  # 2022-09-01T00:00:00Z, warmup source start
OOS_START = 1782864000000   # 2026-07-01T00:00:00Z
OOS_END = 1786752000000     # 2026-08-15T00:00:00Z exclusive
SYMBOLS = ("BTC", "ETH", "BNB", "SOL", "LINK", "AVAX")
CACHE_VERSION = "v3"
ARCH = "CONTRACTION_REACCEL_CAPTURE"


def load_exact() -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[int, int]]]:
    root = Path.cwd() / ".cache" / "perp-research-usdm" / "consolidated"
    candles: dict[str, list[dict[str, Any]]] = {}
    for symbol in SYMBOLS:
        path = root / f"{symbol}USDT-{DATA_START}-{OOS_END}-{CACHE_VERSION}.json"
        if not path.is_file():
            raise FileNotFoundError(f"FRESH_OOS_EXACT_CACHE_MISSING:{path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("candles") or []
        if not rows:
            raise RuntimeError(f"FRESH_OOS_EMPTY_CANDLES:{symbol}")
        candles[symbol] = rows
    index = {
        symbol: {int(row["ts"]): i for i, row in enumerate(rows)}
        for symbol, rows in candles.items()
    }
    return candles, index


def classify(normal: dict[str, Any], stress: dict[str, Any]) -> dict[str, Any]:
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
    return {
        "status": status,
        "predeclaredMinimumTrades": 5,
        "predeclaredThresholds": {
            "normalReturnPct": ">0",
            "normalPF": ">=1.05",
            "normalPFWithoutBest": ">=0.80",
            "stressReturnPct": ">=-2.0",
            "stressPF": ">=0.85",
            "normalMaxDDPct": ">-10.0",
        },
        "liveEligible": False,
    }


def main() -> None:
    candles, index = load_exact()

    # Clear the frozen V3 context cache defensively so the fresh dataset is the
    # only dataset represented in this process. Signal and exit code are not changed.
    v3._ctx_cache.clear()

    normal_records = v3.simulate(
        "SOL", ARCH, candles, index, OOS_START, OOS_END,
        v3.NORMAL_BPS, 0,
    )
    v3._ctx_cache.clear()
    stress_records = v3.simulate(
        "SOL", ARCH, candles, index, OOS_START, OOS_END,
        v3.STRESS_BPS, v3.STRESS_DELAY,
    )
    normal = v3.metric(normal_records)
    stress = v3.metric(stress_records)
    gate = classify(normal, stress)

    output = {
        "researchLine": "SOL_V3_FRESH_OOS_20260701_20260815",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "symbol": "SOL",
        "architecture": ARCH,
        "sourceV3Sha": os.environ.get("SOURCE_V3_SHA", "738eac0d6d7d20173cc3824282ef5b591dc7a3a5"),
        "sourceV3BlobSha": os.environ.get("SOURCE_V3_BLOB_SHA", "e53d04416309e7adc92cbef7f0230ea7f60b368d"),
        "oos": {
            "startTs": OOS_START,
            "endTsExclusive": OOS_END,
            "startUtc": "2026-07-01T00:00:00Z",
            "endUtcExclusive": "2026-08-15T00:00:00Z",
            "days": 45,
            "freshRelativeToV3Design": True,
        },
        "antiOverfit": {
            "v3LogicFrozen": True,
            "signalThresholdChanged": False,
            "exitThresholdChanged": False,
            "parameterSearch": False,
            "sameRunRetuning": False,
            "nonSolStrategiesEvaluated": False,
            "forwardPaperStillRequiredBeforeAnyLiveUse": True,
        },
        "normal": normal,
        "stress": stress,
        "evidenceGate": gate,
        "normalTrades": normal_records,
        "stressTrades": stress_records,
    }

    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "sol-v3-fresh-oos.json").write_text(
        json.dumps(output, indent=2, sort_keys=True), encoding="utf-8"
    )

    lines = [
        "# SOL V3 Fresh OOS",
        "",
        "Frozen V3 logic; research only; no production/VPS/LIVE changes.",
        "",
        f"- Period: 2026-07-01T00:00:00Z to 2026-08-15T00:00:00Z (exclusive)",
        f"- Evidence: {gate['status']}",
        f"- Normal: trades={normal['trades']} return={normal['returnPct']:.4f}% PF={normal['pf']} PFwoBest={normal['pfWithoutBest']} DD={normal['maxDDPct']:.4f}%",
        f"- Stress: trades={stress['trades']} return={stress['returnPct']:.4f}% PF={stress['pf']} PFwoBest={stress['pfWithoutBest']} DD={stress['maxDDPct']:.4f}%",
        "- LIVE eligible: false",
    ]
    (root / "sol-v3-fresh-oos.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "evidenceGate": gate, "normal": normal, "stress": stress}, indent=2))


if __name__ == "__main__":
    main()
