# V12 V4 – Weak Route Repair, Priority, Gross & Forward-Split Audit
Date: 2026-10-09

## Status

**RESEARCH ONLY — NOT APPROVED FOR LIVE ORDERS.** Nothing in this research changes Production/VPS/HP or the frozen V4 Shadow contract.

This study extends the already pushed V12 V4 Frozen41 / Final1000 + G5 fixed48h baseline. It audits low-win-rate and low-mean-return routes, two passes of Entry/Exit repair, route priority and Gross allocation, and **training-period-only priority scoring**.

Original research branch: `research/v12-entry-phase-20261008`.

## Scope and definitions

- Development replay: 2025-08-10 to 2026-08-10; 10/20/30bps price-model cost cases.
- Historical price/fill model status: `COMPLETE_H1_PRICE_MODEL_NOT_L2_VERIFIED`.
- Initial equity in this replay: JPY 10,000, with one contribution; not a verified real trading account.
- Gross = notional/equity, **not** exchange leverage. Exchange 5x Cross must be verified independently before any real order.
- V12-specific win rate/PF is computed from accepted V12 trade ledger.
- Final equity and maximum MTM DD are the full multi-strategy portfolio replay.
- Hourly V12 utilization is calculated from accepted V12 legs; V12 zero hours do **not** imply the whole portfolio was flat.
- Train/validation cutoff: **2026-05-11 00:00 UTC**. Priority score was trained using only 30bps V12 **closed trade exits strictly before** this cutoff. Validation rows have entry at/after cutoff.

## Finding 1 – V12 capital utilization is low

Frozen V4 accepted-ledger study:
- Average V12 Gross **0.28550x**; median **0.19936x**, p90 **0.76699x**.
- V12 has no active leg **26.99%** of hours.
- V12 Gross <0.5x for **79.34%** of hours.
- Average nominal utilization of V12 2.0x cap: **14.28%**.
- The issue is both route availability and allocation: increasing requested Gross on an existing signal does not create signals during zero-position hours.

The forward-scored, full-sized experiment produced average V12 gross ~**0.765–0.771x** and zero-V12-position hours ~**26.2–26.4%**. Capital use improves, but zero-signal time barely changes.

## Finding 2 – Route repair is better than simply removing low-win-rate routes

First-pass causal route repairs (research source: `run_v12_v4_route_repair_integrated.py`):

| Route | Entry confirmation added | Exit changed |
|---|---|---|
| G2 | BTC24 aligned | fixed 6h |
| G3 | CLV favorable | preserve |
| G4 | BTC6 opposed | fixed 24h |
| X06 | Volume ratio >= 1 | fixed 18h |
| X07 | Directional body favorable | preserve |
| X08 | CLV opposed | preserve |
| X10 | source momentum age 12–24h | preserve |
| X14 | EMA12 distance 1–2 ATR and range in top quartile | preserve |

Second-pass research modifications (source: `run_v12_v4_route_repair_secondpass.py`):

| Route | Entry confirmation added | Exit changed |
|---|---|---|
| Core FAILED_BREAK | relative 24h negative and body favorable | fixed 9h |
| Robust CONT_SHORT_MID | EMA12 distance >= 1 ATR | fixed 3h |
| G1 | not top 24h range quartile | fixed 12h |
| X03 | EMA12 distance >= 1 ATR | preserve |
| X07 | BTC24 aligned and not compressed | preserve |
| X13 | not compressed | preserve |

30bps accepted-route changes in the second-pass integrated run:
- G2 **WR 35.8% -> 55.0%; PF 0.81 -> 8.38**, but accepted n **53 -> 40**.
- X06 **WR 45.0% -> 57.9%; PF 1.08 -> 3.15**, n 40 -> 38.
- X10 **PF 0.76 -> 6.62**, n 32 -> 14; caution: sparse adjusted sample.
- Core **WR 49.1% -> 65.7%**, n 55 -> 35.
- Robust **WR 33.3% -> 68.8%**, n 21 -> 16.
- X14 remains **PF 0.54 and net negative**, n 7 after repairs; not eligible for increased sizing.
- X07 still **WR 40%, PF 1.22**, n 15; only a low-confidence/low-gross candidate.

All route corrections are selected from the development period. They should **not** be mistaken for independent unseen-data improvements.

## Finding 3 – Full-year priority ranking has hindsight leakage

The original `build_v12_v4_priority_score_v2.py` computed route ranking using realized win rate, mean return, PF, and first/second period PF **from the same full replay** that was then evaluated. Using the later period to determine its own priority/sizing can overstate prospective results.

Example: the full-year rank placed `Y06` at position 21 despite relatively large support, while training-only evidence ranked `Y06` third with n=148. Multiple S-tier routes had only 8–14 training trades.

The new `run_v12_v4_priority_forward_split.py` scores only exits before 2026-05-11. Score:
- Bayesian-shrunk win rate using beta-like prior (wins+12)/(n+20);
- mean 30bps net return / entry notional;
- train-only 30bps PF;
- lower-tail return penalty;
- observation count confidence;
- extra penalty for negative train net PnL.
No route's validation trade outcome enters its own priority calculation. **However, route repairs were selected from the full development period, so this is not truly untouched OOS.**

## Comparison A – Frozen, in-sample repair, hindsight-optimized rank, forward-only rank

| Scenario | 10bps final JPY | 10bps max DD | 20bps final JPY | 20bps max DD | 30bps final JPY | 30bps max DD |
|---|---:|---:|---:|---:|---:|---:|
| Frozen V4, G5 fixed48 | 52,241,786 | -17.14% | 30,168,162 | -17.65% | 18,371,646 | -18.15% |
| 2nd-pass entry/exit repair, flat gross | 60,996,265 | -17.33% | 41,000,212 | -17.67% | 21,090,302 | -18.16% |
| Hindsight rank + 1.5x tier sizing | 291,326,103 | -20.42% | 231,193,740 | -20.97% | 174,749,524 | -18.39% |
| **Train-only rank + 1.5x tier sizing, no cap reduction** | **175,838,607** | **-23.06%** | **106,824,315** | **-23.32%** | **81,123,170** | **-23.73%** |

Thus, although historical profitability remains positive with train-only ranking, the headline return falls materially and **DD exceeds the 20% goal**.

Validation period V12 trades, train-only rank / no cap reduction:
- 10bps: **159** V12 trades, WR **74.21%**, PF **4.210**.
- 20bps: **155** V12 trades, WR **71.61%**, PF **3.264**.
- 30bps: **155** V12 trades, WR **69.03%**, PF **2.945**.

## Comparison B – Keep training-only rank fixed, vary caps

Requested gross remains tier-weighted, with Core native rank/size retained. These are **new research caps, not Production settings**.

| Recovery cap / V12 cap / Crypto cap / Total cap | 10bps final JPY | DD | 20bps final JPY | DD | 30bps final JPY | DD |
|---|---:|---:|---:|---:|---:|---:|
| 1.25x / 2.00x / 3.00x / 4.25x | 121,637,229 | -19.11% | 88,121,974 | -19.72% | 60,029,202 | -20.31% |
| **1.50x / 2.50x / 3.25x / 4.50x** | **158,468,411** | **-18.98%** | **95,492,098** | **-19.44%** | **65,045,922** | **-20.21%** |
| 2.00x / 2.75x / 3.50x / 4.75x | 188,103,072 | -19.84% | 118,641,477 | -22.39% | 84,256,240 | -23.18% |

**No tested cap setting satisfies max DD <= 20.00% simultaneously at all three costs.** The middle setting is the preferred *research comparison*, not a production handoff.

## Comparison C – Small-sample score gating

The `run_v12_v4_priority_sample_guard.py` study penalizes small sample ranks and limits their gross. Two pre-specified training-only confidence policies resulted in identical ranks/sizing because the sample distribution did not cross their distinct thresholds for any accepted route:
- N<20 max 0.12x, 20<=N<40 max0.20x;
- N<30 max 0.12x, 30<=N<60 max0.20x.

Both produced:
- 10bps JPY 88,295,788, DD -19.15%.
- 20bps JPY 59,097,129, DD -19.90%.
- 30bps JPY 36,571,493, DD -20.64%.

Confidence gating reduced model earnings and did not beat the 30bps DD criterion. It remains advisable as a *risk-control hypothesis*, not an established return optimizer.

## Decision / blockers

1. **Do not promote the hindsight-ranked V2 high-profit result to LIVE.** It ranks on the outcome data being evaluated and is not a clean predictive validation.
2. **Do not change Production Gross caps based on the present evidence.** All new cap settings are research-only.
3. Preserve profitable, meaningful-recovery signal families (notably Y06) rather than removing all low-win-rate routes.
4. X14 remains unresolved; do not increase its gross merely because its frozen win rate was 75% (PF was below 1).
5. The reasonable next target is a genuinely untouched post-2026-08-10 replay / fresh H1 market data, route/fee/venue reconciliation, and an explicit DD governor or risk budget that meets <=20% even at 30bps without mining the current year.
6. To improve the ~26% V12 zero-position hours, add *causal new signals in otherwise idle market regimes* and test global ownership priority; increasing current candidate sizes cannot solve zero-signal windows.
7. Real-order V12 Virtual Leg accounting, net venue reconciliation, partial exits and restart recovery remain separate Production certification gates.

## Execution evidence

- Root scripts:
  - `scripts/research/run_v12_v4_route_repair_integrated.py`
  - `scripts/research/run_v12_v4_route_repair_secondpass.py`
  - `scripts/research/build_v12_v4_priority_score_v2.py`
  - `scripts/research/run_v12_v4_priority_gross_v2_sweep.py`
  - `scripts/research/run_v12_v4_priority_forward_split.py`
  - `scripts/research/run_v12_v4_priority_forward_caps.py`
  - `scripts/research/run_v12_v4_priority_sample_guard.py`
- Reconciled result manifests:
  - `docs/research/results/v12-v4-route-repair-integrated-20261009/comparison-summary.json`
  - `docs/research/results/v12-v4-route-repair-secondpass-integrated-20261009/comparison-summary.json`
  - `docs/research/results/v12-v4-priority-gross-v2-stress-20261009/comparison-summary.json`
  - `docs/research/results/v12-v4-priority-forward-split-20261009/comparison-summary.json`
  - `docs/research/results/v12-v4-priority-forward-caps-20261009/comparison-summary.json`
  - `docs/research/results/v12-v4-priority-sample-guard-20261009/comparison-summary.json`
- Train-only rank source:
  - `docs/research/results/v12-v4-priority-forward-split-20261009/training-only-priority.json`
- All complete 10/20/30bps research runs reported `ALL_SCENARIOS_ACCOUNTING_AND_DEPOSIT_AUDIT_PASS`.
- Historical fills were modeled, **not** L2-verified.
- Preserve all unrelated worktrees and untracked historical research data. Never wipe research evidence merely for cleanup.
