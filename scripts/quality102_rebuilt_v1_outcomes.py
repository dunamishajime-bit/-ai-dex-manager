from __future__ import annotations

from typing import Any, Mapping, Sequence

HOUR_MS = 3_600_000
STOP_PCT = 0.08
TRAIL_ACTIVATE_PCT = 0.12
TRAIL_PCT = 0.05


def _normalized_rows(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, float | int]]:
    out: list[dict[str, float | int]] = []
    for raw in rows:
        if not all(key in raw for key in ("ts", "open", "high", "low", "close")):
            continue
        out.append(
            {
                "ts": int(raw["ts"]),
                "open": float(raw["open"]),
                "high": float(raw["high"]),
                "low": float(raw["low"]),
                "close": float(raw["close"]),
            }
        )
    out.sort(key=lambda row: int(row["ts"]))
    return out


def materialize_supplement_rows(
    selected: Sequence[Mapping[str, Any]],
    symbol_bars: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    end_ms: int,
    normal_cost_bps: float = 20.0,
    stress_cost_bps: float = 60.0,
) -> list[dict[str, Any]]:
    """Calculate outcomes only after candidate selection is fixed.

    Signal selection never calls this function. Intrabar ambiguity is handled
    conservatively: the hard stop is checked before the trailing exit, and a
    newly observed high cannot arm and hit the trailing stop within that same
    bar because the trail uses the peak known before the current bar.
    """
    if normal_cost_bps < 0.0:
        raise ValueError("normal_cost_bps must be nonnegative")
    if stress_cost_bps < normal_cost_bps:
        raise ValueError("stress_cost_bps must be >= normal_cost_bps")

    prepared = {
        str(symbol).upper(): _normalized_rows(rows)
        for symbol, rows in symbol_bars.items()
    }
    out: list[dict[str, Any]] = []

    for raw_candidate in selected:
        candidate = dict(raw_candidate)
        symbol = str(candidate["symbol"]).upper()
        rows = prepared.get(symbol, [])
        entry_ms = int(candidate["entry_ms"])
        entry_index = next(
            (index for index, row in enumerate(rows) if int(row["ts"]) == entry_ms),
            None,
        )
        if entry_index is None:
            continue

        entry_price = float(rows[entry_index]["close"])
        if entry_price <= 0.0:
            continue
        deadline = min(
            int(end_ms),
            entry_ms + int(candidate["hold_hours"]) * HOUR_MS,
        )
        if deadline <= entry_ms:
            continue

        peak = entry_price
        exit_row: dict[str, float | int] | None = None
        exit_price: float | None = None
        exit_reason: str | None = None

        for row in rows[entry_index + 1 :]:
            row_ts = int(row["ts"])
            if row_ts > deadline:
                break

            stop_price = entry_price * (1.0 - STOP_PCT)
            if float(row["low"]) <= stop_price:
                exit_row = row
                exit_price = stop_price
                exit_reason = "STOP_8PCT"
                break

            if peak >= entry_price * (1.0 + TRAIL_ACTIVATE_PCT):
                trail_price = peak * (1.0 - TRAIL_PCT)
                if float(row["low"]) <= trail_price:
                    exit_row = row
                    exit_price = trail_price
                    exit_reason = "TRAIL_5PCT_AFTER_12PCT"
                    break

            peak = max(peak, float(row["high"]))
            exit_row = row

        if exit_reason is None:
            # A TIME exit is accepted only if a bar exists at the requested
            # deadline. Otherwise the trade is not closed inside the BT window.
            if exit_row is None or int(exit_row["ts"]) < deadline:
                continue
            exit_price = float(exit_row["close"])
            exit_reason = "TIME"

        assert exit_price is not None and exit_row is not None
        gross_return = exit_price / entry_price - 1.0
        normal_net = gross_return - normal_cost_bps / 10_000.0
        stress_net = gross_return - stress_cost_bps / 10_000.0
        exit_ms = int(exit_row["ts"])

        out.append(
            {
                **candidate,
                "exit_ms": exit_ms,
                "entry_price": entry_price,
                "exit_price": float(exit_price),
                "gross_return": gross_return,
                "normal_net": normal_net,
                "stress_net": stress_net,
                "exit_reason": exit_reason,
                "duration_hours": (exit_ms - entry_ms) / HOUR_MS,
            }
        )

    return out
