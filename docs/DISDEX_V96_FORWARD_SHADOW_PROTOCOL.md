# Dis-Dex V96 Forward Shadow Protocol

Date frozen: 2026-07-21

## Scope

This protocol covers two research-only tracks:

1. `EXACT_BOOST_PYRAMID2P5_T6`, a counterfactual Core sizing overlay;
2. any independent Alpha candidate that survives the historical robustness screen.

The protocol does not authorize Production allocation, order submission, VPS service replacement or changes to the live V96 target.

## Frozen Core Shadow candidate

Strategy ID: `EXACT_BOOST_PYRAMID2P5_T6`

A counterfactual add is eligible only when all conditions are true on a completed 12-hour decision:

- the symbol position is already active;
- V95 Strong Boost is active;
- Whipsaw is inactive;
- drawdown stage is zero;
- the signed cumulative symbol move since the current exposure episode began is at least +6%;
- the latest completed 12-hour signed symbol return is positive;
- the episode has not already received a Shadow add.

The counterfactual symbol weight is the unchanged V96 symbol weight multiplied by `1.025`, then clipped by the unchanged total Gross cap. The live target is never modified by this protocol.

## Required decision record

Each completed 12-hour decision must persist an append-only record containing:

- schema version;
- strategy ID and frozen config fingerprint;
- runtime commit SHA;
- decision timestamp and latest completed candle timestamp;
- symbol and exposure-episode ID;
- live target weight and total live Gross;
- Strong Boost, Whipsaw and drawdown-stage state;
- cumulative signed move and latest signed return;
- eligibility result and every failed reason;
- unclipped and clipped counterfactual weight;
- counterfactual additional quantity using the observed account equity and mark price;
- observed funding, estimated fees and slippage assumptions;
- live and counterfactual mark-to-market contribution until the episode exits;
- whether data coverage and chronology checks passed.

Secrets, private keys, signatures and authenticated request payloads must never be written to the Shadow record.

## Episode rules

- An episode starts when a symbol changes from zero to non-zero exposure or changes direction.
- An episode ends when exposure returns to zero or changes direction.
- At most one Shadow add is permitted per episode.
- Restart recovery must reproduce the same episode ID and add-used state from durable records.
- Missing or ambiguous history fails closed: the Shadow decision is ineligible, and no counterfactual add is assumed.

## Forward review gate

The Core Shadow candidate cannot be reviewed for promotion until all of the following are satisfied:

- at least 30 calendar days after the frozen protocol begins;
- at least 10 eligible activation events;
- activations from at least two Core symbols;
- at least 95% completed-decision data coverage;
- exact reconciliation of every live target against the unchanged V96 runner output;
- counterfactual results reported with observed funding and conservative fee/slippage assumptions;
- Normal and Severe counterfactual contribution both positive;
- no single positive activation contributes more than 50% of total positive Shadow contribution;
- no material worsening of account-level drawdown or daily-loss-trip frequency;
- no post-freeze rule or threshold changes.

A failed gate does not authorize threshold tuning from the observed Forward sample. A new rule requires a new strategy ID, new fingerprint and a new Forward clock.

## Independent Alpha Shadow requirements

Any historical independent Alpha survivor must use:

- a separate strategy ID;
- a separate Gross budget and attribution ledger;
- completed-candle chronology with next-bar execution assumptions;
- the existing V96 total Gross cap, with the frozen Core receiving priority;
- separate event IDs, funding, fees, slippage and drawdown metrics;
- no order route until a separate reviewed Production promotion.

## Current status

- Core Shadow candidate: `HISTORICAL_NEAR_PASS_SHADOW_ONLY_NOT_APPROVED`
- Independent Alpha: 30 historical candidates screened; 0 approved
- Production changed: **NO**
- LIVE changed: **NO**
- Orders sent by this protocol: **NO**
