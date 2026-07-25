# Aster-only V22 V11-EQ Primary / V19 Fallback Result

## Status

`ASTER_ONLY_V22_ROUTER_DID_NOT_PASS_STRICT_HURDLES`

The practical Aster-only router exceeded the raised annual return, P95, Profit Factor, drawdown, trade-count, concentration and removal hurdles. It remains a strict failure because the frozen chronological Validation segment contained only four accepted Normal trades versus the predeclared minimum of eight.

No Production or LIVE promotion is authorized.

## Architecture

- AsterDEX only;
- V11-EQ evaluated first at 10:30 New York;
- frozen V19 Z-score Basis fade evaluated at 12:30 only when V11-EQ is not accepted;
- maximum one Stock position per day;
- Gross 1.0 maximum;
- no Hyperliquid collateral;
- Crypto V96 capital priority required before any future Production consideration.

## Exact period

- Start inclusive: 2025-07-25 00:00 UTC
- End exclusive: 2026-07-25 00:00 UTC
- Calendar span: 365 days
- Aligned U.S. sessions: 247

## Main exact-year comparison

| Architecture | Normal return | P95 return | Normal PF | P95 PF | Normal trades | P95 trades | Normal DD | P95 DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| V11-EQ only | +59.791949% | +56.497767% | 5.666997 | 5.162719 | 61 | 60 | -4.313048% | -4.734913% |
| V11-EQ primary + V19 fallback | **+72.276908%** | **+68.080022%** | 4.656080 | 4.349727 | 85 | 82 | -4.313048% | -4.734913% |

The routed architecture selected 61 V11-EQ trades and 24 V19 fallback trades under Normal. Its positive-profit concentration was 37.3245%, below the frozen 40% maximum.

Normal capital efficiency:

- V11-EQ only: 22.864333 bps per capital-hour;
- routed V11-EQ + V19: 22.076399 bps per capital-hour.

The fallback increased annual return and diversification, while slightly reducing average capital-hour efficiency.

## Chronological results for the routed architecture

| Segment | Normal return | P95 return | Normal trades | P95 trades | Normal PF | Normal DD |
|---|---:|---:|---:|---:|---:|---:|
| Development | +48.919058% | +45.933930% | 51 | 51 | 4.856565 | -4.313048% |
| Validation | +2.136339% | +2.560906% | **4** | 2 | 5.328211 | -0.492587% |
| Final reused segment | +8.197510% | +7.530928% | 24 | 23 | 3.397057 | -1.016897% |
| July Holdout | +4.683740% | +4.434641% | 6 | 6 | 6.807502 | -0.400000% |

Validation was profitable and high quality, but it did not contain the frozen minimum of eight Normal trades. The count requirement is not relaxed after observing the result.

## Strict checks

Passed:

- Development Normal/P95 positive;
- Validation Normal PF at least 1.20;
- Validation Normal/P95 positive;
- final chronological Normal/P95 positive;
- July Holdout minimum trades and Normal/P95 positive;
- exact-year Normal at least +50%;
- exact-year P95 at least +30%;
- Normal PF at least 1.50;
- DD no worse than -15%;
- at least 50 Normal trades;
- positive-profit concentration at most 40%;
- best-trade-removed Normal/P95 positive;
- best-month-removed Normal/P95 positive;
- Severe non-negative through fail-closed behavior.

Failed:

- Validation minimum eight Normal trades: only four.

## V11-EQ-only interpretation

V11-EQ alone also exceeded the annual return threshold:

- Normal +59.791949%;
- P95 +56.497767%;
- PF 5.666997 / 5.162719;
- 61 / 60 trades;
- DD -4.313048% / -4.734913%.

It failed the same Validation-count requirement because the frozen Validation segment contained only one accepted trade. It also failed the 40% concentration rule at 42.2667% Normal.

## Evidence quality

This is an observable historical proxy, not an exact execution backtest:

- cash history is Yahoo 60-minute data rather than Pyth ticks;
- Aster history is 30-minute candle and Funding data;
- exact historical spread, depth, queue position, post-only fill probability and partial fills are unavailable;
- V11-EQ and V19 were developed using overlapping earlier history;
- the July Holdout is short.

Therefore the correct classification is a **high-return Forward-Shadow lead with insufficient chronological Validation sample**, not a Production candidate.

The next valid evidence is live no-order Pyth/IEX/Aster order-book Shadow collection until the strategy accumulates enough untouched eligible signals. More threshold searching on the same five-symbol history is not valid.

## Evidence

- PR: `#87`
- Workflow run: `30173752501`
- Artifact: `8623635968`
- Artifact SHA-256: `7e768e7914733e62886df6a65b88414527d9e99e8a773eecf4844543d28dcc09`
- CI backtest: success
- CI safety validation: success

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ runtime, credentials, orders and positions were not changed.
