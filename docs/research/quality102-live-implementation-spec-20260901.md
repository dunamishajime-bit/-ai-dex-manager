# Quality102 LIVE Implementation Specification

Status: implementation reference
Date: 2026-09-01
Primary recovered selector commit: `450f8fae800d3f509ef868ab035f0cd731216279`

## 1. Scope

Quality102 is reconstructed from surviving research sources as:

- raw candidates: 151
- after Quality Gate: Quality124 = 124
- one-slot blocked: 22
- final Quality102 = 102

Expected final layer counts:

- S1 = 8
- S2 = 10
- S3 = 69
- S4 = 15

The LIVE implementation must reproduce the causal selector, not replay the frozen 102 timestamps/CSV.

## 2. Layer structure

- S1: HIGH_VOL stage1
- S2: HIGH_VOL stage2
- S3: accepted S34 rows present in `latest_core.csv`
- S4: accepted S34 rows present in `latest_filler.csv`

Same-entry priority:

`S1 > S2 > S3 > S4`

## 3. Historical final symbols

The frozen 102 trades contain the following symbols:

`FET, AVAX, DOGE, TAO, UNI, SOL, APT, SUI, LDO, NEAR, DOT, SEI, ONDO, AAVE, RENDER, OP, ARB`

These are historical outputs of the selector and MUST NOT be treated as the authoritative fixed LIVE universe unless the upstream source explicitly defines them that way.

## 4. HIGH_VOL feature calculation

Timeframe: 1 hour.

Required features per completed 1H candle:

- `ret24 = close(t) / close(t-24h) - 1`
- `ret14d = close(t) / close(t-336h) - 1`
- RSI14
- ATR14
- `atr_pct = ATR14 / close`
- `volume_ratio = quote_volume / median(last 24 quote_volume bars)`
- `bar_up = close > open`
- `bar_down = close < open`

Market validity gate:

```text
isfinite(ret14d)
AND atr_pct >= 0.01
AND volume_ratio >= 0.50
```

## 5. HIGH_VOL Long entry

Long is considered only when:

```text
ret14d >= 0
```

Signal condition:

```text
ret24 <= -selected_long_drop
AND RSI14 <= selected_long_rsi
AND close > open
```

Interpretation: buy a sharp 24h pullback/oversold reversal only while the 14-day regime remains non-negative.

Parameter grid:

- `long_drop`: 0.08, 0.10, 0.12, 0.15
- `long_rsi`: 30, 35, 40

## 6. HIGH_VOL Short entry

Short is considered only when:

```text
ret14d < 0
```

Signal condition:

```text
ret24 >= selected_short_rally
AND RSI14 >= selected_short_rsi
AND close < open
```

Interpretation: short a sharp 24h rally/overbought reversal while the 14-day regime remains negative.

Parameter grid:

- `short_rally`: 0.05, 0.08, 0.10, 0.12
- `short_rsi`: 55, 60, 65

## 7. HIGH_VOL execution timing

Signals are evaluated only from completed 1H candles.

Execution:

```text
signal bar = i
entry bar = i + 1
entry_price = next 1H open
```

No incomplete-bar/same-bar execution is allowed if BT parity is required.

## 8. HIGH_VOL monthly walk-forward rule selection

At the start of each month:

```text
training_start = month_start - 180 days
training_end   = month_start - 1 hour
```

Evaluate the full parameter grid using only the trailing 180 days.

Eligible rule requirements:

```text
trades >= 5
total_return > 0
win_rate >= 0.52
profit_factor >= 1.15
expectancy > 0
```

Eligible rules are ranked by:

```text
score =
    WilsonLowerBound(wins, trades, z=1.0)
  + min(profit_factor, 3.0) * 0.03
  + expectancy * 2
  - max(0, -max_drawdown - 0.25)
```

Use the top-ranked rule for that month only. Re-select next month.

Hard-stop grid:

- 0.10
- 0.15

## 9. HIGH_VOL exit semantics

Constants:

```text
MAX_HOLD_HOURS = 72
TRAIL_TRIGGER = 0.12
TRAIL_DISTANCE = 0.05
```

Long hard stop:

```text
stop_price = entry_price * (1 - hard_stop)
```

Short hard stop:

```text
stop_price = entry_price * (1 + hard_stop)
```

Hard stop has intrabar priority whenever OHLC ordering is unknowable.

Long trailing:

1. Track best high after entry.
2. Activate trail when `best_high / entry_price - 1 >= 0.12`.
3. Trail price = `best_high * 0.95`.
4. Exit if candle low reaches trail price.

Short trailing:

1. Track best low after entry.
2. Activate trail when `1 - best_low / entry_price >= 0.12`.
3. Trail price = `best_low * 1.05`.
4. Exit if candle high reaches trail price.

If neither stop nor trail exits the position, exit on the close of the 72nd 1H bar.

## 10. S34 Quality Gates

The upstream S34 raw generator produces PB/MR/BRK/REV candidates. The recovered Quality102 selector applies these post-generation quality gates.

### PB

Reject only:

```text
PB168_0.1_P24_0.04_H12
```

Quality rule label: `PB_WEAK_VARIANT_REMOVED`.

### MR

For MR short:

```text
PASS
```

For MR long, calculate:

```text
ret14 = entry_open / open(entry_time - 336h) - 1
```

Require:

```text
ret14 >= -0.025
```

Quality rule label: `MR_REGIME_GATE`.

### BRK

Require both:

```text
strength >= 0.03
AND side * ret14 >= -0.05
```

Equivalent:

- Long: `ret14 >= -0.05`
- Short: `ret14 <= +0.05`

Quality rule label: `BRK_QUALITY_GATE`.

### REV

No additional Quality102 filter.

Quality rule label: `UNCHANGED`.

## 11. S3/S4 classification

Stable identity:

```text
(entry timestamp, symbol, variant, side)
```

If identity exists in `latest_core.csv` -> S3.

If identity exists in `latest_filler.csv` -> S4.

If it exists in neither -> fail closed.

## 12. One-slot router

Quality102 itself may hold at most one supplement trade at a time.

Process accepted Quality124 candidates chronologically, with same-entry priority `S1>S2>S3>S4`.

Rule:

```text
if active_exit is not None and new_entry < active_exit:
    reject reason = ONE_SLOT_OCCUPIED
else:
    accept
    active_exit = accepted_trade.exit
```

No preemption. A new candidate does not replace an active Quality102 position.

`new_entry == active_exit` is allowed.

Expected frozen reconstruction:

```text
Quality124 = 124
ONE_SLOT_OCCUPIED = 22
Quality102 = 102
```

## 13. Research cost model

NORMAL:

```text
cost_per_side = 0.0006
funding_per_day = 0.0002
```

STRESS:

```text
cost_per_side = 0.0010
funding_per_day = 0.0005
```

Research net return:

```text
net = gross
    - 2 * cost_per_side
    - (hold_hours / 24) * funding_per_day
```

LIVE accounting should use actual fills, actual fees and actual funding while preserving the selector/execution semantics.

## 14. Portfolio integration contract

Current strict portfolio limits:

```text
Quality102 gross cap = 0.50x
Crypto gross cap     = 2.00x
Total gross cap      = 2.50x
```

Portfolio priority:

```text
V52 > PENGU > V12 > Quality102
```

Quality102 is a lower-priority supplement sleeve and must use only remaining allowed Gross.

If a higher-priority strategy needs Gross while Quality102 is already open, resize/close Quality102 at the actual current market price. Do not model a forced resize as zero-PnL.

The resize ledger must update at least:

- executed reduction quantity
- execution/mark price
- realized PnL
- fee
- funding
- remaining quantity
- remaining cost basis

## 15. Historical final trade characteristics

Frozen Quality102:

- total trades: 102
- Long: 37
- Short: 65

Family counts:

- HIGH_VOL: 18
- PB: 10
- MR: 22
- BRK: 28
- REV: 24

Exit counts:

- ordinary time exit: 77
- 72h HIGH_VOL time exit: 13
- stop: 7
- +12% trigger / 5% trailing exit: 5

## 16. Critical implementation boundary

The recovered selector fully reconstructs:

- HIGH_VOL raw entry logic
- HIGH_VOL monthly 180d walk-forward selection
- HIGH_VOL Long/Short rules
- HIGH_VOL next-hour-open execution
- HIGH_VOL hard stop
- HIGH_VOL +12% / 5% trailing exit
- HIGH_VOL 72h exit
- PB Quality Gate
- MR Quality Gate
- BRK Quality Gate
- REV Quality Gate
- S3/S4 classification
- S1>S2>S3>S4 priority
- Quality124 -> Quality102 one-slot routing

However, the recovered Quality102 script consumes already-generated S34 PB/MR/BRK/REV raw trades. Therefore the LIVE implementation must recover/connect the authoritative upstream S34 raw signal generator.

Do NOT infer raw PB/MR/BRK/REV formulas solely from variant names such as:

- `BRK24_H48_V1.2`
- `MR72_Z1.5_H12`
- `PB168_0.1_P24_0.02_H12`
- `REV12_T0.08_H24`

Do NOT use the frozen 102 timestamps or frozen CSV as LIVE signal input.

## 17. Required fail-closed behavior

LIVE selector must fail closed if any authoritative dependency required to reproduce the causal selector is absent, stale, ambiguous or mismatched.

In particular:

- no incomplete candle use
- no future data/look-ahead
- no substitution of frozen outputs for causal generation
- no guessed S34 raw formulas
- no silent universe narrowing to the 17 historical symbols
- no bypass of one-slot routing
- no bypass of Gross caps

## 18. Recovery reference

Primary recovered selector:

`commit 450f8fae800d3f509ef868ab035f0cd731216279`

File:

`scripts/research_quality102_selector_recovered.py`

The recovered research implementation validates exact reconstruction against the frozen Quality102 set and requires the expected 102/102 identity match and layer counts before reporting `QUALITY_SELECTOR_RECOVERED`.
