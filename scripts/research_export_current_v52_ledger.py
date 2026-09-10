from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

UTC = dt.timezone.utc
ROOT = Path(__file__).resolve().parents[1]
STOCK_ROOT = ROOT / ".stock-research"
sys.path.insert(0, str(STOCK_ROOT / "scripts"))

import research_lab_v96_v52_dual_slot_one_year_bt as v52

START = dt.datetime(2025, 8, 10, tzinfo=UTC)
END = dt.datetime(2026, 8, 10, tzinfo=UTC)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache-root", default=".cache/aster-only-v39-overnight-open")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    v52.PERIOD_START = START
    v52.PERIOD_END = END
    v52.START_MS = int(START.timestamp() * 1000)
    v52.END_MS = int(END.timestamp() * 1000)
    v11, v50, target, diag = v52.build_stock(Path(args.cache_root))
    candidate = v52.stock.frozen_v50_candidate()
    expected_id = "POST_EARLY3__B75__H3__BOTH__NONE"
    if candidate.candidate_id != expected_id:
        raise RuntimeError(f"V52 candidate drift: {candidate.candidate_id}")

    payload = {
        "schema": "current-v52-raw-ledger/v1",
        "period": {
            "startInclusive": START.isoformat(),
            "endExclusive": END.isoformat(),
        },
        "contract": {
            "v50CandidateId": candidate.candidate_id,
            "v11GrossCap": 1.0,
            "v50GrossCap": 1.0,
            "stockGrossCap": 1.5,
            "totalGrossCap": 2.5,
            "stockDailyLossPct": 3.5,
        },
        "targetDays": target,
        "diagnostics": diag,
        "v11Raw": v11,
        "v50Raw": v50,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"v11Raw": len(v11), "v50Raw": len(v50), "targetDays": len(target), "candidate": candidate.candidate_id}))


if __name__ == "__main__":
    main()
