# Cooldown and HP corrections, 2026-10-06

Authorized scope: prevent condition-unmet candidates from consuming cooldown across strategies; repair HP and HYPE faded text.

Idle SHORT now evaluates the dedicated route before cooldown, and records the per-symbol 12h cooldown only after FILLED/PARTIALLY_FILLED entry exposure. Rejected, canceled, expired, unknown/no-exposure orders and baseline/risk/capacity gates never consume it. Pending order reconciliation and account locks continue to protect idempotency. Protection failure after an actual fill keeps cooldown.

V12 cooldown writes follow confirmed exits (including protective fills and priority handoff); same-direction loss governor follows completed losses. PENGU cooldown follows reduce-only completed exits; route quarantine follows closed trades. FET cooldown follows recorded exits. Q102/V52/HYPE have no generic-candidate-to-cooldown mutation. Their signal, duplicate, setup, position and risk gates are retained.

Historical Idle candidate certificate (495/63/61 and original performance figures) remains historical evidence only. This user-authorized LIVE filled-entry cooldown overlay does not claim the same candidate stream, trade count, win rate, DD or profit. Existing saved legacy candidate timestamps require migration with fill evidence; uncertain exposure must be held for review.

HYPE ranking uses current H1 decision time, matching SHA and LIVE heartbeat, not the retired 15m DATA_FRESHNESS key. Missing/future/stale decisions remain unconfirmed. Unknown rows retain normal text contrast; explicit state labels communicate missing evidence. HYPE overview labels now describe H1 rather than retired EMA20/1m logic.

Regression evidence: Idle route/direction rejection, no-exposure order outcomes, FILLED/PARTIALLY_FILLED cooldown, independent symbols, exact 12h boundary; HYPE current H1 vs stale/missing/future/mismatched SHA.
