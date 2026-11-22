# PRISM VII / P6 — SHORT方向状態・事前登録（結果を閲覧する前に固定）

Status: **RESEARCH ONLY — No strategy change; no Production/PENGU order, STOP or entry selection.**

Based on P7-5 finding: known 53 original SHORT candidates (29 win, 24 loss; "no favorable 1%" 11/24) were already studied. Simple as-of H1 8 features had poor discrimination (best AUC 0.596). Four previous exit protections destroyed native expected value. We now test *new time-ordered microstructure* on past **closed M5 candles** and the **same generator on synthetic regimes**. Do not optimize thresholds on the 53 labels.

## Frozen structural evidence and rules

All M5 time series are as-of: for a decision timestamp T, only bars with `openTime + 5m <= T` may contribute. No missing bars may be interpolated. Zero-volume bars have no tradable signed print and cannot establish a high/low sequence. Each decision requires at least 18 valid printed M5 bars in the last 3h, at least 36 in last 6h, and at least 12 printed hourly buckets in last 24h for stable structural evidence. Fewer prints => **DATA_INSUFFICIENT** (not a loss or rejection of original signal).

Precommit feature definitions:
- Bucket each of last six *completed* hours into an observed positive-volume OHLC range using printed M5 candles, not source H1 extremes; buckets without print are UNKNOWN. Count adjacent hourly **lower highs / lower lows**, computed on the prior six *fully completed* hourly buckets.
- Define **price acceptance of new lows** vs **failed low break / absorption**: for each of the six completed hourly buckets, its low undercut the prior hour low; if its close stayed above that prior low, mark an absorption event (only if both periods have valid prints). Repeated >=2 failed new-low attempts is buyer evidence.
- **Buyer pressure change**: last 3h traded-volume-weighted taker buy fraction minus preceding 3h, and whether last 3h share >=0.60 plus increase >=0.10.
- **Rebound following a local low**: current printed M5 close > 1.0x current pre-entry H1 ATR24 absolute price above the minimum printed low of last 6h (no future low). High relative deviation indicates risk of shorting into a live rebound, not a known future outcome.
- **Downside acceptance/efficiency**: last-3h M5 close return less than -0.5 current pre-entry ATR24 ratio *and* at least 4/5 hourly adjacent bucket high/lows decline.
- **BTC relative stability**: last-3h PENGU printed close return <= BTC printed close return by 0.5x ATR24 ratio indicates relative weakness; BTC last-3h return > +0.5x ATR24 ratio together with PENGU last-3h rising > +0.5x ATR24 ratio is buyer-side counterwind.

Fixed score (not trained, not fitted):
- `seller_votes`: (a) lower highs >=4/5 AND lower lows >=4/5; (b) 3h change <= -0.5 ATR; (c) PENGU <= BTC by >=0.5 ATR; (d) 6h negative signed close return and 6h trend efficiency >=0.35.
- `buyer_votes`: (a) >=2 failed low-break absorption hours; (b) 3h taker buying >=0.60 and >=0.10 stronger than previous3h; (c) rebound from 6h printed low >=1.0 ATR; (d) BTC and PENGU 3h return both >0.5 ATR.
- `SELLER_CONTINUATION` if seller >=3 and buyer <=1. `BUYER_ABSORPTION_REVERSAL` if buyer>=3 and seller<=1. Else `TRANSITION_OR_CONFLICT`. Missing inputs => `DATA_INSUFFICIENT`.

For real native53, report full 53 rows with **unchanged native PnL** / source win/loss, all state counts, 29 original winners lost *if states were used as an entry veto* and 11 wrong shorts correctly rejected *if vetoed* as purely diagnostic counterfactuals. **Never claim a rejected loss converted to a win.** Report win/24loss and 11 no-favorable separate, per-period, no sampled winner-only filter.

For synthetic markets, compute the same states on completed H1 boundaries of a fixed set of 320 scenarios × all decision hours with sufficient history. Compare known scenario labels with causal **future 6h SHORT close-price excursion** strictly as a *diagnostic target*; don't declare profit or trade signal success. The generator already exists from P7-4: 8×40 ×72h, including zero-print, BTC/PENGU divergence, squeeze transitions. These paths are artificial and scenario labels are known by construction, not independent venue truth.

Fail closed on source mismatch, missing printed bars, M5 time mismatch, future prefix-invariance violation. This rule must not be adjusted after seeing results without a *new* numbered hypothesis, and must be falsified by a different period / generator family before considering deployment.

### Precise ATR and hourly-bucket contract, clarified before P6 computation

The P6 engine must use the **same** ATR definition in native and synthetic tests: from the last 24 **completed**, contiguous M5-aggregated 1h buckets with at least one positive print per hour, plus the prior close to compute each hourly true range `max(high-low,abs(high-prev_close),abs(low-prev_close))`; ATR24 = mean of those 24 true ranges divided by the most recent completed H1 close. A positive-print M5 candle `[T,T+5m)` belongs only to the hour of its `openTime` if it CLOSED by the decision timestamp. A synthetic or real path with fewer than 25 complete hourly bucket closes must classify `DATA_INSUFFICIENT` rather than substitute a smaller ATR. Source pin's H1 ATR may disagree with the M5 reconstructed ATR and must be reported separately; it must not be silently substituted mid-experiment.\n
### Censored forward-label protocol (clarified before any successful P6 evaluation)

Synthetic future 6h gross SHORT return uses the last **positive-volume printed close at or before decision T within the prior 3 hours**, versus the last positive-volume close in `[T,T+6H)`. If either observation is missing, forward label is **CENSORED** and never filled by an unprinted candle or silently counted as 0% profit. All state classifications remain in the denominator of market-state coverage; censored labels are excluded only from outcome-return aggregates and reported explicitly. No signed trade execution is inferred.
