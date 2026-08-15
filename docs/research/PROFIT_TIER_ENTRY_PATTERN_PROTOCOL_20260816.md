# Profit-Tier Entry Pattern Protocol — 2026-08-16

Research-only continuation after Frozen Loss-Only Entry Firewall V1.

## Objective

Use the fixed V96+ normalized historical trade corpus to collect profitable entries,
stratify them into BIG / MEDIUM / SMALL profit tiers, derive recurring causal entry
conditions for each tier, then apply only profit patterns that do not trigger any
Frozen Loss-Only Entry Firewall V1 blocker.

## Information order

1. Load the already-fixed V96+ normalized trade corpus.
2. Keep positive-return trades only for profit-pattern discovery.
3. Reconstruct entry-time causal OHLCV features with the already-frozen feature
   function from `research_loss_only_firewall_discovery.py`.
4. Reject any profitable historical entry that matches Frozen Loss-Only Entry
   Firewall V1 before profit-pattern discovery.
5. Partition remains the pre-existing LOSS_DISCOVERY / LOSS_VALIDATION family split.
6. Profit tier boundaries are rule-based, not hand-tuned:
   - compute P33 and P67 of positive `returnPct` in the firewall-clean Discovery set;
   - SMALL: `0 < returnPct <= P33`;
   - MEDIUM: `P33 < returnPct < P67`;
   - BIG: `returnPct >= P67`;
   - freeze these numeric boundaries and apply them unchanged to Validation.
7. Candidate feature/value patterns are evaluated separately for BIG, MEDIUM, SMALL.
8. No Fresh OOS is read.

## Predeclared reproducibility gates

A tier pattern must meet all of the following in both Discovery and Validation:

- Discovery matched positive entries >= 20;
- Validation matched positive entries >= 30;
- >= 3 symbols in both partitions;
- >= 2 half-year periods in both partitions;
- >= 3 source families in Discovery and >= 2 in Validation;
- one accepted value per feature per tier;
- maximum 5 accepted patterns per tier.

Tier enrichment requirements versus the partition-wide tier baseline:

- BIG: Discovery lift >= 1.20 and Validation lift >= 1.10;
- MEDIUM: Discovery lift >= 1.10 and Validation lift >= 1.05;
- SMALL: Discovery lift >= 1.05 and Validation lift >= 1.00.

Ranking is by the minimum of Discovery/Validation tier lift, then minimum tier share.
No losing trade outcome is used to select Profit Pattern rankings; loss information is
used only through the already-frozen binary Entry Firewall veto.

## First candidate rule, frozen before its backtest

At each 6h decision point, evaluate both LONG and SHORT hypothetical entry features for
ETH/BNB/SOL/LINK/AVAX.

- Any Frozen Loss Firewall match => reject.
- BIG pattern match weight = 4.
- MEDIUM pattern match weight = 2.
- SMALL pattern match weight = 1.
- Entry requires at least one BIG pattern and total Profit Pattern score >= 4.
- If both LONG and SHORT of the same symbol qualify, keep only the higher score; exact
  score ties are rejected.
- At most 2 open positions.
- Fixed 24h holding period; no learned exit.
- Equal 0.5 gross slots; total gross <= 1.0.
- Normal = 10bps per side, no delay.
- Stress = 30bps per side, 1h entry/exit delay.
- No pair-specific parameter, no grid, no rank replacement, no leverage increase.

## Evaluation standard

Historical 2023-07-01 through 2026-07-01 is already-inspected DESIGN evidence, not
Fresh OOS. The first candidate backtest is run once. The profit-tier definitions,
accepted patterns, weights, score threshold, hold duration, and gross are not rescued
or retuned from that same backtest.

Return target remains:

- each year >= 80% minimum floor;
- median annual return >= 100%;
- 3Y CAGR >= 100%;
- robustness / PF / DD / Stress gates remain required.

No production, VPS, LIVE, order, or deployment path is modified.
