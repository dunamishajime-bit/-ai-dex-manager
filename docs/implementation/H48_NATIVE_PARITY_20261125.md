# H48R4 WSIG native reconstruction — 2026-11-25

## Exact scope and source

- Research inputs on Owner PC (unmodified):
  - `C:\tmp\disdex-bt-20251001-20261001\hype_h48r4_market_regime_gate_pretarget_v1_20261113.py`
  - `C:\tmp\disdex-bt-20251001-20261001\hype_h48r4_pretarget_winner_signature_v1_20261114.py`
  - `DIRECTION_RESEARCH_20261109/hype_h48r4_pretarget_winner_signature_v1_20261114.json`
- Research selection JSON SHA256: `05632294b05a64c2fe28bbff63d191feed88d0e80e4eb3fd37e7f16bc67977a9`
- Immutable historical H48 certificate source: `4786f600ae7bf86ffca948f1412956a9113cb20d`, plan `8af6e4eb73e53f63f7f7d441f171176cc420090a8ab29faaacf4f01427a3822d`
- Research selection used PRE-only feature families; target and forward prices were **not** used to refit thresholds.
- Golden fixture: `tests/fixtures/hype-h48-r4-wsig-h1-golden-20261114.json` includes 27 genuine target and 2 forward entries, previous 25 closed HYPE/BTC H1 closes, and exact 48h exit opens and simple returns.

## Frozen entry and exit semantics

- Entry hours on UTC six-hour grid.
- Signal is evaluated strictly at the previous completed 1h bar: signalTs = entryTs - 1h.
- HYPE 12h return <= `0.004297852251518686`.
- HYPE 24h return >= `0.02047426596091347`.
- HYPE 24h return minus BTC 24h return <= `0.026202553353817715`.
- Requires 25 consecutive complete hourly closes for both pairs, the entry-hour opening price with a current observation no older than 120 seconds, no overlapping HYPE position, and exact source pin.
- Exit: 48h after logical entry, **at the verified next bar open**. Never substitute a pre-48h stop-based exit for H48 source parity. The separate risk governance/STOP policy must be assessed before any real trading.
- Implementation: `lib/hype-h48-research-entry.ts` and `lib/hype-h48-native-lifecycle.ts`.
- ENTRY and POSITION read-only attestations call an injected narrow authority matching the existing Root-certificate and account-lease authority interface; the production authority is defined in `lib/hype-stable4-time-only-authority.ts`. This code **does not** submit orders, cancel orders, or change positions.

## Independent verification

- Historical research golden fixture: 27 target + 2 forward H1 snapshots; all 29 entry features and 48h exit open / returns matched the frozen Python research.
- Local Node TS tests: 7/7 entry and parity, 4/4 authority-attestation lifecycle.
- Negative tests cover stale/missing/duplicate/future hourly data, non-6h entries, overlapping positions, wrong SHA, wrong route, unverified next-open exits, invalid quantity, and forged policy evidence.
- The original PRE-only frozen filter's **TARGET** 30bps trade win rate was `16/27 = 59.26%`; its **FORWARD** 30bps sample had only 2 trades, 50% wins and negative mean of about `-0.924%` per trade. This is **not sufficient** evidence for an 80% win-rate LIVE deployment.
- These tests prove parity **of selected entry/exit events**, not full capital-equity replay, venue execution, DD, fees/funding, STOP or entire integrated STABLE4 behavior.

## Remaining production blockers

1. The active HYPE daemon is SHA 4786 in **SHADOW** (verified on VPS), not a signed LIVE H48 executor.
2. Current TREND runner remains a different strategy with STOP/TP exits. It does **not** call the H48 native ENTRY/POSITION authority; the PR #666 preapproval check must continue to reject it.
3. Root-owned LIVE activation, account ownership and writer exclusivity, signed ASTER GET, margin/risk freshness, exact gross and STOP parity, durable H48 pending/fill state and recovery remain unproven.
4. Old e0e4 order permit, legacy overlays, and canonical GLOBAL HOLD need an explicit formal revocation/provenance procedure. Do not delete, clear, or rewrite them by hand. Related HOLD receipt provenance correction: PR #667.
5. New native source bytes change the release SHA. An immutable new release, fresh source/plan-bound formal certificate and **new Owner-signed order-enable approval** will be required; never rebind the already redeemed SHA 4786 token by editing a hash.
6. No new order permit, LIVE switch, deployment, cancellation, or position modification occurred during this repair.

**Deployment decision: HOLD_PROTECTED / SHADOW until every blocker is resolved.**
