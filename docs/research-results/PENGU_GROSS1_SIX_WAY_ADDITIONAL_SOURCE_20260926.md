# Supplemental canonical-integrated BT handoff: verified PENGU Gross 1.0 six-way study

Date: 2026-09-26. **Research and source lineage only; formal five-logic baseline remains `BLOCKED_MISSING_CANONICAL_SOURCE`. Do not use the four-sleeve OHLC proxy result to refute or validate the distinct historical 740,771,278.01 JPY formal anchor.**

## Primary checked source

- Original six-way research commit: [`007ed8f9ccd775e5b3bb9e5348b829abc7911503`](https://github.com/dunamishajime-bit/-ai-dex-manager/commit/007ed8f9ccd775e5b3bb9e5348b829abc7911503), `research/pengu-gross1-fixed-production-target-20260924`.
- Source report: [`docs/research/PENGU_GROSS1_ALL_ORDER_ALLOCATION_20260924.md`](https://github.com/dunamishajime-bit/-ai-dex-manager/blob/007ed8f9ccd775e5b3bb9e5348b829abc7911503/docs/research/PENGU_GROSS1_ALL_ORDER_ALLOCATION_20260924.md).
- Native source study: `scripts/research_pengu_gross1_all_orders_20260924.ts`, published code source commit `c6add8d39676584ad9db094d1ad04deb4050ed06`.
- Actual GitHub Actions run [`35920417464`](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/35920417464): **SUCCESS and a real validation job**, with Typecheck, Integrated risk contract, PENGU strict gross selftest and all-order research parity all successful. This validates the standalone study and contract, **NOT** historical five-sleeve original anchor parity.
- Separate selected Q60/realized DD17/H72 study: `research/pengu-flat1-dd-reduction-20260924/docs/research/PENGU_FLAT1_DD_REDUCTION_FINAL_20260924.md`. Its 69/68 NORMAL/SEVERE standalone entries CANNOT be plugged unchanged into portfolio global admission: rejected entries do not change the same-route quarantine or realized DD Governor.

## Every candidate is maximum PENGU Gross 1.0, but allocation is NOT identical

| Allocation | Low V64 | Recovery initial | Recovery half exit | ATR floor | Formal-year NORMAL return / PF / DD | SEVERE return / PF / DD |
|---|---:|---:|---:|---:|---|---|
| Cap1 existing design | .1875 | .50 | .25 | .60 | +746.42% / 4.752 / -13.05% | +512.93% / 3.786 / -14.92% |
| Cap1 Low-only scaled | .220588 | .50 | .25 | .60 | +748.85% / 4.724 / -13.05% | +513.98% / 3.766 / -14.92% |
| Cap1 Recovery-only scaled | .1875 | .588235 | .294118 | .60 | +817.44% / 4.663 / -14.01% | +549.28% / 3.703 / -16.09% |
| Cap1 Low + Recovery scaled | .220588 | .588235 | .294118 | .60 | +820.07% / 4.638 / -14.01% | +550.39% / 3.684 / -16.09% |
| Cap1 **ALL** previous order sizes ×(1/.85), capped at 1 | .220588 | .588235 | .294118 | .705882 | +820.07% / 4.638 / -14.01% | +550.39% / 3.684 / -16.09% |
| Cap1 new-entry flat 1.0 (Recovery exit half .50) | 1.00 | 1.00 | .50 | N/A | +1,307.91% / 3.979 / -20.82% | +769.78% / 3.147 / -22.60% |

The low+Recovery and uniform modes *happen* to tie on THIS standalone history because the ATR floor change alters no fill. They are **different contracts**, especially after portfolio capacity rejection or different market history. Every entry gross of the uniform-scaled candidate is **variable**; do not label it flat1.

The **selected Q60+DD17/H72 standalone additional rule on flat1** has NORMAL +1,536.60% / PF 4.609 / DD -15.05% / 69 trades, SEVERE +843.24% / PF 3.397 / DD -16.99% / 68 trades. Q60 forbids only a route that actually suffered an accepted historical hard stop for 60h. The 17% closed-equity DD governor forbids all **new** PENGU orders for 72h without deleting existing protection/exits. The original six-way study itself did not apply Q60 or this DD governor; its standalone formal sample contains 71 trades. The separate Q60 standalone counts are not integrated accepted counts.

## Required historical five-sleeve experiment

A. Recover **original** historical source/ledger that produced NORMAL ¥740,771,278.01 (PF 4.12008119, DD -19.8845%, global1,195/PENGU66), SEVERE ¥65,669,109.00 (PF 3.05645475, DD -19.9903%, global1,036/PENGU66). Recover source SHA, data hashes, exact original PENGU contract, event-tie priorities, financing and costs. Do not substitute the archived original Top2/3.5x engine or the 2026-09-26 four-sleeve proxy. Preserve all V12/FET/Q102/V52 contract and data from THIS historical anchor, rather than later 2.25x FET Production defaults.

B. Only after G0 and exact G1 baseline parity: re-run from zero **three controlled PENGU substitutions** with the same allocator, unchanged other sleeves, same market/deposits/fees and independent NORMAL/SEVERE: `CAP1_ALL_OLD_ORDERS_LINEAR` (Gross1 max but variable actual entries, no Q60); `CAP1_EVERY_ENTRY_FLAT` (new entry1, no Q60); `FLAT1_Q60_DD170_H72` (new entry1 with source-causal quarantine+DD guard). Optional fourth factorial arm `SCALED_Q60_DD170_H72` is UNTESTED standalone and must be newly validated (do not inherit 69/68 from flat1).

C. For every arm, portfolio-causally *recompute* signal states following fills and rejections: PENGU realized DD/Q60 only portfolio-accepted PENGU position closes; all core sleeves unchanged except capital-contention downstream effects; shared pending reservations, Dynamic Residual, FET FULL protective preemption and Q102 DD Governor restored from original input lineage. Output original vs three controlled results plus first-divergence diagnostics, reject counts, per-sleeve PnL, hourly DD, monthly path, funding and original baseline tolerance. NEVER algebraically sum the standalone PENGU returns into 740m.

The checked-in machine-readable [variant contract](../../scripts/research/canonical_integrated_bt/pengu_variant_comparison_contract_20260926.json) and independent 6-source-identity unittest preserve the distinctions. Passing source-identity CI is **not** passing original historical anchor provenance, actual global allocator behavior or five-sleeve formal comparison. Production/LIVE/VPS/ASTER remain unchanged.
