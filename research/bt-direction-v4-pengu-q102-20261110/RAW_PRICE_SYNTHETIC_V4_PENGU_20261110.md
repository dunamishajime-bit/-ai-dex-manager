# Raw-price synthetic V4/PENGU direction stress — 2026-11-10

**Research-only adversarial logic test. This is not profitability or OOS evidence.**

The test generates raw hourly price paths, computes the same return/volatility features used by the research gates, applies each gate, and compares the resulting direction with the deliberately constructed post-entry path.

## V4 standalone-gate findings

- REC_X05_TIME_36H: directional contradictions=5 ['low_vol_bear_continuation', 'relative_strength_bear', 'mild_3h_decline_then_bear', 'strong_3h_decline_then_bear', 'range_pre_breakdown']; missed synthetic bullish corrections=1 ['high_vol_bull_continuation']
- REC_X07_TIME_6H: directional contradictions=4 ['low_vol_bear_continuation', 'relative_strength_bear', 'mild_3h_decline_then_bear', 'range_pre_breakdown']; missed synthetic bullish corrections=0 []
- REC_X11_TIME_48H: directional contradictions=1 ['relative_strength_bear']; missed synthetic bullish corrections=2 ['symbol_bull_btc_stronger', 'range_pre_breakout']

Interpretation: the three simple V4 gates are **not sufficient as standalone direction classifiers**. They can still be valuable as components of a composite gate, but synthetic counterexamples exist where they flip SHORT→LONG while the constructed symbol path continues lower.

## PENGU Recovery V8 2h rescue

- Synthetic contradictions (rescue fires but post-decision path is bullish): 1 ['strong_pre_up_dip_then_bull']
- Synthetic missed bearish rescues (gate does not fire but post-decision path is bearish): 4 ['weak_pre_up_reversal_bear', 'strong_pre_up_shallow_dip_bear', 'strong_pre_up_exact_boundary', 'pre_down_bear_continuation']

Interpretation: V8 2h rescue has better causal structure than the simple V4 gates because it waits for an actual post-entry reversal. It is still not logically perfect: a temporary 2h dip followed by a V-shaped recovery is a counterexample, and threshold misses exist.

## Required next step

- Downgrade V4 X05/X07/X11 from standalone direction rules to **component candidates** until an absolute-trend/regime confirmation removes the synthetic contradictions without damaging OOS precision.
- Keep PENGU Recovery V8 2h as the strongest research candidate, but run threshold-jitter, walk-forward and V-shaped-recovery robustness before promotion.
- Continue V4 Y06 separation research before moving to another strategy family.
