# Official venue availability evidence — research only

STATUS: BLOCKED_HISTORICAL_EXECUTION_MARGIN_INPUTS_MISSING

Continues diagnostic source SHA `123df49950e3d5aba61e2d50e9ee1a37fae620d7`.
Production `53eeff5417636369d4709fddfd47d7916ddcf3b1` is NOT changed.
No operator artifact, deployment, HP update, order, cancel or position mutation.

## Primary source

Aster public `GET https://fapi.asterdex.com/fapi/v1/exchangeInfo` returned:

| Pair | onboardDate (ms) | UTC |
|---|---:|---|
| TAOUSDT | 1767967200000 | 2026-01-09 14:00 |
| TIAUSDT | 1767979800000 | 2026-01-09 17:30 |
| JUPUSDT | 1767967200000 | 2026-01-09 14:00 |
| RENDERUSDT | 1767706200000 | 2026-01-06 13:30 |

Boundary kline queries corroborate those starts. RENDER's query ending before
onboardDate returns the partial 13:00 candle containing the 13:30 listing;
that candle is NOT evidence of trading before listing and NOT a complete
post-listing H1 candle. Current metadata does not prove the absence of any
historical delisting/relisting; retain this qualification.

Raw GET responses and collection timestamp are preserved in `source-evidence.zip`.
No other exchange, interpolation, previous candidate membership or future PnL
is used to classify a source interval. Current filters are archived as current
rules only, NOT historical filters or account-specific 5x Cross evidence.

## Ledger

`overlay-full-H1-source-decisions.jsonl` has **61,488 rows = 8,784 hours × 7 symbols**.
Independent local regeneration produced identical SHA256:

`a88cc8fac5731818026139384f90020bf3493611f2477b228fb3ab5b8fe68639`

Each row is ELIGIBLE, NO_SIGNAL(reason), VENUE_PAIR_UNAVAILABLE, or SOURCE_ERROR.
ELIGIBLE means only the actual retained Production Overlay signal function
accepted its closed-bar features. It does NOT mean portfolio admission or fill.

Before official onboardDate is VENUE_PAIR_UNAVAILABLE. After listing, the first
closed post-listing bar is explicitly NO_SIGNAL. Actual Production needs d-1
through d-73, not an invented 74-bar rejection gate. Only missing pre-listing
history during that bounded start-up window becomes NO_SIGNAL warmup; actual
Production accepted signals are never suppressed by the classifier. Missing a
required post-listing bar or BTC reference even during warmup stays SOURCE_ERROR.
Invalid source/volume is never silently
converted to no signal. Missing baseline decision evidence stays SOURCE_ERROR.

Remaining source failures are 1,860 **symbol-hour** volume-median failures:
TIA 902, JUP 463, DOT 265, RENDER 169, AVAX 61. These are not 1,860 unique hours,
and are not evidence of missing OHLC bars. The Production evaluator's existing
fail-closed behavior is preserved; no volume denominator or rule is adjusted.

## Test discovery diagnosis

Full Windows discovery reproduced 187 tests / 2 failures / 2 import errors /
2 POSIX skips, exit 1. Non-sandbox execution removes transient WinError 5
temporary-directory failures, but cannot provide Windows with Linux `fcntl`.

The two stale failures were:

- historical Q102 test also asserting an obsolete 1.5x LIVE value; changed only
  the current-runtime portion to assert current template sizing is positive and
  cannot exceed the actual strict-planner ceiling. Historical 1.0x artifacts
  and tests are unchanged. A smaller template than absolute ceiling is valid;
  it is not evidence that the deployed environment uses that template.
- monitoring assertion expecting the old `DISDEX_MONITOR_TIMER_ACTIVE` event;
  current wiring reports ARMED only for active/waiting. Assert ARMED, waiting
  and explicit failure; do not restore the obsolete runtime behavior.

The new workflow executes **all Python test discovery on Ubuntu**, including
retention/fcntl tests. Local Windows failures are not claimed as a green suite.

## 2026-10-03 continuation: Core decision evidence completed

Research SHA `0d21b21fff23d58001bcbe1e7f4377d1013fe304` and GitHub Actions
run `37122391842` completed successfully without Production mutation.

The prior Core-decision evidence gap is now closed:

- Q102 exact full-observability replay: 74/74 chunks PASS, 8,784 H1 decision
  timestamps, 166,834 per-symbol rows, 372 SIGNAL, 77 CANDIDATE, 166,385 WAIT.
- Q102 per-symbol full ranking evidence: PASS.
- Q102 decision-source byte parity: PASS across the archived scan commit,
  audited frozen snapshot and manifest-verified repository commit.
- V12 scheduled ledger: 61,502 rows / 1,459 SIGNAL.
- PENGU scheduled ledger: 8,784 rows / 113 SIGNAL.
- FET scheduled ledger: 2,196 rows / 26 SIGNAL.
- V52 approved price-only model: 8,784 H1 rows, all 649 scheduled windows
  observed, 98 SIGNAL, 546 WAIT, 5 SOURCE_ERROR, 0 missing scheduled windows.
- Linux full Python discovery at the same SHA: 213/213 PASS.

The combined decision-layer ruling is
`PASS_CORE_FULL_DECISION_EVIDENCE_PRICE_ONLY_V52`. This is explicitly not a
historical LIVE execution certificate.

## Certification remains blocked only on historical execution/margin inputs

Production order-path safety contract tests PASS, including account-lock bounded
retry, cross-runner pending exposure reservation, exact 5x Cross mutation/readback
before exposure, Q102 post-preemption replanning, resident-protection recovery,
unknown/partial-exit fail-closed behavior and V12 worst-case gross reservation.

However, the fixed historical release has no primary tapes for:

- point-in-time account availableBalance/equity/margin at each exposure decision;
- historical symbol filters and account-specific leverage/margin-mode read-back;
- pending-order and shared account-lock chronology;
- actual partial/unknown execution reconciliation timestamps;
- resident protection fill and actual exit chronology.

Current exchangeInfo, current read-only account checks, synthetic margin emulation,
archived candidate schedules and price-only fills cannot reconstruct those missing
historical facts. The remaining status is therefore
`BLOCKED_HISTORICAL_EXECUTION_MARGIN_INPUTS_MISSING`.

The prior 20-case results remain diagnostics and are NOT re-certified. They may be
re-run for diagnosis, but no certification/operator/deploy/HP action is authorized
until the missing historical execution/margin evidence is proven.

No Production code/config, operator artifact, current symlink, order, cancel or
position was changed.
