from __future__ import annotations

"""Research-only reconstruction of the Quality102 S1/S2 HIGH_VOL family.

This module intentionally does NOT claim provenance parity with the missing original
raw generator. It reconstructs the documented causal feature/gating contract and
can test whether known frozen S1/S2 signals are contained in the recovered grid.
It has no order/exchange execution path.
"""

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
import argparse
import csv
import io
import json
import math
import statistics
import urllib.request
import zipfile

RESEARCH_ONLY = True
ORIGINAL_RAW_GENERATOR_PROVEN = False
SOURCE_SPEC_COMMIT = "5eab6473ba253e04631fb0745cb56528ceef3201"
SOURCE_FIXTURE_RUN = "33404708902"
SOURCE_FIXTURE_ARTIFACT_ID = "9762776073"
RSI_METHOD = "WILDER_RMA_RECONSTRUCTION_ASSUMPTION"
ATR_METHOD = "WILDER_RMA_RECONSTRUCTION_ASSUMPTION"

LONG_DROPS = (0.08, 0.10, 0.12, 0.15)
LONG_RSIS = (30.0, 35.0, 40.0)
SHORT_RALLIES = (0.05, 0.08, 0.10, 0.12)
SHORT_RSIS = (55.0, 60.0, 65.0)
HARD_STOPS = (0.10, 0.15)


@dataclass(frozen=True)
class Bar:
    ts_ms: int
    open: float
    high: float
    low: float
    close: float
    quote_volume: float


@dataclass(frozen=True)
class FeatureSnapshot:
    signal_ts_ms: int
    ret24: float
    ret14d: float
    rsi14: float
    atr14: float
    atr_pct: float
    volume_ratio: float
    bar_up: bool
    bar_down: bool


@dataclass(frozen=True)
class SignalRule:
    side: int
    move: float
    rsi: float
    hard_stop: float


@dataclass(frozen=True)
class FixtureCheck:
    layer: str
    symbol: str
    signal_timestamp_ms: int
    entry_timestamp_ms: int
    side: int
    matched_rule_count: int
    market_valid: bool
    ret24: float | None
    ret14d: float | None
    rsi14: float | None
    atr_pct: float | None
    volume_ratio: float | None
    error: str | None = None


def _finite_positive_bar(b: Bar) -> None:
    vals = (b.open, b.high, b.low, b.close, b.quote_volume)
    if not all(math.isfinite(v) for v in vals):
        raise ValueError(f"non-finite bar at {b.ts_ms}")
    if min(b.open, b.high, b.low, b.close) <= 0 or b.quote_volume < 0:
        raise ValueError(f"invalid bar values at {b.ts_ms}")
    if b.high < max(b.open, b.close) or b.low > min(b.open, b.close):
        raise ValueError(f"invalid OHLC ordering at {b.ts_ms}")


def _validate_hourly_prefix(bars: list[Bar], i: int) -> None:
    if i < 336:
        raise ValueError("need at least 337 completed 1H bars")
    for j in range(i - 336, i + 1):
        _finite_positive_bar(bars[j])
        if j > i - 336 and bars[j].ts_ms - bars[j - 1].ts_ms != 3_600_000:
            raise ValueError(f"non-contiguous 1H bars at index {j}")


def _wilder_rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        raise ValueError("insufficient closes for RSI")
    gains: list[float] = []
    losses: list[float] = []
    for a, b in zip(closes, closes[1:]):
        d = b - a
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for gain, loss in zip(gains[period:], losses[period:]):
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _wilder_atr(bars: list[Bar], period: int = 14) -> float:
    if len(bars) < period + 1:
        raise ValueError("insufficient bars for ATR")
    trs: list[float] = []
    for prev, cur in zip(bars, bars[1:]):
        trs.append(max(cur.high - cur.low, abs(cur.high - prev.close), abs(cur.low - prev.close)))
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return atr


def feature_snapshot(bars: list[Bar], i: int) -> FeatureSnapshot:
    """Calculate recovered HIGH_VOL features from completed bars through i only."""
    _validate_hourly_prefix(bars, i)
    cur = bars[i]
    ret24 = cur.close / bars[i - 24].close - 1.0
    ret14d = cur.close / bars[i - 336].close - 1.0
    causal = bars[max(0, i - 336) : i + 1]
    rsi14 = _wilder_rsi([b.close for b in causal], 14)
    atr14 = _wilder_atr(causal, 14)
    vols = [b.quote_volume for b in bars[i - 23 : i + 1]]
    median_volume = statistics.median(vols)
    volume_ratio = cur.quote_volume / median_volume if median_volume > 0 else math.inf if cur.quote_volume > 0 else 1.0
    return FeatureSnapshot(
        signal_ts_ms=cur.ts_ms,
        ret24=ret24,
        ret14d=ret14d,
        rsi14=rsi14,
        atr14=atr14,
        atr_pct=atr14 / cur.close,
        volume_ratio=volume_ratio,
        bar_up=cur.close > cur.open,
        bar_down=cur.close < cur.open,
    )


def market_valid(s: FeatureSnapshot) -> bool:
    return math.isfinite(s.ret14d) and s.atr_pct >= 0.01 and s.volume_ratio >= 0.50


def matching_rules(s: FeatureSnapshot) -> list[SignalRule]:
    """Return every documented raw-grid rule matched by a completed signal bar.

    This deliberately does not assign S1 vs S2 and does not pretend the missing
    monthly selection scope is proven. It is a raw-grid containment check.
    """
    if not market_valid(s):
        return []
    out: list[SignalRule] = []
    if s.ret14d >= 0 and s.bar_up:
        for move in LONG_DROPS:
            for rsi in LONG_RSIS:
                if s.ret24 <= -move and s.rsi14 <= rsi:
                    for hard_stop in HARD_STOPS:
                        out.append(SignalRule(1, move, rsi, hard_stop))
    elif s.ret14d < 0 and s.bar_down:
        for move in SHORT_RALLIES:
            for rsi in SHORT_RSIS:
                if s.ret24 >= move and s.rsi14 >= rsi:
                    for hard_stop in HARD_STOPS:
                        out.append(SignalRule(-1, move, rsi, hard_stop))
    return out


def _month_pairs(start_ms: int, end_ms: int) -> list[tuple[int, int]]:
    d = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    end = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)
    y, m = d.year, d.month
    out: list[tuple[int, int]] = []
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        m += 1
        if m == 13:
            y += 1
            m = 1
    return out


def _exchange_symbol(symbol: str) -> str:
    return {"BONK": "1000BONK", "PEPE": "1000PEPE", "RENDER": "RENDER"}.get(symbol, symbol) + "USDT"


def load_binance_vision_1h(symbol: str, start_ms: int, end_ms: int, cache_dir: Path) -> list[Bar]:
    """Load public USDM monthly 1H klines; this never calls a trading API."""
    ex = _exchange_symbol(symbol)
    cache_dir.mkdir(parents=True, exist_ok=True)
    bars: dict[int, Bar] = {}
    for year, month in _month_pairs(start_ms, end_ms):
        name = f"{ex}-1h-{year:04d}-{month:02d}.zip"
        path = cache_dir / name
        if not path.exists():
            url = f"https://data.binance.vision/data/futures/um/monthly/klines/{ex}/1h/{name}"
            req = urllib.request.Request(url, headers={"User-Agent": "quality102-research-reconstruction/1"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                path.write_bytes(resp.read())
        with zipfile.ZipFile(path) as zf:
            members = [n for n in zf.namelist() if n.endswith('.csv')]
            if len(members) != 1:
                raise RuntimeError(f"expected one CSV in {name}, found {members}")
            text = io.TextIOWrapper(zf.open(members[0]), encoding="utf-8")
            for row in csv.reader(text):
                if not row or not row[0].isdigit():
                    continue
                ts = int(row[0])
                if start_ms <= ts <= end_ms:
                    bars[ts] = Bar(ts, float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[7]))
    return [bars[k] for k in sorted(bars)]


def check_fixture(fixture_path: Path, cache_dir: Path) -> dict:
    rows = list(csv.DictReader(fixture_path.open(newline='', encoding='utf-8')))
    checks: list[FixtureCheck] = []
    by_symbol: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_symbol.setdefault(row['symbol'], []).append(row)
    for symbol, symbol_rows in by_symbol.items():
        min_signal = min(int(r['signal_timestamp_ms']) for r in symbol_rows)
        max_signal = max(int(r['signal_timestamp_ms']) for r in symbol_rows)
        start = min_signal - 21 * 24 * 3_600_000
        try:
            bars = load_binance_vision_1h(symbol, start, max_signal, cache_dir)
            index = {b.ts_ms: i for i, b in enumerate(bars)}
            for row in symbol_rows:
                signal = int(row['signal_timestamp_ms'])
                side = int(row['side'])
                try:
                    i = index[signal]
                    snap = feature_snapshot(bars, i)
                    rules = [r for r in matching_rules(snap) if r.side == side]
                    checks.append(FixtureCheck(row['layer'], symbol, signal, int(row['entry_timestamp_ms']), side, len(rules), market_valid(snap), snap.ret24, snap.ret14d, snap.rsi14, snap.atr_pct, snap.volume_ratio))
                except Exception as exc:
                    checks.append(FixtureCheck(row['layer'], symbol, signal, int(row['entry_timestamp_ms']), side, 0, False, None, None, None, None, None, str(exc)))
        except Exception as exc:
            for row in symbol_rows:
                checks.append(FixtureCheck(row['layer'], symbol, int(row['signal_timestamp_ms']), int(row['entry_timestamp_ms']), int(row['side']), 0, False, None, None, None, None, None, f"market-data: {exc}"))
    checks.sort(key=lambda x: x.entry_timestamp_ms)
    matched = sum(c.matched_rule_count > 0 for c in checks)
    return {
        "status": "RESEARCH_ONLY",
        "sourceSpecCommit": SOURCE_SPEC_COMMIT,
        "sourceFixtureRun": SOURCE_FIXTURE_RUN,
        "sourceFixtureArtifactId": SOURCE_FIXTURE_ARTIFACT_ID,
        "originalRawGeneratorProven": ORIGINAL_RAW_GENERATOR_PROVEN,
        "rsiMethod": RSI_METHOD,
        "atrMethod": ATR_METHOD,
        "fixtureRows": len(checks),
        "rawGridMatched": matched,
        "rawGridMissed": len(checks) - matched,
        "checks": [asdict(c) for c in checks],
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--fixture', type=Path, required=True)
    p.add_argument('--cache-dir', type=Path, default=Path('.research-state/binance-vision-1h'))
    p.add_argument('--output', type=Path)
    args = p.parse_args()
    result = check_fixture(args.fixture, args.cache_dir)
    payload = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + '\n', encoding='utf-8')
    print(payload)
    return 0 if result['fixtureRows'] == 18 else 2


if __name__ == '__main__':
    raise SystemExit(main())
