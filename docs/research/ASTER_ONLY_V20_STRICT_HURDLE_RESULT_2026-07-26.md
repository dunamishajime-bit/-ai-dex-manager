# Aster-only V20 Strict Hurdle Tournament Result

## Status

`ASTER_ONLY_V20_NO_STRICT_HURDLE_CANDIDATE`

No AsterDEX-only candidate passed the raised acceptance standard. Production, LIVE and VPS remain unchanged.

## Raised hurdles

A candidate was required to satisfy all of the following:

- exact trailing-year Normal return at least +50%;
- exact trailing-year P95 return at least +30%;
- Normal Profit Factor at least 1.50;
- Normal maximum drawdown no worse than -15%;
- at least 50 accepted Normal trades;
- positive Development, Validation, final chronological segment and July Holdout under Normal and P95;
- at least three July Holdout trades;
- maximum one-symbol share of positive profit at most 40%;
- best-trade-removed and best-month-removed Normal/P95 positive;
- Severe non-negative through the fixed fail-closed cost gate.

The prior V19 candidate also fails immediately because its exact-year Normal/P95 returns were +14.687018% / +13.385861%.

## Tournament

- exact period: 2025-07-25 through 2026-07-24;
- 247 aligned U.S. sessions;
- 144 predeclared candidates across four economic families;
- AsterDEX only;
- no Hyperliquid;
- Gross 1.0 maximum;
- maximum one position at a time;
- one- or two-hour holding;
- chronological 11:30 / 12:30 / 13:30 opportunities;
- later Entry allowed only after the earlier position exits;
- daily loss lock -2%;
- Normal 40 bps, P95 44 bps and Severe 100 bps round-trip assumptions.

Twenty candidates passed the Development screen. Zero candidates passed the chronological Validation screen.

## Closest Validation diagnostic

`TIME_SLOT_ZSCORE_FADE__T2__EARLY_1130_1230__H2__NONE`

This candidate processes 11:30 and 12:30 New York in chronological order, enters only when flat, and holds for no more than two hours.

| Segment | Normal return | P95 return | Normal trades | Normal PF | Normal DD |
|---|---:|---:|---:|---:|---:|
| Development | +11.297914% | +9.798741% | 34 | 1.903122 | -5.898782% |
| Validation | +2.912871% | +2.800801% | 5 | 5.697117 | -0.616282% |
| Final reused segment | -3.508897% | -4.432359% | 24 | 0.637169 | -5.047431% |
| July Holdout | +0.019592% | -0.140338% | 4 | 1.027700 | -0.534998% |
| Exact trailing year | +10.542445% | +7.719621% | 67 | 1.448712 | -5.898782% |

Validation was positive but had only five accepted Normal trades versus the frozen minimum of eight. More importantly, the later chronological segment became negative and the July P95 result was negative.

## Strict-check outcome for the closest diagnostic

Passed:

- Development Normal/P95 positive;
- July minimum trade count;
- drawdown no worse than -15%;
- at least 50 full-year trades;
- positive-profit symbol concentration at most 40%;
- best-trade-removed Normal/P95 positive;
- best-month-removed Normal/P95 positive;
- Severe fail-closed non-negative.

Failed:

- chronological Validation pass;
- final reused segment Normal/P95 positive;
- July Holdout Normal/P95 positive;
- Normal return at least +50%;
- P95 return at least +30%;
- Normal PF at least 1.50.

Robustness diagnostics:

- best individual trade removed: Normal +3.945457%, P95 +1.329207%;
- best month removed (`2025-08`): Normal +2.581130%, P95 +0.118753%;
- full-year maximum positive-profit symbol share: 27.4391%;
- full-year Normal capital efficiency: 8.851039 bps per capital-hour.

## Interpretation

Allowing several causal intraday opportunities did not solve the return problem. It increased the closest candidate to 67 accepted Normal trades, but its later-period edge decayed and exact-year return remained only +10.54%.

The +50% minimum must not be reached by:

- adding leverage to a weak edge;
- lowering the cost assumptions;
- relaxing the Validation trade-count rule after seeing this result;
- retuning thresholds on the same final segment or July Holdout;
- choosing the full-year winner after inspecting all full-year outcomes.

Further nearby threshold searching on the same five-symbol history would be data mining. A valid next research cycle requires a materially different information set or universe, such as broader liquid Aster stock-perpetual coverage with survivorship-aware underlying-equity history and a new untouched Forward period.

## Evidence

- PR: `#87`
- Workflow run: `30173132780`
- Artifact: `8623471027`
- Artifact SHA-256: `2f4cb5cd937224efc27e37e4d78ac1162a4d8054d70d9f8a59e88b452f826d2f`
- CI backtest: success
- CI safety validation: success

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ, current V13D, credentials, orders and positions were not changed.
