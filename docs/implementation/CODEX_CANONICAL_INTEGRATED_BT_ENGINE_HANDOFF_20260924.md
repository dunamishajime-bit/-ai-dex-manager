# Codex Handoff: Canonical Top3 + FET + Q102 Governor Integrated BT Engine (2026-09-24)

## Mission / non-negotiable status

Build the **reproducible canonical integrated backtest engine** that can first reproduce the current formal portfolio anchor and then replace **only PENGU** with `COMBINED_FILTERED + flat Gross1 + Q60 same-route hard-stop quarantine + realized PENGU DD17/H72`. The result must replay **V12 Top3 + FET BRK48 + Q102 causal V4/DD Governor + PENGU + V52** through the **same actual integrated risk and capital allocation model**. Do not substitute a PENGU standalone BT or an old Top2 engine.

This is RESEARCH ONLY. No Production or LIVE configuration changes, no VPS operations, no Aster orders/cancels/position changes, no operator-gate or Kill Switch changes. Implement in this research/implementation branch and provide verified CI artifacts; do not merge into Production without separate approval.

**Current status: BLOCKED_INVALID_COMPARISON** until baseline parity and data provenance are demonstrated. Do not invent or extrapolate an integrated replacement result.

## Frozen formal reference to reproduce *before* PENGU substitution

Target name: `Top3 + FET + Q102 Governor`, original PENGU in the formal anchor.

| Formal one-year scenario | Final portfolio equity | PF | Maximum DD | Portfolio trades | PENGU trades |
| --- | ---: | ---: | ---: | ---: | ---: |
| NORMAL | JPY 740,771,278.01 | 4.12008119 | -19.8845% | 1,195 | 66 |
| SEVERE | JPY 65,669,109.00 | 3.05645475 | -19.9903% | 1,036 | 66 |

Formal window reported: 2025-08-10 through 2026-08-10. Prior project convention was JPY 10,000 initial + JPY 10,000 monthly x12 (=JPY 130,000 deposits), compounding. **Derive exact UTC inclusive/exclusive boundaries, monthly deposit timestamps, stock/crypto price sources, fees, slippage, funding and PF/DD definitions from the provenance of the original formal anchor, not assumptions or a different year's BT.** If those cannot be verified, emit `BLOCKED_UNVERIFIED_ANCHOR` with the missing evidence and do not label a near match as parity.

**Do not confuse the formal anchor with the 2026-09-24 current Production configuration or the 2026-09-20 shadow candidate.** They differ in some parameters. In particular, the 2026-09-20 candidate file has FET 1.25x; the later `config/fetBrk48Runtime.ts` uses FET max 2.25x. The b937 Production integrated policy declares normal crypto/total caps 3.0/4.25, hard caps 5.0/8.0, PENGU 0.85; a historical capture script hardcodes total 3.5, old V12 Top2. Resolve the precise original anchor contract from the original run, its source SHA, logs and artifacts. A different configuration is a DIFFERENT BACKTEST, not an acceptable anchor.

## Source map: inspect and freeze these first

Repository: `dunamishajime-bit/-ai-dex-manager`.

1. Reference Production source: `codex/final-dynamic-gross-live-20260922` at `b937a1b209a652b71a165216d7ac0dbed5a13908`. Read `config/integratedProductionRiskPolicy.ts`, V12 Top3/dynamic sizing, `config/fetBrk48Runtime.ts`, FET runner/causal signal library, Q102 causal V4 selector/governor, V52 V50 runtime/stock events, Shared Risk/Gross Governor and FET preemption. Freeze exact source SHAs and actual parameter values for the ORIGINAL anchor.
2. Selected PENGU research source: `research/pengu-flat1-dd-reduction-20260924`: `docs/research/PENGU_FLAT1_DD_REDUCTION_FINAL_20260924.md`, `scripts/research_pengu_flat1_dd_q60_robustness_20260924.ts`, scenario `Q60_DD170_H72`; the project reports PENGU standalone robustness PASS, 69 NORMAL / 68 SEVERE formal trades for the selected new PENGU. These standalone counts are **not** predictions of integrated accepted-trade counts.
3. Existing PENGU ledger source in **sibling** branch `research/pengu-gross1-full-integrated-20260924`: `scripts/research_pengu_integrated_ledgers_20260924.ts`. Its exported ledgers cover original allocation and flat1 **without** Q60/DD17/H72; adapt the selected Q60 replay to export causal event streams with enough detail for portfolio integration. Do not silently use unprotected flat1 ledgers for the new candidate.
4. Historical integrated code in sibling branch: `scripts/research_capture_integrated_engine_20260924.py`, `research_quality102_gross_cap_sweep.py`, `research_quality102_mtm_50_v2.py`. These are reference materials for cash, mark-to-market, stock and gross mechanics, **NOT** canonical anchor parity evidence: the capture script pulls an old V12 Top2 ledger and patches PENGU 0.85/crypto 3.0/total 3.5.
5. Earlier archived Actions runs, for reference only: `33257164125` (old V12/PENGU/V52 ledgers), `35337138289` (old flat-boost V12 Top2/preemption), and any later *actual* run that produced JPY 740,771,278.01. Search repository docs, GitHub Actions run history, artifacts, retained caches and logs to identify the exact formal anchor's source/data; do not claim these two old artifacts are the missing Top3/FET/Q102/V52 ledgers.
6. Shadow candidate reference: `codex/top3-fet-q102-live-20260920` `config/top3FetQ102Candidate.ts` and `lib/q102-portfolio-dd-governor.ts`. Use only if the anchor provenance identifies matching logic.

Produce a checked-in `anchor-source-manifest.json` mapping each of: original scenario/run ID, engine/source SHAs, each strategy source SHA/params, UTC period, data feeds + frozen cache hash, initial/deposit schedule, NORMAL/SEVERE costs, fill/slippage/funding model, event tie-break rules, PF/DD definitions and reference summary. Any unresolved critical field means no baseline parity certification.

## Deliverable architecture

Implement a self-contained and deterministic **canonical portfolio replay**, preferably `scripts/research/canonical_integrated_bt/` with a CLI, typed/versioned input ledgers and tests. Reuse production signal/position exit libraries wherever feasible; avoid rewriting trading logic just to match a metric.

### A. Reconstruct full historical event candidates (not summary JSON)

Regenerate **four missing event ledgers** under the exact original formal contract:

- V12 **Top3**: rank1/rank2/rank3 score and regime gates, actual gross per rank, dynamic residual resizing, accepted/blocked entries, exits, partial exits and requested exposure.
- FET BRK48: full causal breakout/volume decisions, fills/exits, original FET gross, profit-floor stop, preemption request/release and same-time interactions with V12/other crypto.
- Q102 causal V4: symbol/family/variant selector, one-slot choices, family gross, causal DD Governor boost eligibility, entry/exit timestamps and stock/crypto interactions. Never import a frozen winning-trade CSV as substitute for causal signals.
- V52: historical stock signals/exit/funding-or-equivalent/cost events, calendar alignment and stock-slot gross usage.

Also regenerate original PENGU baseline ledger and new selected PENGU candidate ledger, each in NORMAL and SEVERE. Record rejected **candidate signals** as well as accepted strategy-local events because shared allocation can change what is filled and what may fire next. A pre-simulated standalone PENGU entry/exit ledger is NOT sufficient if a shared rejection/preemption changes PENGU route cooldown, armed continuation state, equity or next entry. The integrated engine must feed accepted fills and exits back into each relevant causal state machine.

Recommended versioned event fields: `eventId, strategy, symbol, route, family, side, signalBarCloseUtc, eligibleFillUtc, realizedFillUtc, eventKind, candidateId, positionId, groupId, referencePrices, requestedGross, acceptedGross, marginRequired, grossReservationId, fee, slippage, funding, quantity, partialFraction, stopOrTpReason, sourceSha, dataSha`. Separate requested, reserved, accepted, reduced, rejected and executed events. Use actual qty/partial exit quantities where possible. Store one full chronological global decision ledger **per stress mode**.

### B. Canonical gross/capital allocator

One chronological queue for V12/PENGU/FET/Q102/V52, including overlapping crypto/stock positions. On each chronological step: settle any eligible fills/exits/funding/fees and due deposits; update realized + mark-to-market equity and margin; apply strategy causal state, DD and risk governors; process causal candidate intents; reserve pending gross; enforce normal caps, hard caps, available-balance reserve, 5x Cross/Isolated restrictions as appropriate, daily-loss blocks, exposure limits, stock slots and FET preemption; only then accept/reject/resize entries. Capture deterministic precedence from **the original anchor** and test simultaneous-event behavior rather than inventing a ranking. No look-ahead across hourly bars, future selector values or stock timestamps.

Preemption must model actual risk/gross release and resultant protection/order state; never double-spend freed gross or count rejected intents as executed trades. Include open positions at period end and mark-to-market drawdown consistent with the formal anchor. If ambiguous OHLC stop/TP order exists, use the original engine's documented conservative tie-break and record it. Reconcile cash, margin, available balance, realized PnL, floating PnL, gross and peak equity after every event.

### C. New PENGU candidate: implement and integrate precisely

Fixed strategy `COMBINED_FILTERED`, maximum PENGU gross `1.0` and **every accepted entry gross `1.0`** (not old ATR/Recovery fractions, no hidden size reductions). `Q60_DD170_H72`:

- On `HARD_STOP` of route R, bar-close/exit-time causally quarantine **only R** for 60h; other PENGU routes remain eligible. Derive the correct route taxonomy and same-bar ordering from the selected PENGU research script.
- Maintain *PENGU-only* realized closed-equity index and its historical realized peak from **actual portfolio-accepted PENGU fills and exits**, not standalone theoretical entries. When realized DD reaches or exceeds 17%, block *new* PENGU entries for 72h; leave existing stops, TP, reduce-only exits and other strategies unaffected. Determine and pin partial realized exit accounting from original selected replay, with tests.
- An entry rejected by Shared Gross must not count as an executed trade, a hard stop, or a realized PnL sample. Accepted entries that later exit must update the appropriate state; any simulated preemption of an already open PENGU position must be accounted for only if allowed by the original canonical contract.
- Maintain causal state across timestamps, day boundaries and same-hour events. NORMAL and SEVERE may diverge in accepted-trade count and subsequent PENGU risk state. Do not infer integrated count from standalone 69/68.
- Standalone selected candidate validation (including 69/68), implementation parity with `Q60_DD170_H72`, and route/governor assertions must pass **before** portfolio integration.

## Required staged process and hard acceptance gates

**G0 Provenance:** locate the original formal run and recover or causally regenerate the exact original Top3/FET/Q102/V52 ledger and integrated allocator. A summary-only JSON cannot pass. Verify source/data hashes and original financial/cost/deposit contract. If any unavailable, explicitly output `BLOCKED_MISSING_CANONICAL_SOURCE` with the precise missing filenames/artifact IDs/logic—not guessed substitutes.

**G1 Baseline parity (mandatory before substitution):** run original PENGU under the reconstructed engine. Require EXACT 1,195/1,036 global trade counts and 66/66 actual PENGU counts. Target JPY 740,771,278.01 / JPY 65,669,109.00; PF 4.12008119 / 3.05645475; DD -19.8845% / -19.9903%. For fully pinned identical data, suggested strict reporting tolerances are **JPY 0.01 equity, PF 1e-8, DD 0.0001 percentage point**, or an even stricter original engine unit; report all raw/unrounded differences. A tolerance is not permission to fit/smooth or alter trade signs, timestamps, deposits or costs. Provide per-strategy counts and PnL, gross-cap conflicts, preemption and event-level first-divergence diagnostics.

**G2 New PENGU parity:** validate the selected Q60+DD17/H72 standalone replay with fixed 1.0 gross and NORMAL69/SEVERE68 formal standalone trades, plus prior published strategy metrics within documented precision; provenance-matched dataset required. Fail on unexpected differences.

**G3 Controlled swap:** same engine version, original anchor inputs, date window, investment schedule, frozen market data, unchanged V12/FET/Q102/V52 and gross/risk parameters; change **only** PENGU causal strategy + sizing/quarantine/governor. Re-run both NORMAL and SEVERE independently from a clean state. Recompute entire dynamic chronological portfolio, not post hoc substitution of PENGU PnL.

**G4 Compare and stress-audit:** output complete original-versus-new portfolio equity, cumulative profit over JPY 130k deposits, PF, max DD and peak/trough timestamps, per-strategy realized PnL and position-time allocation, total/PENGU trade counts, fees/funding/slippage, rejected/accepted gross intents, active cap occupancy, FET preemptions and blocked PENGU reentries. Show NORMAL and SEVERE plus an unambiguous status `FORMAL_COMPARISON_VERIFIED` only when G0–G3 pass. If G1 fails, status `BLOCKED_BASELINE_PARITY`; never publish new standalone results as integrated formal results.

## Tests / CI / artifacts

Tests must cover: identical inputs produce identical output/hash; stale/missing cache fail closed; single/no-trade corner cases; simultaneous exits/entries and partial exits; fee/funding applied once; deposits excluded from return denominator correctly; strategy gross and reserved gross cannot exceed limits; FET preemption only after actual release; Q102 Governor uses realized **eligible** events according to original contract; PENGU Q60 stops only same route and expires on proper UTC boundary; 17%/72h governor uses portfolio-accepted PENGU closed equity and preserves exits; NORMAL/SEVERE independent; no future bar leakage; full baseline parity and anchor-data hash verification. Require replay from clean cache/artifact without private exchange credentials, orders or Production APIs.

Add a manually dispatchable, read-only GitHub Actions workflow using retained datasets/artifacts; do not pretend a failed cache restore or empty "No jobs were run" is a successful replay. Upload source manifest, normalized immutable ledgers, baseline/new per-mode summary, baseline mismatch report, allocator event log, gross/preemption timeline, per-route attribution and machine-readable pass/fail report. Prefer retention >=90 days when allowed. Avoid committing large historical raw datasets, tokens or secrets.

Proposed commands (implement actual working CLI; examples only):

```bash
# Full provenance + baseline gate
python -m scripts.research.canonical_integrated_bt --mode verify-baseline --manifest <frozen-anchor-manifest>

# New PENGU local research validation
python -m scripts.research.canonical_integrated_bt --mode verify-pengu --variant Q60_DD170_H72

# Cannot proceed to compare unless both prior gates pass
python -m scripts.research.canonical_integrated_bt --mode compare --baseline <frozen-anchor-manifest> --pengu Q60_DD170_H72 --stress both
```

## Delivery / Codex final report requirements

Push the complete engine, manifest, tests, CI and a `docs/research/CANONICAL_INTEGRATED_PENGU_SWAP_RESULT_20260924.md` report in this separate branch. Give actual branch + full SHA + workflow run/artifact IDs, run statuses and evidence. If blocked by missing source/market caches, commit the **implemented engine and executable diagnostics**, identify what exact unavailable artifact/source is needed, and retain `BLOCKED_*` instead of substituting speculative BT numbers. **Do not change Production/LIVE/VPS, do not open or close orders, and do not activate the new PENGU.**
