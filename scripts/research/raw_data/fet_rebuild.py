from __future__ import annotations

from datetime import datetime, timezone
from statistics import median
from typing import Any

from .models import Bar, coerce_bar

HOUR_MS = 3_600_000
FET_BRK48_ADAPTER_CONTRACT = {
    "lookbackHours": 48,
    "volumeMedianHours": 72,
    "minimumVolumeRatio": 1.2,
    "holdHours": 24,
    "hardStopPct": 0.05,
    "profitFloorTriggerPct": 0.05,
    "profitFloorStopPct": 0.005,
    "decisionEntryHourModulo": 4,
    "decisionEntryHourRemainder": 1,
    "maximumGross": 2.25,
}


def generate_fet_candidates(raw_bundle: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    """Use the Production BRK48 breakout/volume/UTC-window gates.

    Signals use only the last fully closed hourly candle and older bars.
    A successful candidate fills at the NEXT hour's open; actual Production
    quote/partial-fill/profit-floor mechanics still require independent parity.
    """
    rows = sorted((coerce_bar(raw) for raw in raw_bundle.get("bars", {}).get("FETUSDT", [])), key=lambda row: row.ts_ms)
    config = {**FET_BRK48_ADAPTER_CONTRACT, **raw_bundle.get("contracts", {}).get("FET", {})}
    lookback = int(config["lookbackHours"])
    volume_hours = int(config["volumeMedianHours"])
    minimum_ratio = float(config["minimumVolumeRatio"])
    maximum_gross = float(config["maximumGross"])
    candidates: list[dict[str, Any]] = []
    if min(lookback, volume_hours, maximum_gross) <= 0:
        raise ValueError("FET_INVALID_CONTRACT")
    for index in range(max(lookback, volume_hours), len(rows) - 1):
        signal = rows[index]
        next_bar = rows[index + 1]
        window = rows[index - max(lookback, volume_hours):index + 2]
        if any(right.ts_ms - left.ts_ms != HOUR_MS for left, right in zip(window, window[1:])):
            continue
        entry_hour = datetime.fromtimestamp(next_bar.ts_ms / 1000, timezone.utc).hour
        if entry_hour % int(config["decisionEntryHourModulo"]) != int(config["decisionEntryHourRemainder"]):
            continue
        prior48 = rows[index - lookback:index]
        prior72 = rows[index - volume_hours:index]
        prior_high = max(row.high for row in prior48)
        vol_median = median(row.volume for row in prior72)
        volume_ratio = signal.volume / vol_median if vol_median > 0 else 0.0
        if signal.close <= prior_high or volume_ratio + 1e-12 < minimum_ratio:
            continue
        candidates.append({
            "positionId": f"fet:{signal.ts_ms}",
            "strategyId": "FET_BRK48_RESIDUAL",
            "mode": mode,
            "symbol": "FETUSDT",
            "side": "LONG",
            "signalTs": signal.ts_ms,
            "entryTs": next_bar.ts_ms,
            "featureSourceTs": signal.ts_ms,
            "signalPriceAnchor": signal.close,
            "prior48hHigh": prior_high,
            "volumeMedian72h": vol_median,
            "volumeRatio": volume_ratio,
            "requestedGross": maximum_gross,
            "acceptedGross": maximum_gross,
            "hardStopPct": float(config["hardStopPct"]),
            "profitFloorTriggerPct": float(config["profitFloorTriggerPct"]),
            "profitFloorStopPct": float(config["profitFloorStopPct"]),
            "maxHoldHours": int(config["holdHours"]),
            "priority": 3,
            "preemptible": True,
            "adapterModel": "BRK48_CLOSED_BAR_NEXT_OPEN_NO_QUOTE_PARITY",
            "productionParity": False,
            "source": "raw-bars",
        })
    return candidates
