"""Independent, source-labelled integrated BT reconstruction.

This module intentionally does not claim canonical-anchor parity.  It merges the
available causal/research ledgers on one UTC timeline and applies the current
portfolio gross contract, deposits, compounding, FET preemption, and the
selected PENGU Q60/DD17/H72 state machine.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

UTC = timezone.utc
START = datetime(2025, 8, 10, tzinfo=UTC)
END = datetime(2026, 8, 10, tzinfo=UTC)
INITIAL = 10_000.0
MONTHLY = 10_000.0
MONTHS = 12


def ts(value: Any) -> datetime:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value) / 1000.0, tz=UTC)
    text = str(value).replace("/", "-").replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def millis(value: Any) -> int:
    return int(ts(value).timestamp() * 1000)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class Trade:
    strategy: str
    symbol: str
    route: str
    side: str
    entry_ts: int
    exit_ts: int
    unit_return: float
    requested_gross: float
    source: str
    exit_reason: str = "SOURCE"


@dataclass
class Position:
    id: str
    trade: Trade
    gross: float


def load_v12(path: Path, mode: str) -> list[Trade]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    source_mode = "normal" if mode == "NORMAL" else "stress"
    rows = payload["modes"][source_mode]["trades"]
    result = []
    for index, row in enumerate(rows):
        requested = float(row.get("requestedGross", 1.0))
        result.append(Trade(
            "V12", str(row["symbol"]), f"RANK_{row.get('rank', 'UNKNOWN')}",
            str(row.get("side", "long")).upper(), millis(row["entryTs"]), millis(row["exitTs"]),
            float(row["accountReturn"]) / max(requested, 1e-12), min(1.0, requested),
            f"V12:{path.name}", str(row.get("exitReason", "SOURCE")),
        ))
    return result


def load_pengu(path: Path, mode: str) -> list[Trade]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload["selectedLedgers"]["FORMAL"][mode]
    result = []
    for row in rows:
        if row.get("variant") != "Q60_DD170_H72":
            raise ValueError("PENGU_VARIANT_NOT_Q60_DD170_H72")
        if abs(float(row["gross"]) - 1.0) > 1e-12:
            raise ValueError("PENGU_ENTRY_GROSS_NOT_ONE")
        result.append(Trade(
            "PENGU", "PENGUUSDT", str(row["route"]), str(row["side"]),
            millis(row["entryTs"]), millis(row["exitTs"]), float(row["accountReturn"]), 1.0,
            f"PENGU:{path.name}", str(row.get("exitReason", "SOURCE")),
        ))
    return result


def load_q102(path: Path, mode: str) -> list[Trade]:
    base = {"HIGH_VOL": 1.661, "MR": 1.0, "BRK": 2.465, "REV": 2.5, "PB": 2.5}
    result = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            entry, exit_ = millis(row["entry"]), millis(row["exit"])
            if not (int(START.timestamp() * 1000) <= entry < int(END.timestamp() * 1000)):
                continue
            family = row.get("family") or row.get("layer") or "UNKNOWN"
            result.append(Trade(
                "Q102", str(row["symbol"]), str(row.get("variant") or family),
                "LONG" if int(float(row.get("side", "1"))) > 0 else "SHORT", entry, exit_,
                float(row["normal_net"] if mode == "NORMAL" else row["stress_net"]),
                min(3.0, base.get(family, 1.0)), f"Q102:{path.name}", row.get("exit_reason", "SOURCE"),
            ))
    return result


def load_fet(path: Path, mode: str) -> list[Trade]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    result = []
    for row in payload["trades"]:
        entry = millis(row["entry"])
        if not (int(START.timestamp() * 1000) <= entry < int(END.timestamp() * 1000)):
            continue
        result.append(Trade(
            "FET", "FETUSDT", "BRK48_LONG", "LONG", entry, millis(row["exit"]),
            float(row["normal"] if mode == "NORMAL" else row["stress"]), 2.25,
            f"FET:{path.name}", row.get("reason", "SOURCE"),
        ))
    return result


def load_stock(path: Path, mode: str, cost_bps: float = 40.0) -> list[Trade]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    result = []
    for group, route in (("v11", "V11_EQ"), ("v50", "V50_POST_OPEN_BASIS")):
        for row in payload[group]:
            entry = millis(row["entryTs"])
            if not (int(START.timestamp() * 1000) <= entry < int(END.timestamp() * 1000)):
                continue
            gross_return = float(row["grossReturn"])
            # The stock source ledger is gross-return based; apply the selected
            # round-trip scenario here exactly once, then scale by slot gross.
            unit_return = gross_return - cost_bps / 10_000.0
            result.append(Trade(
                "V52", str(row["symbol"]), route, "LONG" if int(row.get("side", 1)) > 0 else "SHORT",
                entry, millis(row["exitTs"]), unit_return, 2.0, f"V52:{path.name}", row.get("exitReason", "SOURCE"),
            ))
    return result


def deposits() -> list[tuple[int, float]]:
    result = [(int(START.timestamp() * 1000), INITIAL)]
    for offset in range(1, MONTHS + 1):
        date = START
        month = date.month - 1 + offset
        year, month0 = date.year + month // 12, month % 12
        day = min(date.day, [31, 29 if year % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month0 - 1])
        due = datetime(year, month0 + 1, day, tzinfo=UTC)
        if due <= END:
            result.append((int(due.timestamp() * 1000), MONTHLY))
    return result


def group(strategy: str) -> str:
    return "STOCK" if strategy == "V52" else "CRYPTO"


def is_gross_conflict(
    *, strategy: str, crypto_after: float, total_after: float,
    crypto_cap: float, total_cap: float,
) -> bool:
    """Check the cap relevant to the newly accepted sleeve.

    Stock entries consume Total Gross but do not consume Crypto Gross.  The
    previous inline check compared every entry against both caps and therefore
    misreported a stock-only crypto-cap crossing as a portfolio conflict.
    """
    if total_after > total_cap + 1e-9:
        return True
    return group(strategy) == "CRYPTO" and crypto_after > crypto_cap + 1e-9


def run(mode: str, sources: dict[str, Path]) -> dict[str, Any]:
    trades: list[Trade] = []
    trades.extend(load_v12(sources["v12"], mode))
    trades.extend(load_pengu(sources["pengu"], mode))
    trades.extend(load_q102(sources["q102"], mode))
    trades.extend(load_fet(sources["fet"], mode))
    trades.extend(load_stock(sources["stock"], mode, 40.0 if mode == "NORMAL" else 100.0))
    priority = {"V52": 1, "PENGU": 2, "V12": 3, "Q102": 4, "FET": 5}
    trades.sort(key=lambda t: (t.entry_ts, priority[t.strategy], t.symbol, t.route))

    equity = INITIAL
    contributed = INITIAL
    growth_index = 1.0
    growth_peak = 1.0
    max_dd = 0.0
    peak_ts = int(START.timestamp() * 1000)
    trough_ts = peak_ts
    active: list[Position] = []
    deposits_seen = deposits()
    deposit_index = 1
    history: list[tuple[int, float]] = [(deposits_seen[0][0], equity)]
    events: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    preemptions = 0
    gross_conflicts = 0
    accepted_pengu: list[Trade] = []
    route_until: dict[str, int] = {}
    pengu_growth = 1.0
    pengu_peak = 1.0
    pengu_pause_until = 0
    by_strategy: dict[str, dict[str, float]] = {}

    def current_caps() -> tuple[float, float, str]:
        dd = growth_index / max(growth_peak, 1e-12) - 1.0
        if growth_index >= 1.30 and dd >= -0.005:
            return 5.0, 8.0, "PROFIT_4"
        if growth_index >= 1.20 and dd >= -0.01:
            return 4.0, 7.0, "PROFIT_3"
        if growth_index >= 1.10 and dd >= -0.02:
            return 3.5, 6.0, "PROFIT_2"
        if growth_index >= 1.05 and dd >= -0.03:
            return 3.25, 5.0, "PROFIT_1"
        return 3.0, 4.25, "BASE"

    def active_gross(which: str | None = None) -> float:
        return sum(p.gross for p in active if which is None or group(p.trade.strategy) == which)

    def settle(until: int) -> None:
        nonlocal equity, growth_index, growth_peak, max_dd, peak_ts, trough_ts, pengu_growth, pengu_peak, pengu_pause_until
        due = [p for p in active if p.trade.exit_ts <= until]
        for position in sorted(due, key=lambda p: (p.trade.exit_ts, p.id)):
            active.remove(position)
            pnl = position.gross * position.trade.unit_return
            before = equity
            equity *= max(0.000001, 1.0 + pnl)
            growth_index *= max(0.000001, 1.0 + pnl)
            growth_peak = max(growth_peak, growth_index)
            dd = growth_index / max(growth_peak, 1e-12) - 1.0
            if dd < max_dd:
                max_dd, peak_ts, trough_ts = dd, position.trade.entry_ts, position.trade.exit_ts
            if position.trade.strategy == "PENGU":
                pengu_growth *= max(0.000001, 1.0 + pnl)
                pengu_peak = max(pengu_peak, pengu_growth)
                if pengu_growth / max(pengu_peak, 1e-12) - 1.0 <= -0.17:
                    pengu_pause_until = max(pengu_pause_until, position.trade.exit_ts + 72 * 3_600_000)
                if "HARD" in position.trade.exit_reason.upper() or "STOP" in position.trade.exit_reason.upper():
                    route_until[position.trade.route] = max(route_until.get(position.trade.route, 0), position.trade.exit_ts + 60 * 3_600_000)
            stat = by_strategy.setdefault(position.trade.strategy, {"pnl": 0.0, "trades": 0.0, "gross": 0.0})
            stat["pnl"] += equity - before
            history.append((position.trade.exit_ts, equity))
            events.append({"kind": "EXIT", "ts": position.trade.exit_ts, "strategy": position.trade.strategy, "symbol": position.trade.symbol, "positionId": position.id, "gross": position.gross, "pnl": equity - before, "reason": position.trade.exit_reason})

    for trade in trades:
        while deposit_index < len(deposits_seen) and deposits_seen[deposit_index][0] <= trade.entry_ts:
            due_ts, amount = deposits_seen[deposit_index]
            equity += amount
            contributed += amount
            history.append((due_ts, equity))
            events.append({"kind": "DEPOSIT", "ts": due_ts, "amount": amount})
            deposit_index += 1
        settle(trade.entry_ts)
        crypto_cap, total_cap, tier = current_caps()
        stock_used, crypto_used, total_used = active_gross("STOCK"), active_gross("CRYPTO"), active_gross()
        if trade.strategy == "Q102" and growth_index >= 1.0 and growth_index / max(growth_peak, 1e-12) - 1.0 >= -0.003:
            requested = 3.0
        elif trade.strategy == "V12":
            requested = min(1.0, trade.requested_gross)
        else:
            requested = trade.requested_gross
        if trade.strategy == "PENGU":
            if trade.entry_ts < route_until.get(trade.route, 0) or trade.entry_ts < pengu_pause_until:
                rejected.append({"strategy": "PENGU", "ts": trade.entry_ts, "reason": "PENGU_GOVERNOR"})
                continue
            if any(p.trade.strategy == "PENGU" for p in active):
                rejected.append({"strategy": "PENGU", "ts": trade.entry_ts, "reason": "PENGU_SLOT_OCCUPIED"})
                continue
        if trade.strategy in {"V12", "PENGU", "FET"} and any(p.trade.strategy == trade.strategy and p.trade.symbol == trade.symbol for p in active):
            rejected.append({"strategy": trade.strategy, "ts": trade.entry_ts, "reason": "SAME_SYMBOL_ACTIVE"})
            continue
        if trade.strategy == "Q102" and any(p.trade.strategy == "Q102" for p in active):
            rejected.append({"strategy": "Q102", "ts": trade.entry_ts, "reason": "Q102_ONE_SLOT"})
            continue
        if trade.strategy == "V12" and sum(p.trade.strategy == "V12" for p in active) >= 3:
            rejected.append({"strategy": "V12", "ts": trade.entry_ts, "reason": "V12_THREE_SLOTS"})
            continue
        if trade.strategy == "V52" and sum(p.trade.strategy == "V52" for p in active) >= 2:
            rejected.append({"strategy": "V52", "ts": trade.entry_ts, "reason": "V52_TWO_SLOTS"})
            continue
        needs_crypto = group(trade.strategy) == "CRYPTO" and crypto_used + requested > crypto_cap + 1e-12
        needs_total = total_used + requested > total_cap + 1e-12
        if (needs_crypto or needs_total) and trade.strategy in {"V12", "PENGU", "Q102"}:
            fet_positions = [p for p in active if p.trade.strategy == "FET"]
            for position in fet_positions:
                active.remove(position)
                preemptions += 1
                events.append({"kind": "FET_PREEMPT", "ts": trade.entry_ts, "positionId": position.id, "releasedGross": position.gross})
            stock_used, crypto_used, total_used = active_gross("STOCK"), active_gross("CRYPTO"), active_gross()
            needs_crypto = group(trade.strategy) == "CRYPTO" and crypto_used + requested > crypto_cap + 1e-12
            needs_total = total_used + requested > total_cap + 1e-12
        if (needs_crypto or needs_total or (trade.strategy == "V52" and stock_used + requested > 4.0 + 1e-12)):
            rejected.append({"strategy": trade.strategy, "ts": trade.entry_ts, "reason": "SHARED_GROSS_CAP", "requestedGross": requested, "cryptoUsed": crypto_used, "totalUsed": total_used, "cryptoCap": crypto_cap, "totalCap": total_cap})
            continue
        position = Position(f"{trade.strategy}:{trade.symbol}:{trade.entry_ts}:{len(events)}", trade, requested)
        active.append(position)
        accepted_pengu.append(trade) if trade.strategy == "PENGU" else None
        stat = by_strategy.setdefault(trade.strategy, {"pnl": 0.0, "trades": 0.0, "gross": 0.0})
        stat["trades"] += 1
        stat["gross"] = max(stat["gross"], requested)
        crypto_after, total_after = active_gross("CRYPTO"), active_gross()
        if is_gross_conflict(
            strategy=trade.strategy,
            crypto_after=crypto_after,
            total_after=total_after,
            crypto_cap=crypto_cap,
            total_cap=total_cap,
        ):
            gross_conflicts += 1
        events.append({"kind": "ENTRY", "ts": trade.entry_ts, "strategy": trade.strategy, "symbol": trade.symbol, "positionId": position.id, "gross": requested, "tier": tier, "cryptoGross": crypto_after, "totalGross": total_after})

    while deposit_index < len(deposits_seen) and deposits_seen[deposit_index][0] <= int(END.timestamp() * 1000):
        due_ts, amount = deposits_seen[deposit_index]
        settle(due_ts)
        equity += amount
        contributed += amount
        history.append((due_ts, equity))
        events.append({"kind": "DEPOSIT", "ts": due_ts, "amount": amount})
        deposit_index += 1
    settle(int(END.timestamp() * 1000))

    if active:
        for position in list(active):
            active.remove(position)
            events.append({"kind": "OPEN_AT_END", "ts": int(END.timestamp() * 1000), "strategy": position.trade.strategy, "positionId": position.id, "gross": position.gross})

    pnl_values = [float(e["pnl"]) for e in events if e["kind"] == "EXIT"]
    gross_profit = sum(v for v in pnl_values if v > 0)
    gross_loss = -sum(v for v in pnl_values if v < 0)
    monthly = []
    for index in range(12):
        month = START.month - 1 + index
        year = START.year + month // 12
        month0 = month % 12 + 1
        end_of_month = datetime(year + (1 if month0 == 12 else 0), 1 if month0 == 12 else month0 + 1, 1, tzinfo=UTC) - timedelta(milliseconds=1)
        points = [value for when, value in history if when <= int(end_of_month.timestamp() * 1000)]
        monthly.append({"month": f"{year:04d}-{month0:02d}", "equity": points[-1] if points else INITIAL})

    return {
        "mode": mode,
        "period": {"startInclusive": START.isoformat(), "endExclusive": END.isoformat()},
        "capital": {"initialJpy": INITIAL, "monthlyJpy": MONTHLY, "monthlyCount": MONTHS, "totalContributedJpy": contributed, "compounding": True},
        "endingEquityJpy": equity,
        "returnOnContributionsPct": (equity / contributed - 1.0) * 100.0,
        "profitFactor": gross_profit / gross_loss if gross_loss else None,
        "maxDrawdownPct": max_dd * 100.0,
        "acceptedTrades": sum(1 for e in events if e["kind"] == "ENTRY"),
        "acceptedPenguTrades": len(accepted_pengu),
        "rejectedEntries": len(rejected),
        "rejectedByReason": {reason: sum(1 for row in rejected if row["reason"] == reason) for reason in sorted({row["reason"] for row in rejected})},
        "grossConflicts": gross_conflicts,
        "fetPreemptions": preemptions,
        "byStrategy": by_strategy,
        "monthlyEquity": monthly,
        "events": sorted(events, key=lambda row: (row["ts"], row["kind"], row.get("strategy", ""))),
        "sources": {name: {"path": str(path), "sha256": sha256_file(path)} for name, path in sources.items()},
        "assumptions": {
            "independentReconstruction": True,
            "canonicalParity": False,
            "v12Input": "recovered V12 Top2 ledger because canonical Top3 ledger is unavailable",
            "q102Input": "recovered causal-quality CSV; accepted as event source, not canonical anchor proof",
            "stockCostBps": {"NORMAL": 40, "SEVERE": 100},
            "entryTieBreak": "settle exits/deposits, then V52, PENGU, V12, Q102, FET",
            "fetPreemption": "preempted FET releases gross; no synthetic order and no forced market execution",
            "pynuQ60State": "Q60/DD17/H72 state updates only on accepted PENGU entries and exits",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--v12", type=Path, required=True)
    parser.add_argument("--pengu", type=Path, required=True)
    parser.add_argument("--q102", type=Path, required=True)
    parser.add_argument("--fet", type=Path, required=True)
    parser.add_argument("--stock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sources = {name: getattr(args, name) for name in ("v12", "pengu", "q102", "fet", "stock")}
    output = {mode: run(mode, sources) for mode in ("NORMAL", "SEVERE")}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for mode, result in output.items():
        print(json.dumps({k: result[k] for k in ("mode", "endingEquityJpy", "returnOnContributionsPct", "profitFactor", "maxDrawdownPct", "acceptedTrades", "acceptedPenguTrades", "grossConflicts", "fetPreemptions")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
