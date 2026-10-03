# Official venue availability evidence — research only

STATUS: BLOCKED_OVERLAY_FULL_H1_BASELINE_EVIDENCE_AND_MARGIN_PARITY_NOT_PROVEN

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

## Certification remains blocked

This is an Overlay source/signal ledger, not the requested full Core H1
eligibility/admission ledger. The existing archived Core candidate lifecycle
cannot explain every absent hourly signal, ranking and no-signal decision.
Do not manufacture NO_SIGNAL for hours absent from its candidate list.

No execution/margin certificate is issued. Current exchangeInfo cannot supply
historical margin availability, maintenance tiers, account-specific leverage,
partial/unknown fill chronology, pending/order lock timing, or historical filters.
The current price-model's candidate/exit schedule is not evidence for those.
Those missing proofs must remain explicit rather than selecting arbitrary
fills/margin assumptions to achieve the previous diagnostic PnL.

The prior 20-case results remain diagnostics. They are NOT re-certified by this
availability ledger. Overlay direct PnL, downstream compounding, foregone Core
PnL and incremental fee/funding/slippage attribution still require a certified
causal paired run; do not add the old PnL summaries as a substitute.

No Production code/config or current symlink was changed.
