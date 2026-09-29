# Idle Priority SHORT — Canonical Source Recovery Addendum (2026-09-30)

This document supersedes the blocker claim that the JPY141.845M baseline source does not exist.

## 1. Canonical five-logic baseline is preserved as an immutable-style GitHub Release

Release tag:

`bt-v12-score100-volume080-normalonly-20260928`

Release page:

https://github.com/dunamishajime-bit/-ai-dex-manager/releases/tag/bt-v12-score100-volume080-normalonly-20260928

Archive:

`bt-v12-score100-volume080-normalonly-20260928.tar.gz`

Archive bytes:

`51,556,747`

Archive SHA256:

`891c36d8a5957cafe3aae65656a98b7c02a3c437c4f520fe63756d550f08b4fb`

The archive has a `RELEASE_MANIFEST.json` covering 764 files and a `REPLAY_INDEX.json` with per-file SHA256/size.

Primary adopted 10bps baseline path inside the archive:

`selected-five-logic-all-cases-all-costs/BRK0P75_MR0P75_FET1_DUAL_GATE/PRICE_MODEL_10BPS/`

It contains at least:

- `metrics.json`
- `portfolio-trades.jsonl`
- `candidate-decisions.jsonl`
- `portfolio-events.jsonl`

The archive also contains the historical Aster H1/funding inputs, V52 source tape/ledger, source/replay code, original and selected scans, and provenance needed for deterministic replay.

Exact adopted 10bps anchors:

- final JPY: `141845207.7243423`
- closed portfolio transactions: `1284`
- V12 transactions: `991`
- PF: `2.077173748`
- win rate: `55.140187%`
- maximum MTM DD: `-22.8733513%`

Do not substitute the nearby JPY130,287,867 / 1,046-trade run.

## 2. Canonical Idle candidate inputs are recovered

Two exact CSVs exist outside Git in the preserved ChatGPT Library and have been exported as the user-supplied package:

`IDLE_PRIORITY_CANONICAL_EVIDENCE_20260930.zip`

Inside:

### idle_candidate_events.csv
- bytes: `149207`
- rows: `495`
- SHA256: `09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb`

### idle_candidate_filtered.csv
- bytes: `22234`
- rows: `63`
- SHA256: `5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48`

Verify both SHA256 values before use. Do not normalize, round, re-save, or substitute them before verification.

## 3. integrated-idle-ledger.csv is an output, not a prerequisite input

Do not remain blocked merely because an old `integrated-idle-ledger.csv` file is absent.

The integrated 61-trade Idle ledger must be regenerated deterministically from:

1. the exact 495/63 candidate evidence above,
2. the exact JPY141.845M baseline release inputs and replay source,
3. baseline candidate decisions and portfolio events,
4. the accepted Idle admission/gross/hold rules in the design specification.

The integrated replay must prove rather than assume:

- 63 filtered candidates
- 61 admitted Idle trades
- 48 wins / 13 losses
- admitted counts: TAO9 / DOT14 / JUP14 / TIA9 / RENDER15
- exact rejected DOT row and exact rejected TIA row
- contemporaneous rejection/admission reason for both rows
- baseline same-timestamp priority
- no partial Idle sizing
- full shared-portfolio re-admission, including the baseline trades changed by Idle exposure
- total integrated closed trades approximately `1342`
- final equity approximately `JPY268.05M`
- PF approximately `2.055`
- max MTM DD approximately `-23.24%`

Never select the rejected DOT/TIA rows by future PnL.

## 4. Resume rule

A previous status of:

`BLOCKED_MISSING_CANONICAL_SOURCE`

is no longer valid once both conditions are true:

- the GitHub Release archive is downloaded and SHA-verified;
- the supplied canonical Idle evidence ZIP is extracted and both CSV SHA256 values are verified.

At that point resume deterministic replay. If replay diverges, return a new exact blocker describing the first causal mismatch, not MISSING_CANONICAL_SOURCE.

Production/VPS/LIVE remain prohibited until the parity replay and safety gates pass.
