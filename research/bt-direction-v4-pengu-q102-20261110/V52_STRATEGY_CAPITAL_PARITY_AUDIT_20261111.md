# V52 strategy-capital parity audit — 2026-11-11

## Finding

The locked canonical simulator is not exact for the V52 3.5% strategy daily-loss denominator.

Current canonical code computes V52 strategy capital as:

- portfolio MTM equity
- minus **all** non-V52 crypto gross notional
- minus reserve = max($5-equivalent, 10% equity)

The effective active V52 source does not subtract all crypto.

## Effective Production evidence

Effective V52 source:

`8495daf24e53a6cf0dd5e38f022008fa8f78c688`

Inheritance:

- `disdex_v52_aster_only_live_engine.V52AsterOnlyEngine`
- -> `disdex_v52_aster_only_legacy_engine.V52AsterOnlyEngine`
- -> `disdex_v11eq_aster_only_live_engine.AsterOnlyStockEngine`

The V52 layers do **not** override `current_v96_notional()`.

Inherited `excess_margin_usd()` is:

```python
if self.v96_requires_margin():
    return 0.0
equity = self.portfolio_equity()
used_by_v96 = self.current_v96_notional()
reserve = max(self.minimum_reserve_usd, equity * self.safety_reserve_pct / 100.0)
return max(0.0, equity - used_by_v96 - reserve)
```

Inherited `current_v96_notional()` calls `quality102_crypto_notional_from_positions()` with the exact `V96_SYMBOLS` allow-list:

- BTCUSDT
- ETHUSDT
- BNBUSDT
- SOLUSDT
- LINKUSDT
- AVAXUSDT
- DOGEUSDT
- INJUSDT
- XRPUSDT
- ADAUSDT
- LTCUSDT
- ATOMUSDT
- AAVEUSDT
- NEARUSDT
- PENGUUSDT

Therefore FET/HYPE/JUP and any V4 crypto symbol outside this set do not reduce the V52 strategy-capital denominator.

Effective env confirms:

- `DISDEX_V52_MAX_DAILY_LOSS_PCT=3.5`
- no effective override found for V52 strategy capital, minimum entry, safety reserve, or minimum reserve in the inspected V52 EnvironmentFiles
- code defaults therefore remain 10% safety reserve and $5 minimum reserve / entry floor

## Canonical mismatch

Current canonical lines use:

```python
_crypto_notional=_gscrypto["crypto"]*eq_v52
_reserve=max(_mincap,.10*eq_v52)
_capital=max(_mincap,eq_v52-_crypto_notional-_reserve)
```

`_gscrypto["crypto"]` contains all non-V52 crypto sleeves, so this understates V52 strategy capital whenever FET/HYPE/IDLE/JUP or other non-V96 symbols are open.

Observed consequence in the previous canonical replay:

- V52 daily trips: ~133–135
- maximum DD was dominated by a TSLAUSDT V50 SHORT held during V52 daily-latch state
- at the old max-DD trough the modeled V52 strategy-capital denominator collapsed to roughly JPY 800 / JPY 323, producing extreme daily-loss percentages

## Required correction

For the V52 daily-loss denominator only:

1. Sum current marked notional for open non-V52 positions whose symbol is in the exact 15-symbol V96 allow-list above.
2. Use current marked notional (`original notional * current mark / entry`), matching live `abs(quantity) * mark`.
3. Do not include pending exposure; live `current_v96_notional()` reads positions only.
4. Keep reserve = max($5-equivalent, 10% portfolio equity).
5. Keep V52 own 3.5% latch semantics unchanged.
6. Historical mark availability remains proxy-based; fail closed if a required scoped mark is unavailable.

## Status

This finding invalidates the previously locked canonical result as the final implementation-parity baseline.

The previous outputs and SHA evidence remain historical evidence and must not be silently deleted, but a corrected canonical replay must supersede them.

No Production mutation was performed.
