# V4 repeated exit: signed account ledger freshness

Production 2a6f27c6d2896aee420cbc44fe1ab8103750376c exited at
2026-11-05 01:01:43 and 03:00:46 JST with
`FRESH_SHARED_ACCOUNT_LEDGER_REQUIRED`. Current PID is 2813424 after bounded
recovery; do not claim uninterrupted operation from prior PID 2501831.

The real signal-to-order engine reproduces the failure without venue access:
signed account mark precedes cold candidate processing. Terminal history
incorrectly prevented reuse of the already prepared flat decision, causing a
second cold scan under the account lock. After thirty seconds the independent
reservation gate rejected the account mark, and the daemon treated this exact
read-only safety failure as fatal. Slow quote/authority work could also persist
a PREPARED intent before the freshness refusal.

Repair: terminal-only flat history can reuse the unchanged same-H2 prepared
decision. If candidate processing ages the account ledger, refetch genuine signed
positions/orders/balances, peers and pending through the existing budget/lock,
then revalidate ownership, Gross and resident STOPs. Track individual signed
response receipt times; a delayed response cannot redate older responses. The
journal stays append-only and records signedCapturedAt separately from its
monotonic append timestamp. The initial repair retained thirty seconds; the
owner subsequently explicitly directed a 120-second account-ledger admission
limit. All related source gates now use one immutable 120,000ms constant,
rejects malformed/future source clocks and cannot use a fresh append to mask an
old source. If later entry preparation expires the mark, block before persisting
an intent or sending a request. The two exact freshness failures retry blocked;
tampering, unknown/ambiguous submission errors remain fatal/reconciliation bound.

No route, rank, entry/exit condition, size, Gross cap, loss cap, stop plan,
reservation limit or rate/account lock has been changed. The eight immutable
economic files remain byte-identical. No entry was forced or test order placed.

RED evidence: three actual engine regressions, a stale signed read window,
freshness classification and a source-clock reservation bypass reproduced in a
credential-free VPS fixture. An initial source-clock fixture incorrectly edited
journal history; the store correctly refused it. Correcting the fixture to a
normal append then reproduced the actual stale-source bypass against 2a.
GREEN initial repair: 33 engine/reservation/recovery tests, strict source lineage
3/3, noEmit typecheck and all four GitHub CI families passed at 2e2743d2.
Owner-directed 120-second follow-up: 35/35 engine/reservation/recovery tests,
zero failures/skips, strict lineage 3/3 and noEmit typecheck passed. Includes
119.999s/120s acceptance, 120.001s/future/coerced clock rejection, 65s preparation
acceptance and 121s preparation rejection without a persisted intent. A genuine
in-lease cold scan triggers a new signed batch before entry; reusable flat
pre-lock decisions avoid a second cold scan. No stale source is merely redated.
Follow-up CI, immutable staging and formal new-SHA cutover remain required.

Private evidence:
`/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-common-concurrency-green/`
with ledger-freshness-red.log, ledger-freshness-window-red.log,
ledger-source-clock-red.log and ledger-freshness-green.log.

The separate current 2a refresh-only lease was genuinely renewed by Root SSH
inside its existing renewal window. This is neither a new-SHA certificate nor
new trading authority, and it does not deploy this source repair.

Actual failed intent timestamps confirm two INJUSDT SHORT REC_Y06_REV_D0_T72
candidates at 01:00/03:00 JST. At intent preparation the preceding account mark
was 52,322ms/47,624ms old; at fatal rejection it was about 68,230ms/63,475ms old.
Both intents are now terminal with no venueOrderId, legs CANCELLED, quantity and
reservation zero. Latest official signed maintenance proof remained flat with
no open orders. Do not describe this as absence of signals throughout the night.

Production 2a remains the old 30-second implementation until an actual certified
new-SHA cutover. Refresh-only renewal approvedAt 1793822489 / expiresAt
1793908889 (2026-11-06 05:01:29 JST), ordersEnabled=false; trading activation is
unchanged. New Root preparation must preserve the current inactive Kill and
active LIVE certificates. Do not run the old obsolete-HOLD recovery helper or
static producer against global evidence paths as a shortcut for a live upgrade.
