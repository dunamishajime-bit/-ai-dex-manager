# DisDex Idle exit research — 2026-10-16

**STATUS: COMPLETED RESEARCH / NO LIVE STRATEGY MODIFICATION AUTHORIZED**

Production is untouched. PENGU is unchanged. The results below are retrospective **price-model** backtests; they do not validate a venue partial-fill STOP lifecycle or predict future profits.

## Why the recent Idle exits gave back profits

The LIVE Idle SHORT strategy holds trades for 12h or 24h depending on route. The current emergency orders are **10% STOP and 25% TAKE_PROFIT** relative to the fill, rather than a profit-lock. Therefore a positive entry can become a negative fixed-time exit.

Original full-eight 10bps frozen accepted Idle legs: **47**. H1 **completed-close** max favorable movement versus final exit price:

| Route / symbol | n | Mean peak positive return | Mean actual price return at exit | Mean giveback |
|---|---:|---:|---:|---:|
| DOT Momentum / DOT | 21 | +2.42% | +0.50% | 1.92pp |
| RENDER Relative / RENDER | 12 | +0.89% | -1.62% | 2.51pp |
| TAO Breakdown / TAO | 6 | +4.47% | +3.30% | 1.17pp |
| TIA Breakdown / TIA | 4 | +6.29% | +5.15% | 1.14pp |
| JUP Relative / JUP | 4 | +1.43% | +0.84% | 0.59pp |

DOT and RENDER are the right **diagnostic priorities**. This does *not* imply entry-gate or exit-parameter changes are statistically certified: n is small and market regimes differ.

## Tested candidate classes

All pre-existing accepted entries, their quantity and original exit marks were held fixed for first-pass screens (10bps and 30bps).

1. **Universal +2% arm / +0.5% profit floor**: rejected; fixed-entry Idle PF fell 1.582 → 1.409 at 10bps.
2. **DOT/RENDER BTC three-hour rebound market exit**: arm only after completed H1 peak favorable +1.5%; close on next H1 open when BTC 3-hour completed close return >= +0.5%. Fixed-entry Idle PF improved 1.582 → 1.767 at 10bps and 1.374 → 1.615 at 30bps. But chronological first half *worsened* and the eight-strategy integrated equity deteriorated materially.
3. **Shorter DOT time exit**: 8,12,16,18h evaluated instead of 24h; all degraded frozen 10bps, and 12h harmed both 10bps/30bps. JUP 6/8h n=4 is insufficient to promote. RENDER 4h had inconsistent results across costs and temporal halves.
4. **Take half profit at +1.5%, +2%, +3% (DOT/RENDER only)**, remaining half at original exit. This was approximated using a **synthetic blended price** and left the **original full position slot and gross** in place. This is not a faithful venue partial-fill/capital/funding simulation.

### Original eight-strategy baseline versus Idle-only

| Case | 10bps final equity / PF / DD | 30bps final equity / PF / DD |
|---|---|---|
| Baseline (no changes) | JPY291,326,103 / 4.049 / -20.420% | JPY174,749,524 / 3.278 / -18.389% |
| Idle BTC3 rebound, DOT/RENDER | JPY275,882,854 / 4.025 / **-20.903%** | JPY152,289,535 / 3.210 / **-22.836%** |
| Idle half +1.5% synthetic, DOT/RENDER | JPY295,499,466 / 4.069 / -20.259% | JPY187,303,528 / 3.549 / **-19.068%** |

BTC3 timing is **not** a trade-off-free way to secure profits. The early-exit order changes which strategies subsequently occupy shared capital, so a frozen-trade improvement can become a full-account loss.

### Three-change Q102/V12 V4 proposal as existing research benchmark

**Research reference, NOT authorized LIVE:**
- Q102 MR: favorable completed H1 +3%; lock +1%.
- V12 V4 G5: +2%; lock +0.5%.
- V12 V4 X05: +2.5%; lock +1%.

At 10bps JPY302,658,260, PF4.1748, DD -20.2376%. At 30bps JPY198,928,950, PF3.6347, DD -18.3410%. External period had 3 V4 G5/X05 trades, **none activated** these floors; no demonstrated holdout improvement.

### Integrating Idle partial-close alternatives with the three-change proposal

These are **synthetic blended-price** account studies, **not independently certified real partial execution**.

| Alternative | Final JPY 10bps | PF / MTM DD 10bps | Final JPY 30bps | PF / MTM DD 30bps |
|---|---:|---|---:|---|
| **3-change only; no Idle change** | **302,658,260** | 4.1748 / -20.2376% | **198,928,950** | 3.6347 / -18.3410% |
| Idle 50% at +1.5% | 306,142,482 | 4.1955 / -20.0163% | 197,639,143 | 3.6479 / **-21.1903%** |
| Idle 50% at +2.0% | 302,234,167 | 4.1938 / -20.1662% | 195,731,263 | 3.6840 / -18.3397% |
| Idle +2.0%, **50bps extra slip** on half-close | 300,533,711 | 4.1907 / -20.2366% | 192,408,059 | 3.6735 / -18.5516% |
| Idle 50% at +3.0% | 302,416,275 | 4.1754 / -20.2467% | 195,429,476 | 3.6811 / -18.3878% |

**Decision:** The +1.5% half-profit model shows an in-sample 10bps equity benefit, but DD at 30bps deteriorates to -21.19%; reject for LIVE. The +2% half-profit has a small PF/DD advantage over no-Idle-change but **reduces final portfolio equity at both costs**; 50bps additional execution slippage erases much of the remaining appeal. There is currently **no robust incremental Idle exit replacement** worth deploying alongside the selected research baseline.

## Recent JUP/DOT checked only as an already-observed diagnostic

Public Aster 1h 2026-10-15 to 2026-10-16 replay:
- JUP SHORT entry 0.3048 qty225: under the BTC rebound screen, simulated exit **2026-10-15 18:00 JST at 0.2988** (+1.35 USDT price PnL, without fees).
- DOT SHORT entry 1.087 qty65.9: rebound screen would not have exited until **2026-10-16 00:00 JST at 1.097** (**-0.659 USDT** gross), after previously positive mark. Therefore a reaction rule alone cannot guarantee any profit lock.
- This is post-loss inspection, NOT independent future data.

## Operational concern: real protection and delayed exit

Source review confirmed the Idle Runner calls `assertOperatorActivation`, account/venue GET, full-market candle fetching and H1 diagnostics before its fixed-hold exit path. On the recent JUP trade a ~14-minute delayed exit was associated with rate-budget saturation and transient runtime approval/parity mismatch. **Potential early-expiry readback fast path** merits a separate safety-tested production patch, but has NOT been deployed in this research.

Snapshot at **2026-10-16 10:58 JST**: common Production SHA 020eb3c5b95186d23bd6406af1986747d442a5bd; independent V12 V4 6f97d2cf03877674ec1a845f6c08414f32899f36; shared Kill Switch inactive; **Shared Risk tripped=true**, recorded loss around 7.59% vs daily limit 7.5%; one DOT SHORT remains in local Idle state with protection verified in ledger. Do not interpret that ledger as a fresh independently signed Aster certification. No existing order, STOP, Kill Switch or new-entry risk gate was modified.

## Forward and venue acceptance criteria

Before changing live Idle exit logic:
- Freeze candidate parameters *before* new events and collect independent fresh entry/trigger/fill events with varied regimes and a meaningful sample. Current 47/53 historical Idle legs and 4 JUP events do not show robust forward expectancy.
- For a partial close, reconcile exact Aster actual fill quantity/price, update or replace **both STOP_MARKET and TAKE_PROFIT_MARKET reduceOnly protection quantities**, read back, prevent duplicate/stale protections, preserve same-symbol ownership, account lock, margin and pending-gross across restarts. Catch unknown order outcomes without blind retries.
- Include actual early released collateral and reservation accounting, funding, fees, quantity-step/notional floors, venue price gaps, time synchronization and BTC H1 boundary causal timing, 10bps/30bps and extra 50bps stress, full-eight portfolio risk.
- Do not bypass Shared Risk 7.5%, operator artifacts, SHA parity, V4 orderEnabled gates, shared Kill Switch or venue readback for a research result.

## Source and verification

Reproduction source on branch `research/idle-profit-exit-validation-20261016`:
- `scripts/research/idle_conditional_exit_sweep_20261016.py`
- `scripts/research/idle_fixed_hold_sweep_20261016.py`
- `scripts/research/idle_partial_exit_sweep_20261016.py`
- `scripts/research/idle_btc_rebound_integrated_20261016.py`
- `scripts/research/idle_partial_synthetic_full8_20261016.py`
- `scripts/research/test_idle_exit_research_20261016.py`

Scripts require the exact frozen original research worktree pointed to by `DISDEX_V4_FROZEN_RESEARCH_ROOT`, with optional isolated `DISDEX_EXIT_RESEARCH_OUTPUT`. That original dataset is not contained in the GitHub branch; **GitHub CI compiles scripts and runs synthetic tests only**, it does not pretend to replay the private historical source.

Actions verified: [Idle static research CI success](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/38839310623). Research path does not place orders. The previously selected three-change research still lacks external activated cases and venue STOP lifecycle certification. **Keep all LIVE trading contracts unchanged.**

**Final status: IDLE EXIT FLAW IDENTIFIED AND RESEARCH COMPARISONS COMPLETED; NO VERIFIED SAFER LIVE EXIT IMPROVEMENT YET.**

## Follow-up production read-only verification (2026-10-16 11:16:48 JST)

Common Production release remained `020eb3c5b95186d23bd6406af1986747d442a5bd`; Idle runner PID **653687** remained active with **0** restarts. Shared Kill Switch inactive. **Shared Risk remained tripped=true**, measured daily loss **7.9770%** above its configured 7.5% maximum, with local reported unrealized PnL **-5.4038 USDT**. Idle's local persisted DOT SHORT remained **65.9 contracts**, entry **1.087**, hard STOP **1.196**, TAKE_PROFIT **0.815**, local protectionVerified true, scheduled time exit 2026-10-16 **21:20 JST**. Pending and manual-review states were absent. This is a local VPS state read, **not independent signed Aster position/order proof**. Nothing was reset, cancelled, traded, or restarted for this study.

## Additional research: after +3% profit, stop if return declines to -1% (2026-10-16)

This is **absolute position return relative to entry**, not a one-percentage-point drawdown from a +3% profit peak. For SHORT positions the proposed STOP trigger price is entryPrice × 1.01. The backtest activates the STOP only after a completed H1 close has exceeded +3% favorable movement; fill in a later H1 is at the STOP or adverse opening-gap price. Funding and exchange-side partial fills remain modeled, not certified.

**Frozen accepted Idle entries**: 10bps had 47 trades, 13 reached +3%, **none** subsequently triggered the -1% STOP before normal exit. PF unchanged 1.5816. At 30bps, 53 accepted entries, 15 armed and **one** STOP triggered; standalone PF 1.3743 to 1.4124.

| Modeled eight-strategy policy | 10bps final JPY | 10bps PF / DD | 30bps final JPY | 30bps PF / DD |
|---|---:|---|---:|---|
| Current development baseline | 291,326,103 | 4.049 / -20.420% | 174,749,524 | 3.278 / -18.389% |
| Proposed Idle +3% arm, -1% STOP | **291,326,103** | 4.049 / -20.420% | **171,146,893** | 3.209 / -18.389% |
| Idle +3% arm, +0.5% secured STOP | 286,882,023 | 4.052 / -20.406% | 168,135,793 | 3.235 / -18.395% |
| Idle arm on +3% H1 intrabar wick, -1% STOP next H1 | 289,956,903 | 4.026 / -20.907% | 164,638,129 | 3.159 / **-22.758%** |
| Prior Q102 MR + V12 V4 G5/X05 three-change research | 302,658,260 | 4.175 / -20.238% | 198,928,950 | 3.635 / -18.341% |
| Three-change research + proposed Idle -1% STOP | **302,658,260** | 4.175 / -20.238% | **194,675,931** | 3.544 / -18.341% |

**Interpretation**: the proposed STOP can surrender four percentage points from the +3% gain to the -1% loss threshold; it is NOT a profit lock. At 10bps there is no account-level change; at 30bps it reduces integrated equity by 3.6 million JPY versus original and by 4.25 million JPY versus the three-change research case. H1 intrabar-wick activation sensitivity is worse, but its within-bar ordering is uncertain (NOT authenticated tick simulation).

The full-eight research engine may update many pre-admission prospective Idle exits (27 in the -1% floor case). These are NOT actual executed stops; accepted frozen-entry STOP events are 0 (10bps) and 1 (30bps). Keep these counts distinct.

**VERDICT: DO NOT DEPLOY**. No independently demonstrated improvement over existing Idle exit policy. Alternative “+3% peak followed by a one-percentage-point decline, so secure +2%” is a different trailing contract and should be tested independently if that was intended.

Implementation would require signed Aster positions/orders, safely modifying STOP and TAKE_PROFIT reduceOnly quantities with atomic readback, restart persistence and shared gross/margin/rate-budget audits. No LIVE order settings, original protective STOPs, PENGU, operator artifacts or risk gates were modified.

Reproducible research source: scripts/research/idle_peak3_floor_helper_20261016.py, idle_peak3_frozen_sweep_20261016.py, idle_peak3_full8_integrated_20261016.py and test_idle_peak3_floor_20261016.py. CI tested **9/9** causal isolation cases [success, run 38843233036](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/38843233036). Detailed numerical results in profit3_then_minus1_sweep.json.

### Event-parity verification (additional independent check)

For the specific three-percent-arm / negative-one-percent-floor standalone portfolio rerun:

- **10bps:** All original accepted event tuples (entry, exit, price, symbol) unchanged across PENGU **67/67**, Idle **47/47**, V12 **828/828**, Q102 **136/136**, FET **7/7**, HYPE **28/28**. This is consistent with no accepted early stop.
- **30bps:** PENGU **67/67** unchanged, V12 **824/824** unchanged, Q102 **136/136** unchanged, FET **7/7** unchanged. Idle has **52/53** original accepted tuples identical and one early DOT exit (2026-05-23), while HYPE also has an altered accepted event inventory (**23 original versus 24 candidate, with 22 exact matches**), confirming capital/admission changes **outside** the Idle single-leg screen.
- Accordingly, the standalone Idle PF improvement at 30bps does not imply improved full-eight portfolio equity. Prior paper portfolio delta remains **-JPY3,602,631**.

