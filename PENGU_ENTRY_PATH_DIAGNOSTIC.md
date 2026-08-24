# PENGU baseline Short entry-path diagnostic

RESEARCH ONLY. No candidate, no strategy change, no threshold search, no LIVE/VPS/orders/production changes.

## Purpose
Test whether current PENGU Short losses are structurally associated with execution immediately after the frozen Short signal at a materially different next-H1-open price, rather than with the signal direction itself.

For every untouched baseline Short logical event on OKX, Binance, Gate, and Bitget, record the same mechanical observations. The diagnostic does not alter entries or exits and does not calculate any alternative strategy performance.

## Frozen observations
At signal/entry:
- signal timestamp and signal close
- baseline next-H1-open entry timestamp and price
- `entryGapVsSignal = entryOpen / signalClose - 1` (negative means the Short chased price lower than the signal close)
- signal-time ATR24 ratio, PENGU 24h return, BTC 24h return, PENGU-vs-BTC relative 24h return, volume ratio, RSI14, EMA72 distance and BTC EMA168 distance

After the already-executed baseline entry, purely diagnostic 1h/3h/6h path statistics:
- maximum favorable excursion for a Short
- maximum adverse excursion for a Short
- end-of-window close return versus entry
- whether market high revisited the original signal close

Also record the untouched baseline Normal and Severe account returns/win labels.

## Interpretation contract
No numeric cutoff may be fitted from this diagnostic. A later entry candidate is allowed only if the same qualitative mechanism is visible across multiple venues. Any later candidate must use a mechanically defined pre-existing price/state boundary (for example the frozen signal close itself), be separately pre-registered before performance replay, and then pass the known-venue gates before KuCoin is opened.

KuCoin strategy performance remains unopened.