# V4 / PENGU: As-of 41-route priority, integration and causal risk stress — 2026-11-10

**Status: RESEARCH ONLY / NO NEW RULE ACCEPTED / NO LIVE MUTATION.** This report extends [the earlier native-exit, regime and risk audit](./V4_PENGU_CAUSALITY_AND_TIMED_STOP_DEEP_AUDIT_20261110.md). Do not use this as certified Production-parity proof or an approval to place orders.

## 1. Root cause: V4 rank both hindsight-ranked and omitted from the research engine's actual sorting

The pinned V4 V2 priority table `pinned-source/V4/docs/implementation/v12-v4-v2-full-year-priority.json` was fitted to realized development-period route results and is not time-as-of OOS. Independent route-ranking reconstruction used only **completed native exits that matured at least 72 hours before each simulated entry**, with a prespecified risk-shrunken mean-score and a 20-event pseudo-count. This prevents direct exit-label lookahead **inside the ranking calculation only**; it does *not* cure hindsight selection of the V2 route features or eligible signal universe.

- Raw V4 intention sources: preperiod **598**, target **1,394**, forward **127** (of which **117** have resolved native lifecycle outcomes). The target per-signal rank map was verified against all 1,394 source IDs, timestamps, symbols and saved pinned ranks.
- On **2025-10-01**, 18/41 routes had at least 10 causally matured prior labels; the as-of top ten overlapped the hindsight-pinned top ten **4/10**. On **2026-10-01**, 30/41 had such support and overlap was **3/10**.
- Across **438** same-time multiple-V4-signal batches in target/forward, the top candidate differed **153** times using the mechanical matured-only ranking.
- The inherited research integration sorts simultaneous runner candidates `(timestamp,runner_priority,symbol,id)`, ignoring the V4 route priority field. Three-way research replay therefore changed **only that V4 sort key** while retaining the same native exits, gross constraints and other runner tapes.

### Three-way integrated replay, initial JPY 10,000

| Intra-V4 ordering | 10bps final JPY | 10bps max DD | 30bps final JPY | 30bps max DD |
|---|---:|---:|---:|---:|
| Old research symbol/id ordering | 1,810,430 | -50.37% | 574,925 | -60.67% |
| Saved pinned V4 priority | 2,111,835 | -50.37% | 667,698 | -60.67% |
| Matured-only as-of priority heuristic | 2,303,723 | -50.37% | 726,189 | -60.67% |

Symbol to pinned changes **12 admitted / 12 absent modeled fills** (34 changed decision reasons); pinned to as-of changes **19 admitted / 18 absent fills** (42 changed decision reasons). **These are not evidence of causal future alpha**, because this signal set and the as-of heuristic have already been investigated on the scored period, and source V2 entry filters were chosen with future data.

The DD percentages being identical is *not* a rounding artifact: for **every 30-minute point** between the common **2026-07-20 07:00 UTC peak** and the common September 28 trough, the three MTM equity curves differ **only by constant factors to floating-point tolerance**. There are **zero changed admission decisions during that peak-to-trough interval**. Ranking changed wealth accumulated before the peak, not the risk pattern of that subsequent loss episode.

**Files:** [matured rank audit script](./scripts/v4_asof_matured_rank_contamination_20261110.py), [per-candidate rank map generator](./scripts/v4_asof_candidate_rank_map_20261110.py), [integrated three-way wrapper](./scripts/v4_asof_rank_integrated_stock15_ab_20261110.py), [integrated DD/admission forensics](./scripts/v4_asof_integrated_3way_forensics_20261110.py). Full raw deterministic JSONs (including all 1,394 as-of entries) are archived under `results/*.json.gz.base64`. Decode each file with Python `gzip.decompress(base64.b64decode(text))`, and verify SHA256 against the source ledger.

## 2. What happened inside the shared maximum-DD episode?

Saved pinned-priority portfolio research model: **10bps** peak 2026-07-20 07:00 UTC to trough 2026-09-28 05:00 UTC, max DD **-50.3704%**. **30bps** same peak, trough 2026-09-28 19:00 UTC, max DD **-60.6704%**.

At the *first -10% MTM DD crossing after the July peak*:

- 10bps: **July 22 16:00 UTC**, only **1 position with modeled gross 0.60x** open; **141 additional modeled entries** were admitted before the late-September DD trough. Of those new entries **78** closed with negative full-lifetime modeled net PnL by the trough.
- 30bps: **July 22 08:00 UTC**, **2 positions with modeled gross 1.35x** open; **142 additional entries** followed, of which **86** closed negative by the trough.

Losses occurred across **PENGU, V4, Q102, IDLE, RESIDUAL** while the model's V52 and FET supplied offsetting realized gains. Full-lifetime realized fill PnL is **not** a mathematically exact contribution to the MTM peak-to-trough fall: source notebooks must not mistake the fill totals for trade-level drawdown attribution. The correct next pass needs intratrade MTM snapshots and funding/partial-exit treatment.

**Files:** [causal threshold-position audit](./scripts/portfolio_dd_threshold_existing_exposure_audit_20261110.py) and [time-stamped positions and subsequent admissions](./results/v4_pengu_portfolio_risk_threshold_exposure_20261110.json).

## 3. Entry-only rolling-peak risk gate; 9 exploratory cases

Using only current modeled MTM, a new-entry-only lock was applied when equity fell more than a specified fraction below the rolling 7-, 14-, or 30-day peak. Existing positions were **never** force-closed and their protective modeled exits remained active. All fee/cost runs are recomputed, not merely extrapolated.

| Research gate | 10bps max DD | 30bps max DD | 10bps final JPY | 30bps final JPY |
|---|---:|---:|---:|---:|
| No additional gate, pinned V4 priority | -50.37% | -60.67% | 2,111,835 | 667,698 |
| 7d peak, -10% | -48.61% | -38.01% | 647,978 | 265,409 |
| 14d peak, -12% | -27.21% | -49.70% | 525,977 | 169,084 |
| 30d peak, -10% | -31.37% | -23.91% | 287,506 | 152,508 |
| 30d peak, -8% | -30.78% | -22.78% | 63,100 | 96,179 |
| 30d peak, -6% | -24.32% | -21.15% | 93,495 | 39,864 |
| 30d peak, -4% | -16.55% | -32.46% | 44,261 | 16,026 |

All **nine** tested cases were saved; **none** meets max DD <=20% at **both** 10bps and 30bps. Trading frequency and terminal return deteriorate sharply. Choice of window/threshold is a retrospective selection on already inspected outcomes, so even an apparent pass would need genuinely untouched forward evaluation.

**Files:** [risk gate source code](./scripts/portfolio_rolling_dd_entry_gate_20261110.py) and [nine-case table with decision/fill provenance hashes](./results/v4_pengu_portfolio_rolling_dd_gate_grid_20261110.json).

## 4. Distinct causal two-loss-runner quarantine (no arbitrary equity threshold)

A second mechanic uses only previous final modeled exit fills. When a watched runner's **two most recent closed trades are negative and sufficiently close in time**, block that runner's *new* entries for the chosen 72h/168h interval. Each result is independently replayed under 10/30bps with identical price and native STOP tapes.

| Runner scope | 10bps DD | 30bps DD | 10bps final JPY | 30bps final JPY |
|---|---:|---:|---:|---:|
| V4/PENGU 72h | -43.56% | -54.19% | 1,659,493 | 515,981 |
| V4/PENGU 168h | -45.21% | -59.11% | 1,183,579 | 302,357 |
| Individual Crypto runners 72h | -41.38% | -51.94% | 1,282,798 | 390,864 |

These do **not** achieve DD20%. Losses spread across multiple runners; freezing V4 and PENGU alone is not enough. Some earlier successful entries are also suppressed. Do **not** deploy any of these rules.

**Files:** [loss-streak gate source](./scripts/portfolio_runner_loss_streak_gate_20261110.py), [three-case summary with decision CSV SHA256s](./results/v4_pengu_portfolio_runner_loss_streak_gate_20261110.json).

## 5. Additional independent risk-accounting parity check — PENGU SHORT

The inherited portfolio model's PENGU *risk overlay* also computed short directional unit return as `Entry/Exit-1`, while the same model's actual USDT-linear realized cash PnL used `(Entry-Exit)/Entry`. This is the same type of denominator inconsistency independently found in the timed-STOP overlay. A research A/B corrected *only* the risk overlay denominator:

- **10bps and 30bps FILLS, FUNDING and every 30-minute EQUITY row are identical by SHA256**.
- One decision, **PENGU_00112 at 2026-09-16 21:00 UTC**, remains `BLOCK` but its audit reason changes from `PENGU_ROUTE_QUARANTINE_60H` to `PENGU_REALIZED_DD_17PCT_HOLD_72H`.
- This historical no-economic-change result does **not** mean it is harmless in another market path. Update the research calculation before future reuse; any LIVE implementation remains outside this experiment's scope.

**Files:** [minimal risk-accounting A/B wrapper](./scripts/pengu_integrated_risk_overlay_short_return_parity_ab_20261110.py) and [file-hash/result/changed-reason evidence](./results/pengu_risk_overlay_short_return_parity_recheck_20261110.json).

## 6. Evidence and decision gates still open

**Not a Production-parity or independent OOS economic BT:** source V4 V2 route ranks and entry filters are hindsight-selected; HYPE and IDLE are hypothetical active; V52 orderbook/executable fill record is missing; funding, modeled stops and cross-runner timing retain proxy assumptions; actual current VPS running SHA/call-site must be checked read-only; maxDD research portfolio remains much greater than the 20% target.

**No new LIVE acceptance.** Next mandatory research tasks, in order:

1. Build a genuinely causal V4 *candidate universe* without selecting/tuning routes from the scored future; distinguish native signal existence from policy rank allocation and use disjoint overlapping-trade episodes.
2. Audit actual deployed PENGU 3h/8h call-sites, realized PnL denominator and owner approval state read-only; repair research price/policy math and add regression tests.
3. Produce event-synchronous intratrade asset-risk attribution for the July–September drawdown; separate already-open vs later-admitted positions and funding/partial-profit effects; compare **capacity-preserving state-aware risk governance**, not only scalar DD thresholds.
4. Only after fully causal and reproducible native evidence, reconstruct fresh future market data, synthetic bear/bull/V stress, multiple-testing controls and 10bps/30bps integrated DD with complete current Gross and runner slots. Do not turn the current already-inspected validation/test dates into prospective evidence.

**GitHub research branch only. Production, orders, positions, STOP and Kill Switch untouched.**
