# PRISM VII / P6B — 取引の疎な市場向け相場状態機械（結果閲覧前に固定）

**Research only.** P6 original strict model remains frozen; this is a **new, separately labeled P6B** model. The only development change is missingness/observation handling, not changing the 4 seller + 4 buyer economic vote themes. Do **not** treat missing bars as candles/trades; do **not** veto old 53 natural signals. 53 candidates + original native outcome and 320 fixed synthetic generator paths remain unchanged.

P6 strict failed DATA_INSUFFICIENT on 35/53 because 18 positive 5-min prints per last3h and 36 per last6h were too demanding; source coverage-only diagnostic: source positive 25h hourly bucket count per candidate {15:1,18:1,19:2,20:1,21:5,22:3,23:2,24:8,25:30}; 23 candidates contain at least one full no-print hour. Across 53, BTC had full 25h buckets. This prompted coverage changes below, **not fitted on any win/loss labels.**

## Frozen source/observation contracts

Every decision at completed hour T. Only positive-volume M5 print OHLC with `ts+5m<=T` are known. BTC and PENGU supplied from same public M5 archives (one known off-window invalid BTC OHLC timestamp is quarantined and published); no synthetic fill or price interpolation.

- Must have at least **15 of 25** previous calendar hourly PENGU buckets with at least one traded M5 and last hour printed, at least **3** printed M5 in last3h, **6** in last6h, and nonzero traded volume in both last3h and preceding3h. Missing => DATA_INSUFFICIENT; do not convert to winning signal, and retain original trade-intent count.
- The 24h trade-aware ATR is the mean of printed hourly true ranges against the previous printed hourly close **only when the gap between printed hourly buckets is <=3h**. Require at least **12** such true ranges, bounded to last25h, and anchor to last printed-hour close. If inadequate => DATA_INSUFFICIENT. Publish gap counts and ATR difference vs pinned H1. Do not synthesize zero-volume OHLC.
- Anchored price return3h and 6h uses the most recent printed hourly close at or before T-3h / T-6h respectively, with age <=3h relative to anchor; otherwise unavailable. BTC similarly.
- Structure: compare up to last **six positive-print hourly buckets**, only adjacent comparisons where their hourly open-start time differs <=2h. At least 3 comparable pairs (or data insufficient). Lower high / lower low persistence score uses ratio >=0.75. An absorption event requires an undercut of prior printed hourly low followed by a close above that prior low, counted only over valid pairs.
- Seller votes = same four P6 mechanisms: (a) >=75% comparables simultaneously lower high and lower low; (b) last3h PENGU return<= -0.5×ATR; (c) 3h relative underperformance to BTC<= -0.5×ATR; (d) negative last6h return and efficiency>=0.35 using positive-print close sequence.
- Buyer votes = same four P6 mechanisms: (a) >=2 failed-low-break absorption hours; (b) last3h volume-weighted taker buy fraction>=.60 and >=.10 increase vs preceding3h; (c) printed close rebounded>=1×ATR ratio from last6h printed low; (d) PENGU and BTC both increased >0.5×ATR in 3h.
- State `SELLER_CONTINUATION` if seller>=3/buyer<=1; `BUYER_ABSORPTION_REVERSAL` if buyer>=3/seller<=1; else `TRANSITION_OR_CONFLICT`, missing => `DATA_INSUFFICIENT`.

## Dual evaluation and anti-overfit criterion

1. Repeat all original native53 ID, date/exit, 29 wins /24 losses PARITY, record P6 vs P6B state transitions per individual; 11 no-favorable failures and 29 source winners retained, not vetoed.
2. Exact same function, parameters, and observation quality flags on **320 synthetic M5 paths, 42 hourly checkpoints/path**, reference P7-4 frozen generator. The artificial future6h gross SHORT return is a *diagnostic target*, never used as feature; existing censored target contract applies.
3. Prefix-invariance test: appending arbitrary future candles, truncating future after T or perturbing a price after T cannot change state. Missing-input and zero-print tests. Compare synthetic by regime, count false seller states in rising, squeeze and divergent regimes, and quantify `DATA_INSUFFICIENT`.
4. No thresholds may be tuned to the outcome53 after executing; poor directional separation or failure on synthetic triggers **REJECT**, not an opportunistic P6C rename without new mechanism and evidence. All 53 remain intents; a not-traded gate can only be a separate (so far unproven) economic hypothesis.

Do not claim this constitutes native PENGU SHORT V20 new ENTRY, live exchange execution, Sharpe, 80% win rate, independent OOS, Funding, Gross, compounding, or DD20% until pinned source signal/STOP and shared portfolio path are replayed.
