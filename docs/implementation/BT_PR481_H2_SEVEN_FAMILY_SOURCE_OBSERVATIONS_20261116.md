# BT-481-H2 | Seven-family native-source observation ledger (2026-11-16)

## Task outcome

**BT-481-H2 source-only integration validated in the isolated BT page worktree.**
No VPS, Production runner, Codex implementation, real order, STOP, Kill Switch,
account position or main-branch merge was changed.

Source reference frozen at checkout
`9118eeaa6c209dc6e37887cf5be139b3baaa005d`, **not certified equal to current LIVE**.

## Reproducible artificial research inputs

- Frozen synthetic feed **v4**, 33 symbols, `seed=20261115`, scenario `rotation`,
  from **2025-10-01 00:00Z through 2025-10-23 00:00Z (exclusive)**, 5-minute modeled quotes
  with fully completed H1/H2 and strict information cutoffs.
- FET: real pinned `buildFetBrk48Signal` pure function; 4-hour UTC modulo decision.
- IDLE: real frozen priority Short function, with preliminary source-era research gates
  recorded, *not* position admission or full portfolio risk.
- PENGU: pinned V2 + Short V20 + Recovery V8 pure source.
- Q102: S1/S2 **HIGH_VOL raw feature matches only** (no preceding 180-day
  closed-trade monthly winner); S3/S4 raw and strict source-gated candidates
  are classified separately and carry their two respective immutable original source hashes.
- V4: only the original `FAILED_BREAK_REV_SHORT_6H` H2 state-machine source.
  Remaining V4 routes and complete V4/STABLE4 parity remain unimplemented.
- HYPE: **research H48 gate**, SHA of the isolated research source file.
  It is **not** a certified current native HYPE LIVE implementation.
- V52: native **unaltered 85-line V50** source candidate method from
  `disdex_v52_aster_only_legacy_engine.py` tested with independent *invented*
  Aster and stock-reference quote streams. The 39 NY weekday selection windows
  are **not** an exchange or holiday-calendar simulation.

## Results, with exact stage distinction

| Family | Observations | Candidate-stage rows | Qualification |
|---|---:|---:|---|
| V4 | 2,655 | 3 | Native FAILED_BREAK event only |
| Q102 | 2,327 | 0 | S3/S4 215 raw, **0** quality-gated; S1/S2 grid features only |
| PENGU | 349 | 11 | Pure V2/V20/V8 source candidate shadow |
| FET | 114 | 0 | Native source gate did not fire in this seed/scenario |
| IDLE | 2,280 | 4 | Native entry plus preliminary research filter shadow |
| V52 | 31 | 31 | Native V50 selection from invented paired quotes |
| HYPE | 504 | 5 | Research H48 6-hour grid candidate only |
| **Total** | **8,260** | **54** | **NO ENTRY VERIFIED / NO FILL** |

Stage counts: **8,206 FEATURE_ONLY**, **54 SOURCE_CANDIDATE**, **0 ENTRY_VERIFIED**,
**0 RESEARCH_RULE_SELECTED**. Every row includes family, native/research runner,
symbol, original source SHA256 (or the isolated HYPE research file SHA), source file,
route, event timestamp, source-observed-until timestamp, availability timestamp and
a deterministic observation ID. Rows obey `eventTs <= sourceObservedUntilTs <=
availableAtTs <= cutoffTs`.

These 54 are **not 54 valid integrated trades**. In particular, no Q102 candidate
survives S3/S4 quality gates on this artificial rotation path; no additional
candidate is invented to inflate coverage.

## Evidence and tests

- `scripts/bt-hp-seven-native-source-observations.ts`: native probes run
  against one causal v4 artificial market, exports six family raw observations.
- `scripts/bt-hp-v52-dual-source-temporal-selftest.py`: independently verifies
  the V52 exact original method and quote chronology; the H2 merge uses its
  fully validated 31 candidate windows, not the five illustrative samples.
- `scripts/bt-hp-seven-source-observation-merge.py`: rejects incompatible
  scenarios and source hashes, joins V52, invokes the existing fail-closed
  H1 ledger validator and saves **all 8,260 rows** in deterministic gzip.
- `scripts/bt-hp-unified-candidate-observation-ledger.py`: extended to support
  multiple pinned sources per family (Q102 S1/S2 vs S3/S4) and
  `sourceObservedUntilTs` including strict chronology; other prior checks
  and execution-field blacklist preserved.
- `scripts/bt-hp-seven-native-observation-ledger-selftest.py`: archive SHA,
  original HYPE source SHA, counters, per-family provenance, zero executable
  fields, cutoff, tamper tests for pin/time/route and missing proof.
- Archive: `reports/bt-verification/BT_PR481_H2_7_FAMILY_CAUSAL_OBSERVATIONS_20261116_V1.json.gz`
- Manifest: same path with `.manifest.json`; this records exact source ledger
  `sha256`, archive `sha256`, generator scenario and **explicit non-trade semantics**.
- **Canonical ledger digest**:
  `b1a2714e028a11c2779ab0d430120be15a50bb1b6d8fb9bf83071d4727cd197b`.

## Critical remaining tasks

The full BT UI is **not yet consuming this source ledger**. The safe next
task is to surface its **read-only manifest and stage counts** on the dedicated
BT page, not to turn candidate-stage rows into fills or account PnL.

After that: recover and pin all V4 routes, genuinely train the causal 180-day
Q102 S1/S2 monthly selector from completed-source exits, connect Online
Layer 2/3, full source-native exit/STOP and occupied capital ledgers, shared
risk/stock and crypto Gross, and only then the six-month 10bps/30bps
integrated synthetic portfolio research. Full authenticated UI E2E and
owner-approved HP publishing remain separate gates.

**Real orders: 0. Real fills: 0. Simulated integrated seven-family fills: 0.
Reported integrated win rate or DD: none.**
