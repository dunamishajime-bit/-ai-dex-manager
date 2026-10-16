# Exit-protection 3-change research certification — 2026-10-16

**STATUS: RESEARCH_ONLY — BLOCKED_EXTERNAL_EFFECT_SAMPLE_AND_VENUE_CERTIFICATION.**

**No LIVE or Production changes. PENGU trading logic unchanged.**

## Immutable research and latest operational context

- Frozen exact 41-route V12 V4 model: SHA 6f97d2cf03877674ec1a845f6c08414f32899f36, strategy variant V2_M150_D05_CORE_NATIVE.
- Full eight-strategy research engine and data: approved frozen local research worktree DisDex-five-improvements-20261008. Research-only modeled orders, not Aster-certified fill replay.
- Original engine reproduced initial JPY 10,000, 2025-08-10 to 2026-08-10: 10bps and 30bps final equity / PF / maximum MTM DD / trades **EXACT**, accounting PASS.
- 2026-10-16 09:35 JST VPS read-only state: common release SHA 020eb3c5b95186d23bd6406af1986747d442a5bd, independent V12 V4 SHA 6f97d2cf03877674ec1a845f6c08414f32899f36, shared Kill Switch off, runners active, V4 **orderEnabled=false**. A running process is not proof of trading authorization.

## Frozen candidate changes

| Strategy or route | Trigger on a fully completed H1 | Additional secured profit floor |
|---|---:|---:|
| Q102 MR only | favorable return +3.0% | +1.0% |
| V12 V4 REC_G5_SLOW_TREND | favorable return +2.0% | +0.5% |
| V12 V4 REC_X05_TIME_36H | favorable return +2.5% | +1.0% |

All other strategies, including PENGU and Q102 non-MR families, retain existing entry/exit rules. Extra STOP is logically active **after** the trigger hour, not on the trigger candle. Existing hard STOP, time exit, gross/slot preemptions and venue ownership are not bypassed in the modeled integration.

## Full eight-strategy H1 development-period reruns

| Item | Baseline 10bps | 3-change 10bps | Baseline 30bps | 3-change 30bps |
|---|---:|---:|---:|---:|
| Final JPY | 291,326,103 | 302,658,260 | 174,749,524 | 198,928,950 |
| Final JPY uplift | – | +11,332,157 | – | +24,179,426 |
| PF | 4.0490 | 4.1748 | 3.2776 | 3.6347 |
| Max MTM DD | -20.4200% | -20.2376% | -18.3888% | -18.3410% |
| Win rate | 71.6039% | 72.3491% | 68.3087% | 69.3126% |
| Trades | 1,222 | 1,226 | 1,218 | 1,222 |

Candidate filter changes 29 modeled pre-admission planned exits; exactly **18 accepted live-model exit events** use the extra floor (Q102 MR 6, G5 6, X05 6). At both costs, **67/67 PENGU entry/exit events are unchanged**.

These are selected within the development period after trying several alternatives: this is **not out-of-sample certification**. DD benefits are very small, and 10bps candidate DD remains below -20%.

## Adverse execution stress and single-trade dependence

Extra slippage is charged on additional profit-floor fills *above* ordinary fixed round-trip costs.

| Variant | Final JPY 10bps | PF / DD 10bps | Final JPY 30bps | PF / DD 30bps |
|---|---:|---|---:|---|
| Original three changes | 302,658,260 | 4.1748 / -20.2376% | 198,928,950 | 3.6347 / -18.3410% |
| Extra 50bps on STOP | 296,930,356 | 4.1589 / -20.3693% | 190,919,035 | 3.5997 / -18.3877% |
| Extra 100bps on STOP | 293,318,705 | 4.1194 / **-20.4265%** | 187,528,830 | 3.5590 / -18.3876% |
| Keep single largest Q102 UNI saved-loss trade unchanged | 300,477,319 | 4.0963 / -20.2376% | 196,774,069 | 3.5458 / -18.3410% |

The Q102 MR UNI trade on 2026-07-29 accounts for about 14,997.6 USDT of frozen-quantity avoided loss, relative to roughly 18,141 USDT net trade-by-trade settlement improvement across 18 affected events. Despite this concentration, leaving its exit unchanged does not eliminate modeled portfolio uplift. One added hour of STOP activation delay did not change these data. Neither test certifies partial fills, rate-budget deferrals, order replacement or extreme gaps.

## External validation: no effective activation samples

- External historical period 2026-08-11 to 2026-10-04; G5 = 2 trades; X05 = 1 trade.
- Read-only Aster public H1 recheck shows coverage without missing bars for all 3. **0/3 activated the proposed profit-floor order**. Incremental external effect 0. Therefore no support for claiming the exit thresholds improve future trades.
- This external time period had been viewed for earlier V4 research. It is not pristine project-level holdout and does not include a full eight-strategy gross/margin replay.
- Existing independent 258-trade, repaired V4 route-only external analysis reports **PF 0.5700 at 10bps** — a serious bearish regime-shift warning. This is not an eight-strategy portfolio PF, but blocks promoting the development-period 3-change profits directly to LIVE.
- Q102 MR does not have a sufficient independently certified external event-by-event profit-floor sample.

## Real-venue implementation blockers

1. Existing Q102 resident STOP planner uses a positive fractional distance **on the loss side**. A favorable profit lock above a LONG entry / below a SHORT entry cannot be encoded via that current stopFraction API. It needs an explicitly normalized, monotonic stop-price replacement.
2. The Q102 venue helper places and reads back a replacement STOP before cancelling the previous one. Unknown order acknowledgement, duplicate/reduce-only STOPs, partial fills, restart lineage, quantity normalization and cancellation/readback races require exchange-faithful tests and signed Aster independent checks before promotion.
3. Frozen V4 catalog: REC_G5_SLOW_TREND is a 48-hour TIME route; REC_X05_TIME_36H is a 36-hour TIME route. Both must retain their existing emergency protection and causal route contract until a replacement is separately certified.
4. Do not change operator approval, V4 orderEnabled, shared Kill Switch, Gross, margin or live runners on the basis of a research-only H1 replay.
5. Freeze the proposed parameters before gathering new prospective signal and **activated** profit-floor evidence across regimes. Require signed real venue STOP readback, 5x Cross/cross-margin protection, gross ownership, gap/slippage and restart tests, and new full-eight chronological DD validation before any LIVE request.

## Reproduce and static validation

Research-only sources on this branch:
- scripts/research/exit_protection_3change_integrated_20261016.py
- scripts/research/exit_protection_3change_stress_20261016.py
- scripts/research/exit_protection_3change_leaveoneout_20261016.py
- scripts/research/exit_protection_3change_external_20261016.py
- scripts/research/test_exit_protection_3change_20261016.py

Set the DISDEX_V4_FROZEN_RESEARCH_ROOT environment variable to the authorized frozen 2026-10-08 source worktree. Set DISDEX_EXIT_RESEARCH_OUTPUT to a separate temporary directory for each replay; do not overwrite original or Production ledgers. The historical source files and datasets are required and are not copied into GitHub.

Verification: baseline research 10bps/30bps exact replay; 10/10 synthetic causal/route-isolation/PENGU untouched invariants PASS; GitHub Actions research-only CI success: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/38831627319 .

Quantitative machine-readable summary: metrics.json.

**Decision: best development candidate identified, BUT NOT FORMALLY FORWARD CERTIFIED AND NOT APPROVED FOR LIVE. Preserve LIVE, do not deploy.**
