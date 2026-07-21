# Dis-Dex V96 Forward Shadow Protocol

Date frozen: 2026-07-21

## Scope

This protocol covers three research-only tracks:

1. `EXACT_BOOST_PYRAMID2P5_T6`, the original counterfactual Core sizing overlay;
2. `EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1`, the historically stable Funding-guarded sizing overlay;
3. any independent Alpha candidate that survives its historical robustness screen.

The protocol does not authorize Production allocation, order submission, VPS service replacement or changes to the live V96 target.

## Original Core Shadow candidate

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

Status: `HISTORICAL_NEAR_PASS_SHADOW_ONLY_NOT_APPROVED`.

## Funding-guarded Core Shadow candidate

Strategy ID: `EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1`

This candidate uses every original Core Shadow condition and adds:

- the completed 12-hour Funding bucket for the selected symbol must have valid coverage;
- the completed 12-hour Funding bucket must be at most **1.0 bps**;
- exactly one completed 12-hour Funding bucket is used;
- missing, invalid or ambiguous Funding fails closed.

The 1.0 bps boundary is the conservative edge of a historical 1.0–1.5 bps stability plateau. The 1.0, 1.25 and 1.5 bps tests produced the same five Normal events, the same 80% positive-event rate and the same historical return deltas.

Status: `HISTORICAL_STABLE_LEAD_SHADOW_ONLY_NOT_APPROVED`.

The new status does not authorize Production. The accepted historical events occurred only in 2023 and 2024; no 2025 or 2026H1 activation evidence exists.

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
- completed 12-hour Funding value in bps and Funding coverage status;
- eligibility result and every failed reason;
- unclipped and clipped counterfactual weight;
- counterfactual additional quantity using the observed account equity and mark price;
- observed Funding, estimated fees and slippage assumptions;
- live and counterfactual mark-to-market contribution until the episode exits;
- whether data coverage and chronology checks passed.

Secrets, private keys, signatures and authenticated request payloads must never be written to the Shadow record.

## Episode rules

- An episode starts when a symbol changes from zero to non-zero exposure or changes direction.
- An episode ends when exposure returns to zero or changes direction.
- At most one Shadow add is permitted per episode and strategy ID.
- Restart recovery must reproduce the same episode ID and add-used state from durable records.
- Missing or ambiguous history fails closed: the Shadow decision is ineligible, and no counterfactual add is assumed.
- Original and Funding-guarded candidates must have separate attribution and must not be combined into a larger counterfactual allocation.

## Funding-guarded Forward review gate

The Funding-guarded candidate cannot be reviewed for promotion until all of the following are satisfied:

- at least 60 calendar days after its frozen protocol begins;
- at least 10 eligible activation events;
- activations from at least two Core symbols;
- at least 95% completed-decision and Funding-data coverage;
- exact reconciliation of every live target against the unchanged V96 runner output;
- counterfactual results reported with observed Funding and conservative fee/slippage assumptions;
- Normal and Severe counterfactual contribution both positive;
- no single positive activation contributes more than 40% of total positive Shadow contribution;
- no material worsening of account-level drawdown or daily-loss-trip frequency;
- no post-freeze rule or threshold changes.

The original candidate remains subject to its earlier minimum gate of 30 calendar days, 10 events, two symbols and 95% completed-decision coverage. Passing the original gate does not substitute for passing the Funding-guarded gate.

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

- Original Core Shadow candidate: `HISTORICAL_NEAR_PASS_SHADOW_ONLY_NOT_APPROVED`
- Funding-guarded candidate: `HISTORICAL_STABLE_LEAD_SHADOW_ONLY_NOT_APPROVED`
- Independent Alpha: 96 historical candidates screened; 0 approved
- Production changed: **NO**
- LIVE changed: **NO**
- Orders sent by this protocol: **NO**
