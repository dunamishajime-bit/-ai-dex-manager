from __future__ import annotations

import argparse
import ast
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

NORMAL_COST_PER_SIDE = 0.0006
NORMAL_FUNDING_PER_DAY = 0.0002
STRESS_COST_PER_SIDE = 0.0010
STRESS_FUNDING_PER_DAY = 0.0005
TRIGGER = 0.12
TRAIL = 0.05
MAX_HV_BARS = 72

SYMBOL_TO_EXCHANGE = {
    'BONK': '1000BONKUSDT',
    'PEPE': '1000PEPEUSDT',
    'RENDER': 'RENDERUSDT',
}

LAYER_PRIORITY = {'S1': 0, 'S2': 1, 'S3': 2, 'S4': 3}


def utc_series(values: pd.Series) -> pd.Series:
    return pd.to_datetime(values, utc=True)


def canonical_ts(ts: pd.Timestamp) -> str:
    return pd.Timestamp(ts).tz_convert('UTC').strftime('%Y-%m-%d %H:%M:%S+00:00')


def exchange_symbol(symbol: str) -> str:
    return SYMBOL_TO_EXCHANGE.get(symbol, f'{symbol}USDT')


class MarketCache:
    def __init__(self, cache_dir: Path):
        self.cache_dir = Path(cache_dir)
        self.frames: dict[str, pd.DataFrame] = {}

    def load(self, symbol: str) -> pd.DataFrame:
        ex = exchange_symbol(symbol)
        if ex not in self.frames:
            matches = sorted(self.cache_dir.glob(f'{ex}_1h_*.csv'))
            if len(matches) != 1:
                raise RuntimeError(f'expected exactly one market cache for {symbol}/{ex}; found {matches}')
            df = pd.read_csv(matches[0])
            df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True)
            df = df.set_index('timestamp').sort_index()
            for col in ('open', 'high', 'low', 'close'):
                df[col] = pd.to_numeric(df[col], errors='raise')
            self.frames[ex] = df
        return self.frames[ex]

    def open_at(self, symbol: str, ts: pd.Timestamp) -> float:
        df = self.load(symbol)
        return float(df.at[pd.Timestamp(ts), 'open'])


@dataclass(frozen=True)
class HvExit:
    exit: pd.Timestamp
    exit_price: float
    gross_return: float
    hold_hours: int
    exit_reason: str


def parse_rule(rule_text: str) -> dict:
    try:
        value = json.loads(rule_text)
    except json.JSONDecodeError:
        value = ast.literal_eval(rule_text)
    if not isinstance(value, dict):
        raise RuntimeError(f'rule is not a dict: {rule_text!r}')
    return value


def hv_exit(row: pd.Series, market: MarketCache) -> HvExit:
    symbol = str(row['symbol'])
    side = int(row['side'])
    if side not in (-1, 1):
        raise RuntimeError(f'invalid HV side {side}')
    entry = pd.Timestamp(row['entry'])
    entry_price = float(row['entry_price'])
    hard_stop = float(parse_rule(str(row['rule']))['hard_stop'])
    frame = market.load(symbol)
    if entry not in frame.index:
        raise RuntimeError(f'missing entry bar {symbol} {entry}')
    start = frame.index.get_loc(entry)
    if not isinstance(start, (int, np.integer)):
        raise RuntimeError(f'non-unique entry bar {symbol} {entry}')
    bars = frame.iloc[start:start + MAX_HV_BARS]
    if len(bars) < MAX_HV_BARS:
        raise RuntimeError(f'need {MAX_HV_BARS} bars after {symbol} {entry}, found {len(bars)}')

    trail_active = False
    best = entry_price
    stop_price = entry_price * (1.0 - hard_stop) if side == 1 else entry_price * (1.0 + hard_stop)

    for n, (ts, bar) in enumerate(bars.iterrows(), start=1):
        high = float(bar['high'])
        low = float(bar['low'])

        # Conservative intrabar semantics used by the frozen Quality102 research:
        # hard stop has priority whenever bar ordering is unknowable.
        if side == 1 and low <= stop_price:
            px = stop_price
            gross = px / entry_price - 1.0
            return HvExit(ts, px, gross, n, 'hard_stop')
        if side == -1 and high >= stop_price:
            px = stop_price
            gross = 1.0 - px / entry_price
            return HvExit(ts, px, gross, n, 'hard_stop')

        if side == 1:
            best = max(best, high)
            if not trail_active and best / entry_price - 1.0 >= TRIGGER - 1e-15:
                trail_active = True
            if trail_active:
                trail_price = best * (1.0 - TRAIL)
                if low <= trail_price:
                    px = trail_price
                    gross = px / entry_price - 1.0
                    return HvExit(ts, px, gross, n, 'trail_5pct_after_12pct')
        else:
            best = min(best, low)
            if not trail_active and 1.0 - best / entry_price >= TRIGGER - 1e-15:
                trail_active = True
            if trail_active:
                trail_price = best * (1.0 + TRAIL)
                if high >= trail_price:
                    px = trail_price
                    gross = 1.0 - px / entry_price
                    return HvExit(ts, px, gross, n, 'trail_5pct_after_12pct')

        if n == MAX_HV_BARS:
            px = float(bar['close'])
            gross = px / entry_price - 1.0 if side == 1 else 1.0 - px / entry_price
            return HvExit(ts, px, gross, n, '72h_time')

    raise AssertionError('unreachable')


def net_from_gross(gross: float, hold_hours: float, per_side: float, funding_per_day: float) -> float:
    return float(gross - 2.0 * per_side - (float(hold_hours) / 24.0) * funding_per_day)


def transform_high_vol(stage_path: Path, stage_name: str, market: MarketCache) -> pd.DataFrame:
    src = pd.read_csv(stage_path)
    src['entry'] = utc_series(src['entry'])
    rows: list[dict] = []
    for _, r in src.iterrows():
        x = hv_exit(r, market)
        rows.append({
            'entry': r['entry'],
            'exit': x.exit,
            'symbol': str(r['symbol']),
            'family': 'HIGH_VOL',
            # Preserve source formatting because the frozen candidate retained it.
            'variant': str(r['rule']),
            'side': int(r['side']),
            'normal_net': net_from_gross(x.gross_return, x.hold_hours, NORMAL_COST_PER_SIDE, NORMAL_FUNDING_PER_DAY),
            'stress_net': net_from_gross(x.gross_return, x.hold_hours, STRESS_COST_PER_SIDE, STRESS_FUNDING_PER_DAY),
            'gross_return': x.gross_return,
            'hold_hours': float(x.hold_hours),
            'exit_reason': x.exit_reason,
            'quality_rule': 'HV_TRIGGER12_TRAIL5',
            'stage': 'HV',
            'ret14': np.nan,
            'strength': np.nan,
            '_source_layer': stage_name,
        })
    return pd.DataFrame(rows)


def s34_quality_rule(r: pd.Series, ret14: float) -> tuple[bool, str]:
    family = str(r['family'])
    variant = str(r['variant'])
    side = int(r['side'])
    strength = float(r['strength'])
    if family == 'PB':
        return variant != 'PB168_0.1_P24_0.04_H12', 'PB_WEAK_VARIANT_REMOVED'
    if family == 'MR':
        return (side == -1 or ret14 >= -0.025), 'MR_REGIME_GATE'
    if family == 'BRK':
        return (strength >= 0.03 and side * ret14 >= -0.05), 'BRK_QUALITY_GATE'
    if family == 'REV':
        return True, 'UNCHANGED'
    raise RuntimeError(f'unknown S34 family {family!r}')


def transform_s34(stage34_path: Path, core_path: Path, filler_path: Path, market: MarketCache) -> tuple[pd.DataFrame, pd.DataFrame]:
    src = pd.read_csv(stage34_path)
    src['entry'] = utc_series(src['entry'])
    src['exit'] = utc_series(src['exit'])
    core = pd.read_csv(core_path)
    filler = pd.read_csv(filler_path)

    def ident(df: pd.DataFrame) -> set[tuple]:
        return set(zip(pd.to_datetime(df['entry'], utc=True), df['symbol'].astype(str), df['variant'].astype(str), df['side'].astype(int)))

    core_ids = ident(core)
    filler_ids = ident(filler)
    accepted: list[dict] = []
    rejected: list[dict] = []

    for _, r in src.iterrows():
        entry = pd.Timestamp(r['entry'])
        prior = entry - pd.Timedelta(hours=24 * 14)
        entry_open = market.open_at(str(r['symbol']), entry)
        prior_open = market.open_at(str(r['symbol']), prior)
        ret14 = entry_open / prior_open - 1.0
        ok, quality_rule = s34_quality_rule(r, ret14)
        identity = (entry, str(r['symbol']), str(r['variant']), int(r['side']))
        if identity in core_ids:
            layer = 'S3'
        elif identity in filler_ids:
            layer = 'S4'
        else:
            raise RuntimeError(f'S34 row is in neither core nor filler: {identity}')

        out = {
            'entry': entry,
            'exit': pd.Timestamp(r['exit']),
            'symbol': str(r['symbol']),
            'family': str(r['family']),
            'variant': str(r['variant']),
            'side': int(r['side']),
            'normal_net': float(r['net']),
            'stress_net': net_from_gross(float(r['gross']), float(r['hold']), STRESS_COST_PER_SIDE, STRESS_FUNDING_PER_DAY),
            'gross_return': float(r['gross']),
            'hold_hours': float(r['hold']),
            'exit_reason': str(r['reason']),
            'quality_rule': quality_rule,
            'stage': 'S34',
            'ret14': ret14,
            'strength': float(r['strength']),
            '_source_layer': layer,
        }
        (accepted if ok else rejected).append(out)

    return pd.DataFrame(accepted), pd.DataFrame(rejected)


def build_quality124(root: Path, market: MarketCache) -> tuple[pd.DataFrame, dict]:
    hv1 = transform_high_vol(root / 'latest_stage1.csv', 'S1', market)
    hv2 = transform_high_vol(root / 'latest_stage2.csv', 'S2', market)
    s34, s34_rejected = transform_s34(root / 'latest_stage34.csv', root / 'latest_core.csv', root / 'latest_filler.csv', market)
    q124 = pd.concat([hv1, hv2, s34], ignore_index=True)
    q124 = q124.sort_values(['entry', '_source_layer'], key=lambda col: col.map(LAYER_PRIORITY) if col.name == '_source_layer' else col, kind='stable').reset_index(drop=True)
    stats = {
        'raw': 151,
        'highVolRaw': len(hv1) + len(hv2),
        's34Raw': len(pd.read_csv(root / 'latest_stage34.csv')),
        's34Accepted': len(s34),
        's34Rejected': len(s34_rejected),
        'quality124': len(q124),
        'quality124Layers': q124['_source_layer'].value_counts().sort_index().to_dict(),
    }
    return q124, stats


def route_one_slot(q124: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    ordered = q124.copy()
    ordered['layer'] = ordered['_source_layer']
    ordered['_priority'] = ordered['layer'].map(LAYER_PRIORITY)
    ordered = ordered.sort_values(['entry', '_priority'], kind='stable').reset_index(drop=True)

    accepted: list[dict] = []
    blocked: list[dict] = []
    active_exit: pd.Timestamp | None = None
    for _, r in ordered.iterrows():
        entry = pd.Timestamp(r['entry'])
        if active_exit is not None and entry < active_exit:
            d = r.to_dict()
            d['blocked_reason'] = 'ONE_SLOT_OCCUPIED'
            blocked.append(d)
            continue
        d = r.to_dict()
        accepted.append(d)
        active_exit = pd.Timestamp(r['exit'])

    q102 = pd.DataFrame(accepted).drop(columns=['_priority'])
    blocked_df = pd.DataFrame(blocked)
    return q102, blocked_df


def normalize_variant(value: str) -> str:
    text = str(value)
    if text.lstrip().startswith(('{', '[')):
        try:
            obj = json.loads(text)
        except Exception:
            try:
                obj = ast.literal_eval(text)
            except Exception:
                return text
        return json.dumps(obj, sort_keys=True, separators=(',', ':'))
    return text


def compare_to_frozen(recovered: pd.DataFrame, frozen_path: Path) -> dict:
    frozen = pd.read_csv(frozen_path)
    frozen['entry'] = utc_series(frozen['entry'])
    frozen['exit'] = utc_series(frozen['exit'])
    rec = recovered.copy()

    key_cols = ['entry', 'exit', 'symbol', 'layer', 'family', 'side', 'quality_rule', 'exit_reason']
    for df in (frozen, rec):
        df['_variant_norm'] = df['variant'].map(normalize_variant)
    key_cols2 = key_cols + ['_variant_norm']
    rec_keys = set(map(tuple, rec[key_cols2].itertuples(index=False, name=None)))
    frozen_keys = set(map(tuple, frozen[key_cols2].itertuples(index=False, name=None)))

    # Match by stable trade identity for numeric diagnostics.
    ident = ['entry', 'symbol', 'side', 'family', '_variant_norm']
    merged = rec.merge(frozen, on=ident, suffixes=('_rec', '_frozen'), how='outer', indicator=True)
    both = merged[merged['_merge'] == 'both'].copy()
    numeric_diffs = {}
    for col in ['normal_net', 'stress_net', 'hold_hours', 'ret14', 'strength']:
        a = pd.to_numeric(both[f'{col}_rec'], errors='coerce')
        b = pd.to_numeric(both[f'{col}_frozen'], errors='coerce')
        diff = (a - b).abs()
        numeric_diffs[col] = float(diff.max(skipna=True)) if diff.notna().any() else 0.0

    return {
        'recoveredCount': len(rec),
        'frozenCount': len(frozen),
        'identityMatched': int((merged['_merge'] == 'both').sum()),
        'missingFromRecovered': int((merged['_merge'] == 'right_only').sum()),
        'extraInRecovered': int((merged['_merge'] == 'left_only').sum()),
        'fullTradeKeySetExact': rec_keys == frozen_keys,
        'numericMaxAbsDiff': numeric_diffs,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description='Reconstruct the frozen Quality102 selector from surviving raw research sources.')
    ap.add_argument('--root', type=Path, default=Path('/mnt/data'))
    ap.add_argument('--market-cache', type=Path, default=Path('/mnt/data/hv30/.cache/high_vol_scanner_30'))
    ap.add_argument('--output-dir', type=Path, default=Path('/mnt/data/quality102_recovered'))
    ap.add_argument('--frozen', type=Path, default=Path('/mnt/data/quality102_frozen.csv'))
    args = ap.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    market = MarketCache(args.market_cache)
    q124, stats = build_quality124(args.root, market)
    q102, blocked = route_one_slot(q124)
    comparison = compare_to_frozen(q102, args.frozen)

    # Fail closed unless the selector is exactly recovered.
    expected_layers = {'S1': 8, 'S2': 10, 'S3': 69, 'S4': 15}
    observed_layers = {str(k): int(v) for k, v in q102['layer'].value_counts().sort_index().to_dict().items()}
    checks = {
        'RAW_151': stats['raw'] == 151,
        'S34_94': stats['s34Accepted'] == 94,
        'QUALITY124_124': len(q124) == 124,
        'QUALITY102_102': len(q102) == 102,
        'ONE_SLOT_BLOCKED_22': len(blocked) == 22,
        'LAYER_COUNTS': observed_layers == expected_layers,
        'FROZEN_IDENTITY_102_OF_102': comparison['identityMatched'] == 102 and comparison['missingFromRecovered'] == 0 and comparison['extraInRecovered'] == 0,
        'FROZEN_FULL_TRADE_KEYS_EXACT': bool(comparison['fullTradeKeySetExact']),
        'FROZEN_NUMERIC_EXACT_TOL': max(comparison['numericMaxAbsDiff'].values()) <= 1e-12,
    }

    export_cols = ['entry', 'exit', 'symbol', 'layer', 'family', 'variant', 'side', 'normal_net', 'stress_net', 'quality_rule', 'exit_reason', 'hold_hours', 'ret14', 'strength']
    out = q102[export_cols].copy()
    for c in ['entry', 'exit']:
        out[c] = out[c].map(canonical_ts)
    out.to_csv(args.output_dir / 'quality102-recovered.csv', index=False)
    q124_out = q124.drop(columns=['_source_layer']).copy()
    for c in ['entry', 'exit']:
        q124_out[c] = q124_out[c].map(canonical_ts)
    q124_out.to_csv(args.output_dir / 'quality124-recovered.csv', index=False)
    blocked_out = blocked.copy()
    if len(blocked_out):
        for c in ['entry', 'exit']:
            blocked_out[c] = blocked_out[c].map(canonical_ts)
        blocked_out.to_csv(args.output_dir / 'one-slot-blocked-22.csv', index=False)

    report = {
        'schema': 'quality102-selector-recovery/v1',
        'status': 'QUALITY_SELECTOR_RECOVERED' if all(checks.values()) else 'RECOVERY_MISMATCH',
        'algorithm': {
            'highVol': 'original entry/hard-stop; max72 bars; trigger +12%; trail 5%; hard-stop priority; intrabar extreme trail; normal/stress costs',
            'PB': 'reject PB168_0.1_P24_0.04_H12 only',
            'MR': 'short unchanged; long requires prior14d open/open-336h - 1 >= -2.5%',
            'BRK': 'strength >= 0.03 and side*prior14d >= -0.05',
            'REV': 'unchanged',
            'layers': 'raw stage1=S1; raw stage2=S2; accepted S34 core=S3; filler=S4',
            'oneSlot': 'chronological; same-entry priority S1>S2>S3>S4; block entry while prior supplement remains open; no preemption',
        },
        'stats': stats | {'quality102': len(q102), 'blocked': len(blocked), 'quality102Layers': observed_layers},
        'comparison': comparison,
        'checks': checks,
    }
    (args.output_dir / 'recovery-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(checks.values()):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
