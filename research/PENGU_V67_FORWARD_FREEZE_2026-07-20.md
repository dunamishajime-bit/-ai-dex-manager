# PENGU V67 Forward Freeze

Freeze start: **2026-07-20T13:13:21Z**  
Japan time: **2026-07-20T22:13:21+09:00**

## Purpose

Preserve an untouched future evidence stream while allowing separate research to continue.

PENGU is treated as a specialized large-wave instrument. Two scoreboards must never be mixed:

1. **Wave scoreboard** — Long/Short major-wave capture, early-entry rate, captured move, and realized profit.
2. **Normal-alpha scoreboard** — all positive profits overlapping defined major waves are set to zero; losses, funding, fees, slippage, and failed signals remain.

The Normal-alpha scoreboard is the primary robustness metric.

## Frozen references

- Research base branch at freeze: `research/v35-core-pengu-v67-combined`
- Reference head observed at freeze: `1bc2d5611fd8bc5bf6b6f6e177fda9005531059e`
- V67 selected Gate: `D_M3_GE_N5_F_VOL_GE_0p9`
- V67 source Artifact ZIP SHA-256: `cdfff86cd351dd58403e823a94643a81875509bb5a57ad8c889d47c7e0db96c0`
- V67 source JSON SHA-256: `d8748f0b2ef34fd575edf7ac6270219ef01c0f6b457dcde2c341dcf440de9c2a`
- V71 allocation Artifact ZIP SHA-256: `e173c1bf565194a32f05ff749387df842870cd5d9b32393e45c4585dbe452d63`

## Frozen evaluation tracks

### Track A — Signal evidence

- Use the exact V67 Entry, Exit, Gate, Long/Short conflict, funding, completed-candle, cost, and execution assumptions.
- Maximum PENGU Gross for comparable signal evidence: **0.30**.
- No unconfirmed Probe entries.
- No parameter changes.

### Track B — Sizing shadow

- V71 target Gross **1.15** may be calculated as a shadow result only.
- Portfolio Gross cap remains **2.0**.
- This track does not count as independent signal evidence and must not replace Track A.

## Major-wave definition

Maintain the frozen definitions used by the V67 research Artifact:

- absolute 24-hour move of at least 20%; or
- absolute 72-hour move of at least 35%.

Report Long and Short separately.

## Required forward records

Record every completed decision, including no-order decisions:

- completed candle timestamp;
- signal family and side;
- armed/confirmed/rejected state;
- rejection reason;
- funding value or missing state;
- intended Gross and clipped Gross;
- estimated and realized costs;
- order and reconciliation result;
- entry/exit timestamps and prices;
- PnL under normal and Severe cost assumptions;
- major-wave overlap classification determined after the event;
- normal-alpha PnL after positive major-wave profit removal.

## Evidence gates

Do not call the frozen strategy forward-validated until both are satisfied:

- at least **30 completed trades**; and
- at least **6 calendar months** after the freeze start.

Minimum forward acceptance gates:

- Normal-alpha compounded return > 0;
- Normal-alpha Severe compounded return > 0;
- Normal-alpha PF >= 1.20;
- Normal-alpha Max DD >= -10%;
- no single trade contributes more than 35% of positive normal-alpha profits;
- no single month contributes more than 50% of normal-alpha profit;
- Long and Short wave capture reported separately, without using it to hide normal-alpha losses.

## Versioning rule

- Research may continue on separate versions.
- Any change to the frozen V67 rules creates a new strategy ID and a new forward clock.
- New research results must not overwrite or backfill this frozen stream.
- Changes to BTC, ETH, BNB, or SOL Core logic do not reset this PENGU clock, provided PENGU rules and account-level execution assumptions remain unchanged.

## Safety

- Research-only record.
- No Production, LIVE, VPS, or order changes are authorized by this document.
