from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import research_lab_aster_only_v14_replacement_tournament as v14

# Frozen from successful workflow run 30117325883 / artifact
# v96-crypto-v11eq-v13d-one-year-30117325883.
# Eleven equal economic cycles at this raw bps reproduce the artifact's
# Normal compounded V13D return to rounding and avoid refetching rate-limited
# Aster/XYZ history during the Aster-only tournament.
FROZEN_RAW_GROSS_BPS = 42.72687610828728
FROZEN_TRADE_COUNT = 11


def frozen_v13d(_cache_root: Path):
    start = dt.datetime(2026, 4, 13, 14, 0, tzinfo=dt.timezone.utc)
    rows = []
    for index in range(FROZEN_TRADE_COUNT):
        entry = start + dt.timedelta(days=index * 5)
        exit_at = entry + dt.timedelta(hours=4, minutes=30)
        rows.append({
            "strategy": "V13D",
            "day": entry.date().isoformat(),
            "symbol": ("AMZN", "META", "MSFT", "NVDA", "TSLA")[index % 5],
            "entryTs": int(entry.timestamp() * 1000),
            "exitTs": int(exit_at.timestamp() * 1000),
            "gross": 1.0,
            "grossBps": FROZEN_RAW_GROSS_BPS,
            "exitReason": "FROZEN_ARTIFACT_ECONOMIC_PROXY",
            "entryBasisBps": 20.0,
        })
    diagnostics = {
        "source": "workflow_run_30117325883_artifact_8605974635",
        "artifactDigest": "sha256:6f2ff3b5fd6b3429da436d2bef1887f3fe407e424319212013655ce6ad7c60bc",
        "trades": FROZEN_TRADE_COUNT,
        "normalCompoundedReturnPct": 2.979561,
        "p95CompoundedReturnPct": 1.855414,
        "severeCompoundedReturnPct": -0.249784,
        "capitalHoursAssumption": "4.5 hours times two venue legs per cycle; conservative minimum versus 15:00 exits",
        "rateLimitedHistoricalRefetchAvoided": True,
    }
    return rows, diagnostics


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    v14.base.build_v13d = frozen_v13d
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = v14.analyze(Path(args.cache_dir).resolve())
    result["v13dBenchmark"]["frozenSuccessfulArtifact"] = {
        "workflowRun": 30117325883,
        "artifactId": 8605974635,
        "artifactDigest": "sha256:6f2ff3b5fd6b3429da436d2bef1887f3fe407e424319212013655ce6ad7c60bc",
        "reportedStandaloneReturnsPct": {
            "FORWARD_MEDIAN": 3.659452,
            "NORMAL": 2.979561,
            "P95": 1.855414,
            "SEVERE": -0.249784,
        },
    }
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(v14.report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "period": result["period"],
        "v13dNormal": result["v13dBenchmark"]["results"]["NORMAL"],
        "winner": result.get("winner"),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
