"""Read-only exact-source coverage audit; never treats alternate proxy trades as formal.
The production Q102 V4 model and signal code are the inputs for requirements.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

HOUR = 3_600_000
Q102_HISTORY_HOURS = 181 * 24
FORMAL_START = datetime(2025, 8, 10, tzinfo=timezone.utc)


def model_s34_symbols(source: str) -> list[str]:
    return sorted(set(re.findall(r'symbol:\s*"([A-Z]+USDT)"', source)))


def inspect(raw: dict, source: str) -> dict:
    models = model_s34_symbols(source)
    coverage = {sym: sorted(int(row["ts_ms"]) for row in rows)
                for sym, rows in raw.get("bars", {}).items()}
    required_warmup_start = int((FORMAL_START - timedelta(hours=Q102_HISTORY_HOURS)).timestamp() * 1000)
    available_s34 = [symbol for symbol in models if symbol in coverage]
    missing_s34 = [symbol for symbol in models if symbol not in coverage]
    insufficient_warmup = [
        symbol for symbol in available_s34
        if not coverage[symbol] or coverage[symbol][0] > required_warmup_start
    ]
    return {
        "schema": "disdex-research-canonical-source-coverage/v1",
        "status": "BLOCKED_INCOMPLETE_CANONICAL_INPUT_COVERAGE"
                  if missing_s34 or insufficient_warmup else "MODEL_INPUT_COVERAGE_ONLY",
        "sourceKind": str(raw.get("source", {})),
        "formalStartUtc": FORMAL_START.isoformat(),
        "q102HighVolMinimumHistoryHours": Q102_HISTORY_HOURS,
        "requiredEarliestHistoryUtc": datetime.fromtimestamp(required_warmup_start / 1000, timezone.utc).isoformat(),
        "modelS34Symbols": models,
        "modelS34Count": len(models),
        "availableModelSymbols": available_s34,
        "missingModelSymbols": missing_s34,
        "missingModelCount": len(missing_s34),
        "availableButInsufficientWarmup": insufficient_warmup,
        "earliestByAvailableSymbol": {
            symbol: datetime.fromtimestamp(times[0] / 1000, timezone.utc).isoformat()
            for symbol, times in coverage.items() if times
        },
        "formalComparable": False,  # Passing this coverage alone never proves execution parity.
        "otherBlockers": [
            "Q102_525_TO_30_SELECTOR_NOT_SOURCE_PROVEN",
            "ORIGINAL_TOP3_GLOBAL_LEDGER_MISSING",
            "V52_ASTER_BASIS_EXECUTION_PAIR_MISSING",
            "FET_ORIGINAL_1P25_AND_PREEMPTION_PARITY_MISSING",
            "PENGU_COMBINED_FILTERED_CAUSAL_EXIT_PARITY_MISSING",
            "ASTER_AND_ORIGINAL_NORMAL_SEVERE_INPUT_PARITY_MISSING",
        ],
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--bundle", required=True, type=Path)
    p.add_argument("--model", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    a = p.parse_args()
    with gzip.open(a.bundle, "rt", encoding="utf-8") as stream:
        bundle = json.load(stream)
    model = a.model.read_text(encoding="utf-8")
    audit = inspect(bundle, model)
    audit["bundleArchiveSha256"] = hashlib.sha256(a.bundle.read_bytes()).hexdigest()
    audit["productionModelSourceSha256"] = hashlib.sha256(model.encode("utf-8")).hexdigest()
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(audit, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: audit[key] for key in (
        "status", "modelS34Count", "missingModelSymbols",
        "availableButInsufficientWarmup", "requiredEarliestHistoryUtc", "formalComparable",
    )}, sort_keys=True))


if __name__ == "__main__":
    main()
