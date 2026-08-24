# V17 arm-confirmation diagnostic

RESEARCH ONLY. No strategy modification and no LIVE/VPS/orders/production changes.

Purpose: diagnose whether frozen V17 progression failures are created by wick-only arming. For every V17 modified event on OKX, Binance, Gate, and Bitget, record the first bar where intrabar MFE reaches the frozen +1-unit arm threshold, and compare that bar's completed-H1 close profit with the same +1-unit threshold.

Record only pre-existing frozen state and outcomes:
- entry timestamp and baseline/candidate account return
- arm timestamp and delay from entry
- arm threshold (`unit`)
- arm-bar intrabar MFE
- arm-bar close profit for the Short (`1 - close / entryPrice`)
- `closeConfirmedArm = closeProfit >= unit`
- confirmed failure timestamp and delay
- candidate termination reason
- arm/failure snapshots for existing relative return, BTC return, ATR, volume ratio, RSI and EMA distance

No candidate is selected or tested by this diagnostic. No thresholds are introduced. KuCoin performance remains unopened.