from __future__ import annotations

import datetime as dt
import json
import math
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

STATE = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
HISTORY = STATE / "aster-market-intelligence-v19" / "history"
OUT = STATE / "microstructure-strategy-v20"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT"]
BUCKET_MS = 5_000
MIN_ROBUST_HOURS = 720.0
MIN_ROBUST_DAYS = 30
NORMAL_FLOOR_BPS = 7.0
STRESS_FLOOR_BPS = 30.0


@dataclass(frozen=True)
class Variant:
    family: str
    variant_id: str
    hold_seconds: int
    mode: str
    threshold: float
    aux_threshold: float = 0.0


def f(v, default=0.0):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError):
        return default


def load_rows() -> List[dict]:
    rows: List[dict] = []
    if not HISTORY.exists():
        return rows
    for path in sorted(HISTORY.glob("*.ndjson")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    row = json.loads(line)
                    if row.get("symbol") in SYMBOLS and f(row.get("mid")) > 0:
                        rows.append(row)
                except Exception:
                    pass
    rows.sort(key=lambda r: (int(r.get("timestamp", 0)), str(r.get("symbol", ""))))
    return rows


def percentile(values: List[float], q: float) -> Optional[float]:
    values = sorted(x for x in values if math.isfinite(x))
    if not values:
        return None
    p = (len(values) - 1) * q
    lo, hi = math.floor(p), math.ceil(p)
    if lo == hi:
        return values[lo]
    w = p - lo
    return values[lo] * (1 - w) + values[hi] * w


def pf(values: Iterable[float]) -> Optional[float]:
    vals = list(values)
    wins = sum(x for x in vals if x > 0)
    losses = abs(sum(x for x in vals if x < 0))
    if losses > 1e-12:
        return wins / losses
    return 999.0 if wins > 0 else None


def metrics(trades: List[dict]) -> dict:
    vals = [t["netPct"] for t in trades]
    equity = peak = 1.0
    dd = 0.0
    for x in vals:
        equity *= max(0.001, 1 + x / 100)
        peak = max(peak, equity)
        dd = min(dd, (equity / peak - 1) * 100)
    compounded = (equity - 1) * 100
    positives = [x for x in vals if x > 0]
    best = max(positives) if positives else 0.0
    total_profit = sum(positives)
    best_share = best / total_profit * 100 if total_profit > 0 else 0.0
    ex_best = vals.copy()
    if best > 0:
        ex_best.remove(best)
    return {
        "trades": len(vals),
        "winRatePct": (sum(x > 0 for x in vals) / len(vals) * 100) if vals else 0.0,
        "returnPct": compounded,
        "profitFactor": pf(vals),
        "maxDrawdownPct": dd,
        "bestTradeProfitSharePct": best_share,
        "profitFactorWithoutBest": pf(ex_best),
        "meanTradePct": statistics.fmean(vals) if vals else 0.0,
    }


def day_split(rows: List[dict]) -> Dict[str, tuple[int, int]]:
    ts = sorted({int(r["timestamp"]) for r in rows})
    start, end = ts[0], ts[-1] + 1
    span = end - start
    # Frozen before Confirmation/Holdout: 40% Dev, 25% Val, 20% Confirmation, 15% Holdout.
    a = start + int(span * 0.40)
    b = start + int(span * 0.65)
    c = start + int(span * 0.85)
    return {"development": (start, a), "validation": (a, b), "confirmation": (b, c), "holdout": (c, end)}


def within(row: dict, period: tuple[int, int]) -> bool:
    t = int(row["timestamp"])
    return period[0] <= t < period[1]


def dev_quantiles(rows: List[dict], periods: Dict[str, tuple[int, int]]) -> dict:
    dev = [r for r in rows if within(r, periods["development"])]
    basis_abs = [abs(f(r.get("basisBps"))) for r in dev]
    liq_notional = [f(r.get("liquidationBuyNotional")) + f(r.get("liquidationSellNotional")) for r in dev]
    return {
        "basisP90Abs": percentile(basis_abs, 0.90) or 8.0,
        "basisP95Abs": percentile(basis_abs, 0.95) or 10.0,
        "liqP95": percentile(liq_notional, 0.95) or 0.0,
        "liqP99": percentile(liq_notional, 0.99) or 0.0,
    }


def variants(q: dict) -> List[Variant]:
    return [
        Variant("BASIS_DISLOCATION_REVERSAL", "BASIS_P90_H300", 300, "reversal", q["basisP90Abs"]),
        Variant("BASIS_DISLOCATION_REVERSAL", "BASIS_P95_H900", 900, "reversal", q["basisP95Abs"]),
        Variant("BOOK_FLOW_IMBALANCE", "BOOK_CONT_H60", 60, "continuation", 0.50, 0.25),
        Variant("BOOK_FLOW_IMBALANCE", "BOOK_REV_H300", 300, "reversal", 0.65, 0.35),
        Variant("LIQUIDATION_CASCADE", "LIQ_P95_REV_H300", 300, "reversal", q["liqP95"]),
        Variant("LIQUIDATION_CASCADE", "LIQ_P99_CONT_H60", 60, "continuation", q["liqP99"]),
    ]


def signal(row: dict, v: Variant) -> int:
    if v.family == "BASIS_DISLOCATION_REVERSAL":
        x = f(row.get("basisBps"))
        if abs(x) < v.threshold:
            return 0
        raw = 1 if x > 0 else -1
    elif v.family == "BOOK_FLOW_IMBALANCE":
        book = f(row.get("bookImbalance10Bps"))
        taker = f(row.get("takerImbalance"))
        if abs(book) < v.threshold or abs(taker) < v.aux_threshold or book * taker <= 0:
            return 0
        raw = 1 if book > 0 else -1
    else:
        buy = f(row.get("liquidationBuyNotional"))
        sell = f(row.get("liquidationSellNotional"))
        total = buy + sell
        if v.threshold <= 0 or total < v.threshold or total <= 0:
            return 0
        raw = 1 if buy > sell else -1
    return -raw if v.mode == "reversal" else raw


def simulate(symbol_rows: List[dict], v: Variant, period: tuple[int, int], stress: bool) -> List[dict]:
    rows = [r for r in symbol_rows if within(r, period)]
    rows.sort(key=lambda r: int(r["timestamp"]))
    by_ts = {int(r["timestamp"]): r for r in rows}
    hold_ms = v.hold_seconds * 1000
    cooldown_until = -1
    trades: List[dict] = []
    for row in rows:
        ts = int(row["timestamp"])
        if ts < cooldown_until:
            continue
        side = signal(row, v)
        if side == 0:
            continue
        # Require a genuinely continuous future bucket; never bridge gaps between collector runs.
        target = ts + hold_ms
        future = by_ts.get(target)
        if future is None:
            continue
        entry = f(row.get("mid"))
        exitp = f(future.get("mid"))
        if entry <= 0 or exitp <= 0:
            continue
        gross_pct = side * (exitp / entry - 1) * 100
        observed = f(row.get("roundTrip1000Bps"), NORMAL_FLOOR_BPS)
        normal_bps = max(NORMAL_FLOOR_BPS, observed)
        cost_bps = max(STRESS_FLOOR_BPS, normal_bps + 15.0) if stress else normal_bps
        # Funding is charged conservatively pro-rata using the observed 8h rate.
        funding_pct = side * f(row.get("fundingRate")) * (v.hold_seconds / 28_800) * 100
        net = gross_pct - cost_bps / 100 - funding_pct
        trades.append({"entryTs": ts, "exitTs": target, "symbol": row["symbol"], "side": side, "grossPct": gross_pct, "costBps": cost_bps, "netPct": net})
        cooldown_until = target
    return trades


def pooled(rows: List[dict], v: Variant, period: tuple[int, int], stress: bool) -> List[dict]:
    out: List[dict] = []
    for symbol in SYMBOLS:
        out.extend(simulate([r for r in rows if r["symbol"] == symbol], v, period, stress))
    return sorted(out, key=lambda t: t["entryTs"])


def gate(m: dict, stress=False, min_trades=20) -> bool:
    if m["trades"] < min_trades:
        return False
    target_pf = 1.0 if stress else 1.20
    return (
        (m["profitFactor"] or 0) >= target_pf
        and m["returnPct"] > 0
        and m["maxDrawdownPct"] > -20
        and m["bestTradeProfitSharePct"] < 35
        and (m["profitFactorWithoutBest"] or 0) >= 1.0
    )


def main() -> None:
    rows = load_rows()
    OUT.mkdir(parents=True, exist_ok=True)
    if not rows:
        result = {"status": "NO_V19_HISTORY", "robustCandidate": None, "productionChanged": False, "realTradingEnabled": False}
    else:
        periods = day_split(rows)
        timestamps = [int(r["timestamp"]) for r in rows]
        observation_hours = (max(timestamps) - min(timestamps)) / 3_600_000
        observation_days = len({dt.datetime.fromtimestamp(t/1000, tz=dt.timezone.utc).date().isoformat() for t in timestamps})
        q = dev_quantiles(rows, periods)
        family_results: Dict[str, list] = {}
        for v in variants(q):
            normal = {name: metrics(pooled(rows, v, period, False)) for name, period in periods.items()}
            stress = {name: metrics(pooled(rows, v, period, True)) for name, period in periods.items()}
            family_results.setdefault(v.family, []).append({"variant": v.__dict__, "normal": normal, "stress": stress})

        selected: Dict[str, Optional[dict]] = {}
        for family, items in family_results.items():
            # Selection is Development-only. Validation/Confirmation/Holdout never influence variant choice.
            eligible = [x for x in items if gate(x["normal"]["development"]) and gate(x["stress"]["development"], stress=True)]
            eligible.sort(key=lambda x: (x["normal"]["development"]["profitFactor"] or 0, x["normal"]["development"]["returnPct"]), reverse=True)
            selected[family] = eligible[0] if eligible else None

        robust_candidate = None
        robust_data_ready = observation_hours >= MIN_ROBUST_HOURS and observation_days >= MIN_ROBUST_DAYS
        if robust_data_ready:
            for family, item in selected.items():
                if not item:
                    continue
                if all(gate(item["normal"][p]) for p in ["validation", "confirmation", "holdout"]) and all(gate(item["stress"][p], stress=True) for p in ["validation", "confirmation", "holdout"]):
                    robust_candidate = {"family": family, **item}
                    break
        status = "ROBUST_MICROSTRUCTURE_CANDIDATE" if robust_candidate else ("MICROSTRUCTURE_ROBUST_GATE_PENDING_30D" if not robust_data_ready else "NO_ROBUST_IMPROVEMENT")
        result = {
            "version": 20,
            "strategyId": "MICROSTRUCTURE_STRATEGY_V20",
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "status": status,
            "coverage": {"observationHours": observation_hours, "calendarDays": observation_days, "rows": len(rows), "robustDataReady": robust_data_ready},
            "periods": periods,
            "developmentOnlyThresholds": q,
            "openInterestFamily": {"status": "UNAVAILABLE", "reason": "V19 public OI proxy produced no valid observations; no synthetic OI data used."},
            "families": family_results,
            "selectedDevelopmentOnly": selected,
            "robustCandidate": robust_candidate,
            "rules": {"normalPf": 1.20, "stressPf": 1.0, "maxDdPct": -20, "bestTradeProfitSharePctMax": 35, "minimumRobustObservationHours": MIN_ROBUST_HOURS, "minimumRobustCalendarDays": MIN_ROBUST_DAYS},
            "productionChanged": False,
            "realTradingEnabled": False,
            "limitations": [
                "Public Aster market data only; no API key, orders, account or position access.",
                "Collector history is discontinuous; trades require an exact future 5-second bucket and never bridge collection gaps.",
                "OI expansion family is not tested because valid public OI observations are unavailable.",
                "Threshold quantiles and family selection use Development only; Confirmation/Holdout are never used for retuning.",
                "No candidate may be called robust before 30 calendar days / 720 observation-span hours are present.",
            ],
        }
    (OUT / "microstructure-strategy-v20.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    cov = result.get("coverage", {})
    lines = ["# Microstructure Strategy V20", "", f"- Status: **{result['status']}**", f"- Observation span: {cov.get('observationHours')} hours", f"- Calendar days represented: {cov.get('calendarDays')}", f"- Rows: {cov.get('rows')}", "- Production changed: NO", "- Real trading: DISABLED", "", "## Family status"]
    if "selectedDevelopmentOnly" in result:
        for family, item in result["selectedDevelopmentOnly"].items():
            lines.append(f"- {family}: {'Development candidate frozen' if item else 'No Development candidate'}")
    lines.extend(["", "## Verdict", "", "A result is robust only after 30 days and after the Development-frozen candidate passes Validation, Confirmation and untouched Holdout under Normal and Stress costs."])
    (OUT / "microstructure-strategy-v20.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
