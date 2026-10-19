# Idle SHORT clustered-loss entry-gate replay — 2026-10-19

**Status: REPRODUCIBLE RESEARCH ONLY. Not a full integrated causal BT, not LIVE authorization.**

Source branch: `research/idle-short-cluster-risk-audit-20261019`.
Reproducible script: `research/idle_short_cluster_guard_frozen_replay_20261019.py`.

## Source evidence and data integrity

The original fixed accepted Idle candidate ledger covers 2025-08-14 through 2026-07-29, comprising exactly **61** admitted SHORT entries, **48 positive / 13 negative**. Causal H1 features for **61/61** accepted entries match `research/idle_priority_393_generic_candidate_features.csv` on `(symbol, entry_ts_ms)`; no entry returns are used in entry decisions.

SHA-256 of the input files as verified by a separate Windows BT worktree:

- `research/idle_priority_61_intents.json`: `2262cc6b2433fb25c200eee399ad4135e76a40ecf654bf1b7b0eb7655aa8865d`
- `research/idle_priority_61_target_net.json`: `19a700170010d0c392fde05bc8c6a861cb59eb3e64eed596c1686556a7c711a0`
- `research/idle_priority_393_generic_candidate_features.csv`: `8dc3a7d2b532bec1007e6fa7447c09d43427693cfd4b4e7462907dd90eb312e7`

The research script was executed successfully on the owner's isolated Windows research checkout with exit code 0, 61 intents and 48 wins verified. This is a **conditional fixed-intent return replay**, not the original BT engine rerunning every core strategy after an omitted Idle entry.

Method: gross-weight the prior verified 10bps net linear SHORT return by 1x for TAO/JUP/TIA and 0.25x for DOT/RENDER. In 20/30bps comparisons, subtract the additional 10/20bps roundtrip cost from gross-weighted net returns. PF is computed over these gross-weighted profits/losses, not the historical formal engine wallet PnL. The simple **sum of contributions is neither yearly compounded portfolio return nor MAX DD**.

## Core scenario comparison (frozen 61-admitted-entry stream)

| Filter | Trades | Winners | WR % | PF at 10bps | Gross-weighted sum % (10bps) | Max overlapping Idle Gross |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 61 | 48 | 78.69 | 5.861 | +76.183 | 2.25x |
| No second entry in same H1 | 60 | 47 | 78.33 | 5.760 | +74.610 | 2.25x |
| Max two concurrently open | 60 | 47 | 78.33 | 5.787 | +75.029 | 2.00x |
| Idle short Gross cap 2.0x | 60 | 47 | 78.33 | 5.787 | +75.029 | 2.00x |
| Idle short Gross cap 1.5x | 57 | 45 | 78.95 | 5.846 | +69.854 | 1.25x realized on ledger |
| At least 6h between new Idle entries | 56 | 44 | 78.57 | 5.695 | +67.680 | 2.25x |
| At least 24h between new Idle entries | 41 | 33 | 80.49 | 10.564 | +58.356 | 1.00x |
| ATR ratio <= 2.5% | 58 | 47 | 81.03 | 10.762 | +82.945 | CHECK SCRIPT |
| ATR ratio <= 2.7% | 60 | 48 | 80.00 | 9.953 | +82.627 | CHECK SCRIPT |
| ATR<=2.5% + Gross<=1.5x | 54 | 44 | 81.48 | 11.583 | +76.616 | <=1.5x |
| ATR<=2.5% + same-H1<=1 + Gross<=2.0x | 56 | 45 | 80.36 | 10.441 | +80.219 | <=2.0x |

The different PF level from the historical formal Idle sleeve PF ~6.58 is explained by this separate gross-weighted frozen-return diagnostic, not a formal wallet replay.

## 10/20/30bps cost sensitivity

| Variant | 10bps PF / sum% | 20bps PF / sum% | 30bps PF / sum% |
|---|---|---|---|
| Baseline 61 | 5.861 / 76.183 | 5.393 / 72.258 | 4.952 / 68.333 |
| ATR<=2.5%, 58 | 10.762 / 82.945 | 9.664 / 79.245 | 8.658 / 75.545 |
| ATR<=2.7%, 60 | 9.953 / 82.627 | 8.957 / 78.802 | 8.042 / 74.977 |
| Gross<=1.5x, 57 | 5.846 / 69.854 | 5.395 / 66.329 | 4.966 / 62.804 |
| ATR<=2.5% + Gross<=1.5x, 54 | 11.583 / 76.616 | 10.412 / 73.316 | 9.327 / 70.016 |
| ATR<=2.5% + 1 per H1 + Gross<=2x, 56 | 10.441 / 80.219 | 9.387 / 76.719 | 8.422 / 73.219 |

## Why the apparent ATR win is not production-certified

- ATR > 2.5% veto removes 2026-01-31 RENDER loss -2.93% (0.25x weighted -0.732%), 2026-02-06 JUP loss -6.44% (1x), **but also** 2026-02-05 TAO **win +0.41%** (1x).
- ATR > 2.7% veto removes **only** the single 2026-02-06 JUP -6.44% loss.
- Thus the PF jump is dominated by **one** historical major loser, and the ATR cutoff was inspected on the outcomes. Treat the apparent improvement as an overfitting risk, not prospective alpha.
- Splitting at 2026-05-01: 45 earlier / 16 later accepted baseline rows. Both ATR<=2.5% and ATR<=2.7% leave the later **same 16 trades / 13 winners / 23.343% gross-weighted sum**, i.e., the later slice has **zero triggered ATR vetoes**. This cannot demonstrate out-of-sample benefit or harm from the ATR rule.
- Extreme high ATR can also precede very profitable SHORT entries: 2026-04-10 TAO was +13.34% at ATR 2.46% and is **lost** if the gate is excessively tight at 2.3%.

## The live 2026-10-19 event is outside the historical BT

Authenticated recent state showed TAO SHORT -0.241 at 256.08, JUP SHORT -22 at 0.2803, and TIA SHORT -103 at 0.5947. The initial absolute notionals approximately total **129.136 USDT** against roughly **61.82 USDT** wallet, equivalent to 2.09x gross. A 10% linear adverse price move from each original entry amounts to **12.914 USDT**, roughly **20.9% of that wallet** *before fees, mark gaps and slippage*; this is a scenario bound, not a claim about exact observed resident STOP triggers.

Journal:
- JUP Idle entry: 2026-10-19 01:17 JST.
- One Idle decision at 2026-10-19 05:00 JST produced **two orders at 05:26:40** (TAO/TIA attribution must be finalized against per-order fill lineage).
- At 05:26:04, before the two orders, the **portfolio** unrealized PnL was **+0.055 USDT**. Hence a negative-unrealized-only add-on veto may not have blocked the initial addition.
- Current Idle code permits entries by gross room and same-symbol ownership while lacking portfolio open-STOP-loss-at-risk checks and a one-per-H1 new SHORT cap. Current Shared Risk 7.5% stops **new** orders and is not a universal portfolio 7.5% closing STOP.
- This exact 2026-10 pattern is **not present in the frozen historical 61 intents**, so these annual replay tables cannot be presented as proof that a proposed gate would fix the recent event without new causal replay.

## Research priority: avoid suppressing high-quality core strategy

**First, re-run formal causal market H1/5m and integrated Gross/cashflow lifecycle BT** with actual requested candidates, rest-of-stack re-admission, fees/funding, venue minQty, delayed execution, resident STOP prices, forward mark and BTC features. Determine max hourly MTM DD and integrated terminal equity at 10/20/30bps, which are **not calculated here**.

Independent variants to compare:
1. Account-wide *same-side SHORT basket* initial STOP-at-risk cap: test 10%, 12.5%, 15%, 20% **of live equity** vs existing per-position STOP distances (price risk rather than scalar leverage). Never assume 7.5% STOP-risk cap is compatible with mandatory 1x initial stop distance 10%: such a cap would block every new 1x TAO/JUP/TIA trade.
2. One new Idle SHORT per finalized H1 tick, with stable score- or risk-based priority fixed before the forward HOLD segment, not retrospectively chosen by realized returns.
3. Dynamic loss-veto/profit-locked add: signed existing side-position mark and verified protective STOP, reject adds if underwater, or if not enough *locked* profit is protected. Replaying this requires hourly price and historical STOP states. The frozen fixture **cannot** test this condition.
4. Candidate H1 signal-to-order age 5/10/15/30 minutes, completed 5-minute bounce/rally veto, BTC short regime; requires timestamp-accurate venue quotes and rate-budget scheduling.
5. ATR 2.5/2.7% as forward **shadow** gates only until a fresh, triggered OOS sample supports benefit.

## Daily risk correction must be separate

Current writer treats full unrealized loss including overnight carry as daily loss:
`lossPct=max(0,-(realizedToday+feesToday+fundingToday+entireCurrentUnrealizedPnl)/(walletBalance-(realizedToday+feesToday+fundingToday))*100)`.

Audit and test a precise UTC-day incremental MTM loss metric, **while retaining a separate absolute account drawdown and resident-STOP risk cap**. This research report does not change a live latch, reset a tripped flag, authorize new entries or touch active positions.

## Next acceptance

- Reproduce frozen 61/48, all 61 causal feature joins and script output; preserve SHA256s and original BT anchors.
- Run full historical native H1 replay + event-level gross and stop with honest future-free fills, 10/20/30bps, detailed wins/losses/missed wins and DD.
- Independently test 2026-10-19 event at original price/clock and whether each variant would have admitted JUP, TAO, TIA.
- Require robust forward-triggered OOS, not zero-veto HOLD, before parameter promotion.
- No LIVE switch or orders from this PR.

## Additional causal closed-loss cooldown experiment

A separate **entry-time causal** frozen replay activated portfolio-wide Idle SHORT cooldown **only after a previously admitted position actually exited at a realized negative return**. Previous exits at or before the candidate entry clock were processed first; skipped trades do not subsequently contribute phantom loss alerts.

| Cooldown after any closed loser | Accepted | Winners | PF 10bps | Weighted return contribution 10bps |
|---|---:|---:|---:|---:|
| None | 61 | 48 | 5.861 | +76.183% |
| 6h | 60 | 47 | 5.766 | +74.704% |
| 24h | 58 | 46 | 6.049 | +74.732% |
| 48h | 56 | 44 | 5.707 | +69.671% |

The 6h cooldown excluded a **winning JUP** trade (+1.479% weighted), while the 24h cooldown excluded two winners and one smaller loser. This does **not** support automatically imposing a broad post-realized-loss pause. It is not a substitute for a fresh *open-position* PnL / resident STOP risk check at a new admission.

## Historical full-portfolio anchor was independently replay-verified; changed-variant DD is still unknown

Separately ran the untouched `docs/research/results/trail020-idle-doge-avax-controlling-20261002/replay-ledger.py` on the archived **Trail0.20 + Idle + DOGE/AVAX** portfolio ledger (this is **a different older portfolio composition than the current V4/Exit Overlay production**). All three immutable original reference assertions passed:

| Cost | Historical base entries | Profit factor | Official historical max H1 MTM DD | Official historical final equity JPY |
|---|---:|---:|---:|---:|
| 10bps | 1,390 | 2.3323 | -21.3596% | 1,319,918,379 |
| 20bps | 1,388 | 2.0916 | -22.2766% | 418,296,811 |
| 30bps | 1,382 | 1.8747 | -23.3606% | 118,566,759 |

These are exact **prior unchanged historical reference values**. Do not transplant them into ATR/gross candidate variants or claim that current production would earn them. The new strategies' integrated DD, trade re-admission, formal compounding and liquidity have **not** been re-simulated: only the frozen 61 accepted-intent filter replay has been executed.

## Priority for next work

The combined ATR<=2.5% + Gross<=1.5x filter left 54 entries, 44 winners and 10 losers in the fixed replay with 10bps weighted sum +76.616%, 20bps +73.316%, and 30bps +70.016%. The gross restriction limits nominal initial resident-STOP-at-risk to <=15% of equity (actual accepted historical maxima were 1.25x / 12.5%) before costs and slippage. The historical aggregate benefit over unchanged source (+0.433 percentage points of weighted return) is **not robust proof**: about 95% of the ATR-only gain came from removing a single major JUP loss, and the forward HOLD slice had no affected ATR trades. Treat this as a candidate for price- and ownership-causal formal validation, not a deployable policy.
