"""Independent Python V12 H2 signal port vs unmodified production TS pure functions.
No trading calls. Failure is fatal: signal counts alone do NOT prove parity.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import statistics
from collections import Counter
from pathlib import Path

HOUR = 3_600_000
H2 = 2 * HOUR
UNIVERSE = ("BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ",
            "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR")


def h2_rows(rows):
    by = {int(r["ts_ms"]): r for r in rows}
    if len(by) != len(rows):
        raise ValueError("DUPLICATE_H1")
    out = []
    for ts in sorted(by):
        if ts % H2:
            continue
        first, second = by[ts], by.get(ts + HOUR)
        if second is None:
            continue
        out.append({
            "ts": ts, "endTs": ts + H2,
            "open": float(first["open"]),
            "high": max(float(first["high"]), float(second["high"])),
            "low": min(float(first["low"]), float(second["low"])),
            "close": float(second["close"]),
            "volume": float(first["volume"]) + float(second["volume"]),
        })
    return out


def regime(b, i):
    if i < 53:
        return None
    close = b[i]["close"]
    avg = statistics.mean(x["close"] for x in b[i - 52:i + 1])
    distance = close / avg - 1
    momentum = close / b[i - 52]["close"] - 1
    if distance >= .02 and momentum > 0:
        return ("LONG", distance >= .0359)
    if distance <= -.02 and momentum < 0:
        return ("SHORT", distance <= -.0359)
    return ("NEUTRAL", False)


def features(b, i):
    if i < 45 or i < 31:
        return None
    cur = b[i]
    base = b[i - 45]
    momentum = cur["close"] / base["close"] - 1
    returns = [math.log(b[j]["close"] / b[j - 1]["close"]) for j in range(i - 14, i + 1)]
    volatility = statistics.stdev(returns)
    tr = [
        max(b[j]["high"] - b[j]["low"],
            abs(b[j]["high"] - b[j - 1]["close"]),
            abs(b[j]["low"] - b[j - 1]["close"]))
        for j in range(i - 30, i + 1)
    ]
    atr = statistics.mean(tr)
    volmean = statistics.mean(row["volume"] for row in b[i - 20:i])
    ratio = cur["volume"] / volmean if volmean > 0 else float("nan")
    if not all(math.isfinite(x) for x in (momentum, volatility, atr, ratio)):
        return None
    scale = max(.0001, volatility * math.sqrt(45))
    raw_score = momentum / scale / (1 + 2.3953 * volatility * 100)
    side = "LONG" if momentum >= 0 else "SHORT"
    return {
        "momentum": momentum, "volatility": volatility,
        "atr": atr, "volumeRatio": ratio,
        "score": raw_score if side == "LONG" else -raw_score,
        "side": side, "atrRatio": atr / cur["close"],
        "close": cur["close"],
    }


def eligible(f, r):
    name, strong = r
    if f["volumeRatio"] < .9845:
        return False
    if abs(f["momentum"]) < 6.0879 * 10 / 10000:
        return False
    if f["side"] == "LONG" and f["momentum"] < .0227:
        return False
    if f["side"] == "SHORT" and f["momentum"] > -.0227:
        return False
    if name == "NEUTRAL":
        return f["score"] >= 1.4649
    if name != f["side"]:
        return False
    if f["score"] >= 1.4649:
        return True
    if strong:
        return .15 <= f["score"] <= .70 and f["atrRatio"] >= .014
    aligned = f["momentum"] if f["side"] == "LONG" else -f["momentum"]
    return aligned >= .054 and f["atrRatio"] >= .014


def generate(bundle):
    panel = {s: h2_rows(bundle["bars"][s + "USDT"]) for s in UNIVERSE}
    btc = panel["BTC"]
    for s, rows in panel.items():
        if len(rows) != len(btc) or any(a["ts"] != b["ts"] for a, b in zip(rows, btc)):
            raise ValueError("CROSS_ASSET_H2_MISALIGNMENT:" + s)
    result = []
    for i in range(len(btc) - 1):
        r = regime(btc, i)
        if r is None:
            continue
        ranked = []
        for symbol in UNIVERSE:
            f = features(panel[symbol], i)
            if f is not None and eligible(f, r):
                ranked.append((symbol, f))
        ranked.sort(key=lambda pair: (-pair[1]["score"], pair[0]))
        selected = [(1, ranked[0])] if ranked else []
        if len(ranked) >= 2:
            selected.append((2, ranked[1]))
        third = next((pair for pair in ranked[2:] if pair[1]["score"] >= .70), None)
        if third:
            selected.append((3, third))
        for rank, (symbol, f) in selected:
            bar = panel[symbol][i]
            entry = panel[symbol][i + 1]
            if bar["endTs"] != entry["ts"]:
                raise ValueError("NON_NEXT_H2_BAR")
            stopdist = max(f["atr"] * 2.477, bar["close"] * .005)
            gross = min(.0319 / (stopdist / bar["close"]), 1.0, .1 if rank == 3 else 1.0)
            result.append({
                "positionId": f"v12:{symbol}USDT:{entry['ts']}:{rank}",
                "symbol": symbol + "USDT", "side": f["side"],
                "rank": rank, "score": f["score"], "momentum": f["momentum"],
                "volatility": f["volatility"], "volumeRatio": f["volumeRatio"],
                "atr": f["atr"], "regime": r[0], "signalClose": bar["close"],
                "signalTs": bar["endTs"] - 1, "entryTs": entry["ts"],
                "featureSourceTs": bar["endTs"] - 1,
                "requestedGross": gross,
                "hardStopPct": stopdist / bar["close"],
                "takeProfitPct": f["atr"] * 3.1995 / bar["close"],
                "trailingPct": f["atr"] * .4 / bar["close"],
                "maxHoldHours": 46,
            })
    return result, len(btc)


def compare(reference, native):
    if native.get("schema") != "v12-native-pure-signal-dump/v1":
        raise ValueError("UNEXPECTED_NATIVE_SCHEMA")
    got = native["signals"]
    if len(reference) != len(got):
        raise ValueError(f"V12_SIGNAL_COUNT_MISMATCH native={len(got)} python={len(reference)}")
    keys = ("positionId", "symbol", "side", "rank", "regime",
            "signalTs", "entryTs", "featureSourceTs", "maxHoldHours")
    numeric = ("score", "momentum", "volatility", "volumeRatio", "atr",
               "signalClose", "requestedGross", "hardStopPct", "takeProfitPct", "trailingPct")
    for index, (a, b) in enumerate(zip(reference, got)):
        for key in keys:
            if a[key] != b[key]:
                raise ValueError(f"V12_PARITY_FAILURE index={index} field={key} python={a[key]} native={b[key]}")
        for key in numeric:
            av, bv = float(a[key]), float(b[key])
            if not math.isclose(av, bv, rel_tol=2e-9, abs_tol=1e-10):
                raise ValueError(f"V12_PARITY_FAILURE index={index} field={key} python={av} native={bv}")
    return {
        "status": "V12_PURE_SIGNAL_CROSS_LANGUAGE_PARITY",
        "signals": len(got),
        "bySide": dict(Counter(row["side"] for row in got)),
        "byRank": dict(Counter(str(row["rank"]) for row in got)),
        "signalExecutionParity": False,
        "canonicalIntegratedBtParity": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with gzip.open(args.bundle, "rt", encoding="utf8") as stream:
        bundle = json.load(stream)
    reference, h2count = generate(bundle)
    native = json.loads(args.native.read_text(encoding="utf8"))
    report = compare(reference, native)
    report["h2Bars"] = h2count
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf8")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
