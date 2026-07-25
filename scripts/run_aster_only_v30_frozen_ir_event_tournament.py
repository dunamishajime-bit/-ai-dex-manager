from __future__ import annotations

from typing import Dict, Sequence, Tuple

import research_lab_aster_only_v30_sec_filing_event_drift_tournament as v30

FROZEN_EARNINGS_RELEASE_DATES = {
    "AMZNUSDT": ("2025-07-31", "2025-10-30", "2026-02-05", "2026-04-29"),
    "METAUSDT": ("2025-07-30", "2025-10-29", "2026-01-28", "2026-04-29"),
    "MSFTUSDT": ("2025-07-30", "2025-10-29", "2026-01-28", "2026-04-29"),
    "NVDAUSDT": ("2025-08-27", "2025-11-19", "2026-02-25", "2026-05-20"),
    "TSLAUSDT": ("2025-07-23", "2025-10-22", "2026-01-28", "2026-04-22", "2026-07-22"),
}


def load_frozen_ir_events(_cache_dir, trading_days: Sequence[str]) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    sorted_days = sorted(trading_days)
    result: Dict[str, Dict[str, dict]] = {symbol: {} for symbol in v30.SYMBOLS}
    diagnostics = {
        "source": "Frozen official company investor-relations earnings release dates",
        "secApiFallbackReason": "GitHub Actions source IP received HTTP 403 from data.sec.gov",
        "symbols": {},
    }
    for symbol, release_dates in FROZEN_EARNINGS_RELEASE_DATES.items():
        mapped = 0
        for release_date in release_dates:
            future_days = [day for day in sorted_days if day > release_date]
            for age, day in enumerate(future_days[:2]):
                result[symbol][day] = {
                    "filingDate": release_date,
                    "acceptanceDateTime": None,
                    "form": "OFFICIAL_IR_EARNINGS_RELEASE",
                    "items": "QUARTERLY_RESULTS",
                    "accessionNumber": None,
                    "quarterly": True,
                    "results": True,
                    "eventAge": age,
                    "eventSession": day,
                }
                mapped += 1
        diagnostics["symbols"][symbol] = {
            "releaseDates": list(release_dates),
            "eligibleFilings": len(release_dates),
            "mappedSessionRows": mapped,
            "firstFiling": release_dates[0],
            "lastFiling": release_dates[-1],
        }
    return result, diagnostics


_ORIGINAL_ANALYZE = v30.analyze


def analyze_with_frozen_ir_events(cache_root):
    result = _ORIGINAL_ANALYZE(cache_root)
    result["selectionDiscipline"]["filingSessionRule"] = (
        "strictly next aligned session after frozen official IR earnings release date"
    )
    result["data"]["sec"]["sourceMode"] = "FROZEN_OFFICIAL_IR_RELEASE_DATES"
    return result


v30.load_sec_events = load_frozen_ir_events
v30.analyze = analyze_with_frozen_ir_events


if __name__ == "__main__":
    raise SystemExit(v30.main())
