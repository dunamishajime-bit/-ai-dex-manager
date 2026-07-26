# Aster-only V50 / V51 Standalone Post-Open Basis Result

## Decision

A standalone AsterDEX-only engine exceeding the requested +50% annual Normal hurdle was identified.

Recommended research name:

`V50-FROZEN_POST_OPEN_BASIS__V51-AUDITED`

Frozen candidate:

`POST_EARLY3__B75__H3__BOTH__NONE`

This is one economic strategy, not a router of unrelated strategies. It repeatedly applies the same synchronized U.S. cash-versus-Aster Basis-convergence rule at 11:30, 12:30 and 13:30 New York time.

## Independence

- V11-EQ 10:30 trades excluded;
- V19 excluded;
- V48 excluded;
- Crypto V96 excluded;
- no portfolio or router return included;
- AsterDEX is the only execution venue;
- Hyperliquid is not used;
- maximum concurrent Gross is 1.0;
- maximum one position at a time.

## Frozen rule

- At 11:30, 12:30 and 13:30 New York, compare each Aster stock perpetual with its synchronized U.S. cash-equity reference.
- Require absolute entry Basis of at least 75 bps.
- Require signal and entry Basis to retain the same sign.
- Reject more than 10 bps of adverse Basis expansion before entry.
- Select the largest absolute eligible Basis among AMZN, META, MSFT, NVDA and TSLA.
- Aster premium: Short Aster.
- Aster discount: Long Aster.
- Exit when Basis reaches 15 bps, crosses zero, expands to 1.5 times entry Basis, or three hours pass.
- No simultaneous positions; maximum three sequential trades per day; daily loss stop -2%.

## Exact trailing-365-day standalone result

Period: 2025-07-25 inclusive through 2026-07-25 exclusive.

| Scenario | Return | PF | Trades | Maximum DD | Capital hours | Net bps/capital-hour |
|---|---:|---:|---:|---:|---:|---:|
| Forward median 24 bps | +105.853471% | 5.575528 | 106 | -3.669319% | 241 | 30.430728 |
| Normal 40 bps | **+73.915217%** | **3.337497** | **106** | **-4.136789%** | 241 | **23.393383** |
| P95 44 bps | **+66.730178%** | **2.992125** | **106** | **-4.313894%** | 241 | **21.634047** |
| Severe 100 bps | 0.000000% | n/a | 0 | 0.000000% | 0 | 0.000000 |

Normal symbol counts:

- AMZN 27;
- META 26;
- MSFT 27;
- NVDA 13;
- TSLA 13.

Positive-profit symbol concentration was 22.0753%, below the 40% maximum.

## Selection discipline

The candidate was selected only by the predeclared Development score: Development Normal return plus Development P95 return among the 64 candidates that passed the frozen Development gate.

Validation, Final and July Holdout were not used to select the candidate.

Development result:

- Normal +49.203923%;
- P95 +44.758196%;
- 76 trades;
- Normal PF 3.290834;
- Normal DD -3.928763%.

## Chronological post-selection evidence

| Segment | Normal return | P95 return | Normal trades | Normal PF | Normal DD |
|---|---:|---:|---:|---:|---:|
| Validation | +4.276890% | +4.111877% | 4 | 11.561364 | -0.400000% |
| Final reused | +7.423803% | positive | 19 | 2.330648 | -4.136789% |
| July Holdout | +4.056388% | +3.767020% | 7 | 11.000869 | -0.400000% |
| Combined post-Development | **+16.562094%** | **+15.178403%** | **30** | **3.469899** | **-4.136789%** |

All three post-selection blocks were Normal/P95 positive.

## Cost stress

| Round-trip cost | Full return | Post-Development return | Full PF | Full DD | Full trades |
|---|---:|---:|---:|---:|---:|
| 50 bps | +56.500410% | +13.132595% | 2.562814 | -4.888987% | 106 |
| 60 bps | +32.705714% | +6.418143% | 1.888194 | -5.840565% | 92 |

## Robustness

Every leave-one-symbol-out test remained Normal/P95 positive for both the full period and combined post-Development period.

Full Normal after removing each symbol:

- AMZN removed: +53.338790%;
- META removed: +56.904634%;
- MSFT removed: +49.319346%;
- NVDA removed: +53.090690%;
- TSLA removed: +59.048175%.

Every entry-window ablation remained full-period and post-Development Normal/P95 positive. Removing the dominant 11:30 window still produced full Normal +29.629602% and post-Development Normal +11.704182%.

Best-trade removal, best-month removal, concentration and Severe fail-closed checks passed.

## Original V50 gate

V50's original strict rule required at least eight trades inside the narrow fixed Validation block. The Development-selected candidate had four Validation trades, so the original V50 gate remains failed and was not rewritten after observing the result.

V51 adds an extended post-selection audit of 30 later chronological trades. V51 passed every declared extended stress check, but it does not create an independent future Holdout.

## Classification

`HISTORICAL_STANDALONE_50PCT_ENGINE_FOUND__FORWARD_SHADOW_REQUIRED`

The annual standalone-profit requirement is met. The candidate is materially different from V48 because it earns +73.9% on its own rather than contributing approximately +9% to another router.

It is not yet approved for direct Production or LIVE promotion because the strategy family was developed on overlapping historical data and the original narrow Validation count was insufficient. The correct next evidence is no-order Forward Shadow with live Pyth/Alpaca cash references and actual Aster order-book costs/fills.

## Evidence

- PR: #94
- V50 workflow run: `30194297048`
- V50 artifact: `8629603881`
- V50 artifact SHA-256: `d940fe13fd138465f516716a390f149c803e2c0bf06fa655b6fd7064e2a91a8c`
- V51 workflow run: `30194468295`
- V51 artifact: `8629656880`
- V51 artifact SHA-256: `c852f256913aac0f5ec2cb5aa6eb9acf5aa98ec72295fc823a4ccf3455b4bc8f`
- CI backtest and safety validation: success

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, V96, current V11-EQ, V19 and V48 were not changed.
