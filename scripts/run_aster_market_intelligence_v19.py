from __future__ import annotations

from typing import Optional, Tuple

import research_lab_aster_market_intelligence_v19 as v19


_original_oi_snapshot = v19.oi_snapshot


def oi_snapshot_with_fallback(symbol: str) -> Tuple[Optional[float], Optional[str]]:
    value, source = _original_oi_snapshot(symbol)
    if value is not None:
        return value, source
    try:
        payload = v19.fetch_json(
            "https://api.bybit.com",
            "/v5/market/open-interest",
            {
                "category": "linear",
                "symbol": symbol,
                "intervalTime": "5min",
                "limit": 1,
            },
        )
        result = payload.get("result", {}) if isinstance(payload, dict) else {}
        rows = result.get("list", []) if isinstance(result, dict) else []
        latest = rows[0] if rows else {}
        fallback = v19.safe_float(latest.get("openInterest")) if isinstance(latest, dict) else 0.0
        if fallback > 0:
            return fallback, "BYBIT_LINEAR_PROXY"
        return None, f"{source}|BYBIT_EMPTY"
    except Exception as error:
        return None, f"{source}|BYBIT_UNAVAILABLE:{type(error).__name__}"


v19.oi_snapshot = oi_snapshot_with_fallback


if __name__ == "__main__":
    v19.main()
