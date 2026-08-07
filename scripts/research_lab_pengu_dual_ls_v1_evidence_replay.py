from __future__ import annotations

import argparse
import bisect
import json
import math
import statistics
from pathlib import Path
from typing import Any

HOUR = 3_600_000
START = 1_755_043_200_000  # 2025-08-13T00:00:00Z
END = 1_785_715_200_000  # 2026-08-03T00:00:00Z
HOLDOUT_START = 1_773_187_200_000  # 2026-03-11T00:00:00Z
GROSS = 0.75
ONE_WAY_FEE_BPS = 6.0


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else math.nan


def metrics(trades: list[dict]) -> dict:
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    wins = 0
    gross_profit = 0.0
    gross_loss = 0.0
    for trade in trades:
        value = float(trade["returnAtRequestedGross"])
        equity *= 1.0 + value
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        if value > 0:
            wins += 1
            gross_profit += value
        elif value < 0:
            gross_loss += -value
    return {
        "trades": len(trades),
        "longs": sum(int(row["side"]) > 0 for row in trades),
        "shorts": sum(int(row["side"]) < 0 for row in trades),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "winRatePct": wins / len(trades) * 100.0 if trades else None,
        "profitFactor": gross_profit / gross_loss if gross_loss > 0 else None,
        "maxDrawdownPct": max_dd * 100.0,
        "averageReturnPctPerTrade": sum(float(row["returnAtRequestedGross"]) for row in trades) / len(trades) * 100.0 if trades else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-root", default=".pengu-evidence/reports/pengu-v46-repro/data")
    parser.add_argument("--output", default=".research-state/v96-v52-pengu-dual-ls-v1/pengu-evidence-replay.json")
    args = parser.parse_args()

    root = Path(args.evidence_root)
    pengu_raw = load_json(root / "PENGUUSDT-1h-2025-08-03_2026-08-03.json")
    btc_raw = load_json(root / "BTCUSDT-1h-2025-08-03_2026-08-03.json")
    funding_raw = load_json(root / "PENGUUSDT-funding-v3-2025-08-02_2026-08-03.json")

    pengu = sorted(
        [{"ts": int(row["ts"]), "open": float(row["open"]), "high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"]), "volume": float(row["volume"])} for row in pengu_raw],
        key=lambda row: row["ts"],
    )
    btc_by_ts = {
        int(row["ts"]): {"ts": int(row["ts"]), "open": float(row["open"]), "high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"]), "volume": float(row["volume"])}
        for row in btc_raw
    }
    pengu = [row for row in pengu if row["ts"] in btc_by_ts]
    btc = [btc_by_ts[row["ts"]] for row in pengu]
    if len(pengu) != 8761 or len(btc) != 8761:
        raise RuntimeError(f"Frozen evidence row mismatch PENGU={len(pengu)} BTC={len(btc)}")
    for index in range(1, len(pengu)):
        if pengu[index]["ts"] - pengu[index - 1]["ts"] != HOUR or btc[index]["ts"] != pengu[index]["ts"]:
            raise RuntimeError(f"Non-hourly/misaligned evidence at index {index}")

    funding = sorted(
        [(int(row["fundingTime"]), float(row["fundingRate"])) for row in funding_raw],
        key=lambda row: row[0],
    )
    funding_ts = [row[0] for row in funding]
    funding_rate = [row[1] for row in funding]

    tr: list[float] = []
    for index, row in enumerate(pengu):
        if index == 0:
            tr.append(row["high"] - row["low"])
        else:
            previous_close = pengu[index - 1]["close"]
            tr.append(max(row["high"] - row["low"], abs(row["high"] - previous_close), abs(row["low"] - previous_close)))

    atr14: list[float | None] = [None] * len(pengu)
    atr24_pct: list[float | None] = [None] * len(pengu)
    compression_ratio: list[float | None] = [None] * len(pengu)
    rsi14: list[float | None] = [None] * len(pengu)
    for index in range(len(pengu)):
        if index >= 13:
            atr14[index] = mean(tr[index - 13:index + 1])
        if index >= 23:
            atr24 = mean(tr[index - 23:index + 1])
            atr24_pct[index] = atr24 / pengu[index]["close"] * 100.0
        if index >= 14:
            gains = 0.0
            losses = 0.0
            for cursor in range(index - 13, index + 1):
                change = pengu[cursor]["close"] - pengu[cursor - 1]["close"]
                gains += max(0.0, change)
                losses += max(0.0, -change)
            if losses <= 0:
                rsi14[index] = 100.0 if gains > 0 else 50.0
            else:
                rsi14[index] = 100.0 - 100.0 / (1.0 + gains / losses)
        if atr24_pct[index] is not None:
            window = [value for value in atr24_pct[max(0, index - 119):index + 1] if value is not None]
            if window:
                baseline = statistics.median(window)
                if baseline > 0:
                    compression_ratio[index] = float(atr24_pct[index]) / baseline

    def momentum(rows: list[dict], index: int, hours: int) -> float | None:
        prior = index - hours
        if prior < 0 or rows[prior]["close"] <= 0:
            return None
        return (rows[index]["close"] / rows[prior]["close"] - 1.0) * 100.0

    def sma(rows: list[dict], index: int, length: int) -> float | None:
        if index - length + 1 < 0:
            return None
        return mean([row["close"] for row in rows[index - length + 1:index + 1]])

    def latest_funding(timestamp: int) -> float | None:
        cursor = bisect.bisect_right(funding_ts, timestamp) - 1
        return funding_rate[cursor] if cursor >= 0 else None

    def volume_ratio(index: int, floor_recent: int = 6, prior_hours: int = 42) -> float | None:
        # Accepted specification: last 6h average divided by the 42h average immediately before it.
        if index - floor_recent - prior_hours + 1 < 0:
            return None
        recent = [row["volume"] for row in pengu[index - floor_recent + 1:index + 1]]
        prior = [row["volume"] for row in pengu[index - floor_recent - prior_hours + 1:index - floor_recent + 1]]
        base = mean(prior)
        return mean(recent) / base if base > 0 else None

    feature_cache: dict[int, dict | None] = {}

    def features(index: int) -> dict | None:
        if index in feature_cache:
            return feature_cache[index]
        if index < 168 or index - 24 < 0 or atr14[index] is None or rsi14[index] is None:
            feature_cache[index] = None
            return None
        prior24 = pengu[index - 24:index]
        vr = volume_ratio(index)
        pm24 = momentum(pengu, index, 24)
        bm24 = momentum(btc, index, 24)
        bm72 = momentum(btc, index, 72)
        bsma168 = sma(btc, index, 168)
        if vr is None or pm24 is None or bm24 is None or bm72 is None or bsma168 is None:
            feature_cache[index] = None
            return None
        prior_high = max(row["high"] for row in prior24)
        prior_low = min(row["low"] for row in prior24)
        previous24_close = pengu[index - 24]["close"]
        denom = previous24_close - prior_low
        item = {
            "priorHigh": prior_high,
            "priorLow": prior_low,
            "range24Pct": (prior_high - prior_low) / pengu[index]["close"] * 100.0,
            "volumeRatio": vr,
            "penguMom24": pm24,
            "btcMom24": bm24,
            "btcMom72": bm72,
            "btcAboveSma168": btc[index]["close"] > bsma168,
            "rsi14": float(rsi14[index]),
            "funding": latest_funding(pengu[index]["ts"] + HOUR - 1),
            "shortDropPct": (previous24_close - prior_low) / previous24_close * 100.0 if previous24_close > 0 else 0.0,
            "shortRetracePct": (pengu[index]["close"] - prior_low) / denom * 100.0 if denom > 0 else 0.0,
            "shortBreak": pengu[index]["close"] < pengu[index - 1]["low"],
        }
        feature_cache[index] = item
        return item

    short_cache: dict[int, bool] = {}

    def short_condition(index: int) -> bool:
        if index in short_cache:
            return short_cache[index]
        f = features(index)
        value = bool(
            f
            and f["shortDropPct"] >= 4.0
            and f["shortRetracePct"] >= 25.0
            and f["shortRetracePct"] <= 55.0
            and f["shortBreak"]
            and f["volumeRatio"] >= 0.8
            and f["rsi14"] >= 20.0
            and f["rsi14"] <= 65.0
            and not (f["btcAboveSma168"] and f["btcMom72"] > 4.0)
        )
        short_cache[index] = value
        return value

    long_cache: dict[int, bool] = {}

    def long_condition(index: int) -> bool:
        if index in long_cache:
            return long_cache[index]
        f = features(index)
        compression_ok = index >= 6 and any(
            compression_ratio[cursor] is not None and float(compression_ratio[cursor]) <= 1.0
            for cursor in range(index - 6, index)
        )
        short_recent = any(short_condition(cursor) for cursor in range(max(0, index - 2), index + 1))
        value = bool(
            f
            and compression_ok
            and f["range24Pct"] <= 6.0
            and pengu[index]["close"] > f["priorHigh"] + float(atr14[index]) * 0.25
            and f["volumeRatio"] >= 1.0
            and f["penguMom24"] - f["btcMom24"] >= 0.0
            and f["btcMom24"] >= -3.0
            and f["rsi14"] <= 82.0
            and f["funding"] is not None
            and f["funding"] <= 0.0001
            and not short_recent
        )
        long_cache[index] = value
        return value

    def funding_return(side: int, entry_ts: int, exit_ts: int) -> float:
        lo = bisect.bisect_left(funding_ts, entry_ts)
        hi = bisect.bisect_left(funding_ts, exit_ts)
        total = sum(funding_rate[lo:hi])
        return -side * total

    trades: list[dict] = []
    position: dict | None = None
    diagnostics = {"longEdges": 0, "shortEdges": 0, "sameBarEdges": 0, "blockedLongSignals": 0, "blockedShortSignals": 0}

    for index, bar in enumerate(pengu):
        ts = int(bar["ts"])

        # Existing position is handled from the entry bar onward. Time stop is an open-price event.
        if position is not None and ts >= int(position["entryTs"]):
            due = int(position["entryTs"]) + 36 * HOUR
            exit_price: float | None = None
            exit_reason: str | None = None
            if ts >= due:
                exit_price = float(bar["open"])
                exit_reason = "LONG_MAX_HOLD" if int(position["side"]) > 0 else "SHORT_MAX_HOLD"
            elif int(position["side"]) > 0:
                initial_stop = float(position["entryPrice"]) * 0.94
                active_stop = initial_stop
                if bool(position["trailingActive"]):
                    active_stop = max(initial_stop, float(position["highWaterMark"]) * 0.97)
                if float(bar["open"]) <= active_stop:
                    exit_price = float(bar["open"])
                    exit_reason = "LONG_TRAILING_STOP" if bool(position["trailingActive"]) else "LONG_INITIAL_STOP"
                else:
                    high_water = max(float(position["highWaterMark"]), float(bar["high"]))
                    trailing_active = bool(position["trailingActive"]) or high_water >= float(position["entryPrice"]) * 1.06
                    position["highWaterMark"] = high_water
                    position["trailingActive"] = trailing_active
                    active_stop = max(initial_stop, high_water * 0.97) if trailing_active else initial_stop
                    if float(bar["low"]) <= active_stop:
                        exit_price = active_stop
                        exit_reason = "LONG_TRAILING_STOP" if trailing_active else "LONG_INITIAL_STOP"
            if exit_price is not None:
                side = int(position["side"])
                entry_price = float(position["entryPrice"])
                raw_unit_return = side * (exit_price / entry_price - 1.0)
                funding_unit_return = funding_return(side, int(position["entryTs"]), ts)
                fee_unit_return = -2.0 * ONE_WAY_FEE_BPS / 10_000.0
                net_unit_return = raw_unit_return + funding_unit_return + fee_unit_return
                trades.append({
                    "side": side,
                    "signalTs": int(position["signalTs"]),
                    "entryTs": int(position["entryTs"]),
                    "exitSignalTs": ts,
                    "exitTs": ts,
                    "entryPrice": entry_price,
                    "exitPrice": exit_price,
                    "requestedGross": GROSS,
                    "rawUnitReturn": raw_unit_return,
                    "fundingUnitReturn": funding_unit_return,
                    "feeUnitReturn": fee_unit_return,
                    "netUnitReturn": net_unit_return,
                    "returnAtRequestedGross": net_unit_return * GROSS,
                    "exitReason": exit_reason,
                })
                position = None

        if index < 1:
            continue
        long_now = long_condition(index)
        short_now = short_condition(index)
        long_edge = long_now and not long_condition(index - 1)
        short_edge = short_now and not short_condition(index - 1)
        if long_edge:
            diagnostics["longEdges"] += 1
        if short_edge:
            diagnostics["shortEdges"] += 1
        if long_edge and short_edge:
            diagnostics["sameBarEdges"] += 1

        entry_ts = ts + HOUR
        if not (START <= entry_ts < END):
            continue
        if position is not None:
            if long_edge:
                diagnostics["blockedLongSignals"] += 1
            if short_edge:
                diagnostics["blockedShortSignals"] += 1
            continue
        side = -1 if short_edge else (1 if long_edge else 0)
        if side == 0 or index + 1 >= len(pengu):
            continue
        entry_bar = pengu[index + 1]
        if int(entry_bar["ts"]) != entry_ts:
            raise RuntimeError(f"Missing next-open bar after {ts}")
        position = {
            "side": side,
            "signalTs": ts,
            "entryTs": entry_ts,
            "entryPrice": float(entry_bar["open"]),
            "highWaterMark": float(entry_bar["open"]),
            "trailingActive": False,
        }

    full = [row for row in trades if START <= int(row["entryTs"]) < END and int(row["exitTs"]) <= END]
    holdout = [row for row in full if int(row["entryTs"]) >= HOLDOUT_START]
    full_metrics = metrics(full)
    holdout_metrics = metrics(holdout)
    payload = {
        "version": 3,
        "strategyId": "PENGU_DUAL_LS_V1",
        "logicSource": "accepted user specification / frozen evidence",
        "dataSource": "Binance public spot H1 frozen at evidence commit + Aster V3 frozen funding",
        "evidenceCommit": "520b18285187573487d2dafa39d8d1e13f9d48cf",
        "period": {"startInclusive": "2025-08-13T00:00:00+00:00", "endExclusive": "2026-08-03T00:00:00+00:00", "holdoutStartInclusive": "2026-03-11T00:00:00+00:00"},
        "fixedRules": {"requestedGross": GROSS, "singlePositionSlot": True, "simultaneousLongShortAllowed": False, "shortPriorityOnSameBar": True, "holdHours": 36, "nextOpenExecution": True, "oneWayFeeBps": ONE_WAY_FEE_BPS, "slippageBps": 0},
        "data": {"btcH1": len(btc), "penguH1": len(pengu), "fundingPoints": len(funding), "commonH1": len(pengu)},
        "diagnostics": diagnostics,
        "fullMetrics": full_metrics,
        "holdoutMetrics": holdout_metrics,
        "trades": full,
        "integrity": {
            "chronological": all(index == 0 or int(row["entryTs"]) >= int(full[index - 1]["exitTs"]) for index, row in enumerate(full)),
            "noOverlap": all(index == 0 or int(row["entryTs"]) >= int(full[index - 1]["exitTs"]) for index, row in enumerate(full)),
            "maximumRequestedGross": max([0.0] + [float(row["requestedGross"]) for row in full]),
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"fullMetrics": full_metrics, "holdoutMetrics": holdout_metrics, "diagnostics": diagnostics, "integrity": payload["integrity"]}, indent=2))


if __name__ == "__main__":
    main()
