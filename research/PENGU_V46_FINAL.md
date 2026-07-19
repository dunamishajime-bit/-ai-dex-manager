# PENGU Long / Short Dual Engine V46 — Final Paper Candidate

## Status

- Engine: `PENGU_DUAL_ENGINE_V46`
- Portfolio runner: `DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46`
- Mode: `PAPER_FORWARD`
- Real trading: disabled
- PENGU allocation: `0.15` gross per active side
- Long and Short are mutually exclusive
- Maximum combined portfolio gross: `2.00`

## Long engine

Evaluated every six completed hourly candles. Entry is the next completed hourly open and the holding window is 24 hours.

Required conditions:

- PENGU close above SMA72 and SMA168
- SMA168 above its value 48 hours earlier
- current six-hour momentum above +1%
- six-hour momentum observed 12 hours earlier no greater than 0%
- 24-hour momentum above 0%
- 120-hour momentum above +2%
- PENGU minus BTC relative momentum above +1% over 48 hours
- PENGU minus BTC relative momentum above 0% over 120 hours
- RSI14 between 45 and 72
- recent/base volume ratio at least 0.8
- latest funding rate no greater than 0.0003
- BTC risk filter permits Long

Funding history failure is fail-closed for Long. It does not create a Long signal without current funding coverage.

## Short engine

Evaluated every six completed hourly candles. Entry is the next completed hourly open and the holding window is 24 hours.

Required conditions:

- PENGU close below the prior completed 24-hour low
- six-hour momentum below 0%
- recent/base volume ratio at least 0.8
- BTC risk filter permits Short

Short is blocked when BTC is above SMA168 and BTC 72-hour momentum is above +4%.

## Direction changes

Aster one-way mode is preserved.

- Long to Short: close the Long with a reduce-only SELL first
- Short to Long: close the Short with a reduce-only BUY first
- the opposite position may be opened only on a later runner tick
- one order is submitted per tick
- open orders block rebalancing
- pending and unknown orders are reconciled before a new action is planned

## V46 evidence

Selection used development data and four pre-holdout folds. The final holdout was read only after the conservative tie-break selected the Long gate.

Selected Long gate: `G44_SMA168_SL48_M120_2p0_R120_0p0`

Selected Short rule: `S_BREAKDOWN_F6_S24_T0p0_A0p0_V0p8_FR0p0_BRISK_TIME24`

| Engine | Window | Trades | Return | PF | Severe | Max DD |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Long | Pre-holdout | 6 | +20.1666% | 3.9639 | +19.2726% | -4.8442% |
| Long | Frozen confirmation | 3 | +1.5509% | 1.5474 | +1.2186% | -4.5835% |
| Short | Pre-holdout | 21 | +66.7826% | 2.9459 | — | — |
| Short | Frozen confirmation | 4 | +7.5499% | 3.3616 | +7.0864% | -3.2036% |
| Combined | Frozen confirmation | 7 | +9.2219% | 2.4784 | +8.3937% | -4.5835% |
| Combined | Full PENGU history | 27 | +99.5831% | 2.9302 | +93.1635% | -10.2442% |

## Limitations and promotion boundary

- PENGU history is materially shorter than the V35 core history.
- The final window is reused confirmation, not pristine forward evidence.
- Historical order-book depth, taker flow, spread compression and basis were unavailable for the full backtest. V19 uses these only as forward execution vetoes.
- V46 therefore runs in Paper Forward mode.
- Live promotion requires new forward Long and Short trades, stable Aster data coverage, positive severe performance and a separate reviewed commit changing the immutable live flags.
