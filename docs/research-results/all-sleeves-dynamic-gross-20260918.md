# All-sleeves Dynamic Gross Research — 2026-09-18

Status: **PASS_RESEARCH_ONLY**

No LIVE/VPS/production state was changed and no orders were sent.

## Contract

- Period: 2025-08-10 through 2026-08-10.
- Initial capital: JPY 10,000.
- Monthly contribution: JPY 10,000 x 12.
- Compounding: enabled.
- Shared crypto gross cap: 3.0x.
- Total gross cap: 3.5x.
- Shared crypto daily loss: 7.5%.
- Venue margin assumption: 5x Cross.
- Acceptance gate: NORMAL and SEVERE DD >= -20%, gross conflicts = 0, and baseline core entry counts preserved.
- Engine: the same reconstructed full-event engine used by the formal current-parity replay.

## Q102 dynamic residual frontier held as the crypto overlay anchor

- HIGH_VOL: 1.665x
- MR: 1.0x
- BRK: 2.475x
- REV: 2.5x
- PB: 2.5x

With V12 1.5x aggregate / 1.0x per position, PENGU 0.85x, and current V52 1.5x aggregate / 1.0x slot:
| Scenario | Ending asset | PF | DD | Trades |
|---|---:|---:|---:|---:|
| NORMAL | JPY 200,212,840.10 | 3.84957445 | -19.35894780% | 1,221 |
| SEVERE | JPY 23,687,637.26 | 2.80751006 | -19.99482558% | 1,078 |

## V12 findings

Increasing only the V12 aggregate cap is not efficient under the strict DD20 contract.

- 1.525x: NORMAL JPY 200,510,784.97 / DD -19.4114%.
- 1.525x: SEVERE JPY 23,618,158.73 / DD **-20.0144%**, so it fails.
- Higher V12 caps worsen the SEVERE DD further.
- Lowering V12 to 1.45x creates only a small DD cushion (SEVERE -19.9803%) while reducing NORMAL ending asset to JPY 255,494,587.13 when combined with the buffered V52 expansion.

Conclusion: keep V12 at **1.5x aggregate / 1.0x per position** for this contract.

## PENGU findings

Increasing PENGU produces attractive headline return but violates the preserved-core routing contract.

- 0.875x: NORMAL JPY 210,512,800.57 / DD -19.3589%.
- 0.875x: SEVERE JPY 24,022,524.09 / DD -19.9948%.
- However SEVERE V12 entries fall from **871 to 869**.
- Reducing Q102 HIGH_VOL or reducing V12 aggregate/per-position gross did not restore the two lost V12 entries.
- No tested PENGU >0.85x joint case passed the preserved-core + DD20 gate.

Conclusion: keep PENGU at **0.85x** under the current 3.0x crypto cap and 7.5% shared daily-loss contract.
## V52 findings

V52 is the only sleeve that can materially expand gross while preserving all baseline entry counts and staying under DD20 in both scenarios.

### One-year edge frontier

The highest tested passing point is:

- Stock aggregate gross: **1.9834x**
- Per-stock slot gross: **1.6498x**

| Scenario | Ending asset | PF | DD | Core entry parity | Gross conflicts |
|---|---:|---:|---:|---|---:|
| NORMAL | JPY 259,596,844.90 | 3.84147124 | -19.65371332% | PASS | 0 |
| SEVERE | JPY 23,687,637.26 | 2.80751006 | -19.99482558% | PASS | 0 |

This is a 29.66% NORMAL ending-asset uplift versus the Q102-frontier anchor.

The edge is narrow: aggregate 1.9836x at slot 1.645x loses one V12 entry, and slot 1.65x already loses one V12 entry in nearby aggregate configurations. Therefore the decimal edge point should be treated as a research frontier, not a production constant.

### Buffered research candidate

Use **V52 stock aggregate 1.98x / slot 1.64x** as the reproducible safety-side candidate.

| Scenario | Ending asset | PF | DD | Core entry parity | Gross conflicts |
|---|---:|---:|---:|---|---:|
| NORMAL | JPY 258,717,730.68 | 3.84156032 | -19.64868214% | PASS | 0 |
| SEVERE | JPY 23,687,637.26 | 2.80751006 | -19.99482558% | PASS | 0 |

The buffered candidate retains 99.66% of the one-year edge-frontier ending asset and improves NORMAL ending asset by 29.22% versus the Q102-frontier anchor.
## Resulting research configuration

- V12: **1.5x aggregate / 1.0x per position / Top2**.
- PENGU: **0.85x**.
- Q102: **HV 1.665 / MR 1.0 / BRK 2.475 / REV 2.5 / PB 2.5** with required-only preemption.
- V52: **1.98x stock aggregate / 1.64x slot** for the buffered research candidate.
- Crypto gross cap: **3.0x**.
- Total gross cap: **3.5x**.
- Shared crypto daily loss: **7.5%**.

## Important interpretation

The V52 expansion follows the existing formal priority order. It preserves entry counts, but it is not a proof of zero notional interaction: in NORMAL, the summed V12 allocated entry gross is modestly lower than the Q102-frontier anchor and Q102 receives additional resize events. This is why the result remains research-only.

A truly preemptible V52/PENGU/V12 boost layer would require exact mark-to-market data for the boosted portion at later cross-sleeve entry times. That data is not present in the current V12/PENGU trade ledgers, so the study does not fabricate mid-position PnL or use future knowledge.

## Decision

- Dynamic Residual Allocation for Q102 remains supported by the exact full-event replay.
- Do **not** increase V12 above 1.5x under the strict DD20 contract.
- Do **not** increase PENGU above 0.85x under the current shared-risk contract.
- V52 has verified room to expand; **1.98x aggregate / 1.64x slot** is the buffered research candidate.
- No LIVE deployment is authorized by this research artifact alone.
