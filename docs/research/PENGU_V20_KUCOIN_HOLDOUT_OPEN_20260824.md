# PENGU V20 — KuCoin Final Holdout Opening

Status: AUTHORIZED AFTER ALL KNOWN-VENUE GATES PASSED

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Frozen candidate

Candidate: `COUNTERWIND_VOL_TARGET_FAILURE_EXIT`

V20 pre-registration SHA: `ad7cedb3cafaf9f9680e390112f72375d84b50ac`

Parent V18 pre-registration SHA: `42bb6297d893125ad3b2de0a9e26dba342852223`

The first V20 run `32683461948` produced no strategy result: it stopped before source generation because an implementation marker expected one `costPerSide` declaration while the generated V18 source contained two. The implementation-only fix `8e7d05ff7ee3957e91a905c77060412190bbece0` scoped insertion to `transformShort`; no V20 rule, threshold, data, fee, or evaluation criterion changed.

Formal known-venue run `32683827489` then completed successfully with all frozen known-venue gates PASS:
- OKX strict gate: PASS
- Binance strict gate: PASS
- Gate diagnostic: PASS
- Bitget strict gate: PASS

Therefore the already-pre-registered KuCoin final holdout is now eligible to open. V20 itself is immutable from this point forward.

## Frozen KuCoin data contract

Use only official public KuCoin Futures market data for:
- PENGU perpetual: `PENGUUSDTM`
- BTC reference perpetual: `BTCUSDTM`
- H1 candles only; no synthetic candles, fill-forward, interpolation, or alternate venue data
- raw history begins at `2025-01-01T00:00:00Z`
- first eligible evaluation occurs only after 168 completed H1 warmup bars, at `2025-01-08T00:00:00Z`
- evaluation cutoff is `2026-08-01T00:00:00Z`
- official PENGU funding history is required for the evaluation interval

Funding completeness is fail-closed and is fixed before any KuCoin fetch:
- at least one official funding point must exist on or before the first eligible evaluation time;
- the final official funding point must be no more than 12 hours before the evaluation cutoff;
- consecutive official funding records may not contain a gap greater than 24 hours;
- no missing point may be synthesized or borrowed from another venue.

Candle completeness is fail-closed:
- both PENGUUSDTM and BTCUSDTM must contain the complete hourly grid from `2025-01-01T00:00:00Z` through the last completed H1 before the cutoff;
- any H1 gap blocks the holdout; no fill-forward or interpolation is permitted.

## Frozen evaluation

The exact V20 strategy and the exact existing Normal/Stress cost model are applied unchanged. No KuCoin-specific strategy rule, filter, threshold, sizing rule, timing rule, or cost adjustment may be introduced.

The final KuCoin PASS gate is the same strict gate used for OKX/Binance/Bitget:
- baseline logical events >=20;
- candidate logical events == baseline;
- progression-failure modified events >=2;
- Normal event win rate >= baseline +5 percentage points;
- Normal Return/PF/DD all non-worse;
- Stress event win rate >= baseline;
- Stress Return/PF/DD all non-worse;
- leave-one-best robustness Return delta >=0 in Normal and Stress;
- >=3/4 chronological folds non-worse in event win rate;
- >=3/4 chronological folds non-worse in Return.

If official KuCoin data are incomplete or unavailable, report `BLOCKED_HOLDOUT_DATA` and do not calculate strategy performance from substitute data. If strategy performance is calculated, the result is final for V20: PASS or FAIL. No V20 edit is allowed after observing it.

## Safety

- `RESEARCH_ONLY`
- ordersSent=false
- liveChanged=false
- vpsChanged=false
- productionChanged=false
- no synthetic LIVE orders
