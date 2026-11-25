# H48 emergency -8% stop + STABLE4 DD30 — Owner review candidate
_Date: 2026-11-25 · State: DRAFT_NOT_AUTHORIZED · Trading mutations: 0_

This document is **NOT** a deployment approval, an order permit, a Root
certificate, a trading signal, or permission to clear GLOBAL HOLD.

## Formal conflicts verified on the real VPS

1. Running HYPE SHA is `4786f600ae7bf86ffca948f1412956a9113cb20d`,
   currently SHADOW, live execution false. Historical Root H48 certificate
   exists but the corresponding current-source HYPE order permit is absent.
   A new source SHA will NOT inherit the old certificate or Owner token.
2. Existing H48 certificate explicitly specifies
   `residentStopRequired:false`, `residentTakeProfitRequired:false`, exact
   48-hour next-open exit. Owner's more recent protective intent maintains
   a hard -8% emergency STOP, regular -5% exit under other conditions.
   These are *different strategies*. This research does not silently alter
   H48_TIME_ONLY approval.
3. Current canonical HOLD remains GLOBAL/HOLD_PROTECTED. Six other
   scope-specific permits are absent in their actual nested Root paths
   (`/etc/disdex/runner-order-enable/<RUNNER>/<SHA>.order-enable.json`);
   a separate HYPE permit also is absent. A LIVE order cannot be inferred
   from a running systemd service or an approved certificate alone.
4. Current effective Gross Crypto3.0/Stock4.0/Total4.25/HYPE1.5 differs
   from the old signed all-runner plan Crypto3.0/Stock1.5/Total3.5/HYPE1.0.
   Read-only original-release preflight reports
   `STABLE4_DD30_GROSS_LINEAGE_MISMATCH`.
   Candidate plan in
   `docs/production/stable4-dd30-live-plan-candidate-20261125.json`
   is explicitly `DRAFT_NOT_AUTHORIZED`.

## Historical H48 STOP8 exit research (no venue order sent)

Reproducible source:
`tests/fixtures/hype-h48-emergency-stop-h1-20261125.json`;
`lib/hype-h48-emergency-stop-research.ts`;
`tests/hype-h48-emergency-stop-research.test.ts`.

Source SHA256:
`05632294b05a64c2fe28bbff63d191feed88d0e80e4eb3fd37e7f16bc67977a9`.
HYPE/USDT ASTER H1 bars; initial entry is an H1 opening price, 48
consecutive hours of OPEN/LOW are inspected, time exit uses exact next H1
OPEN, costs deducted at a simplified 30bps round-trip, *no* other trade
execution, funding, portfolio GROSS or liquidation path modeled.

| Split | Policy | Trades | Wins | Stops triggered | Close-to-close Max DD |
|---|---|---:|---:|---:|---:|
| TARGET | original H48_TIME_ONLY | 27 | 16 (59.3%) | 0 | 15.29% |
| TARGET | H48 + -5% stop | 27 | 15 (55.6%) | 8 | 14.05% |
| TARGET | H48 + -8% stop | 27 | 16 (59.3%) | 2 | 15.11% |
| FORWARD | original H48_TIME_ONLY | 2 | 1 (50%) | 0 | 3.86% |
| FORWARD | H48 + -5% stop | 2 | 1 (50%) | 1 | 5.30% |
| FORWARD | H48 + -8% stop | 2 | 1 (50%) | 0 | 3.86% |

All 29 existing 48h entry/exit prices matched frozen research.
No missing bars in those selected trades. If a bar OPEN gaps below
the -8% trigger, the model fills at the lower OPEN, *not* the stop price.
The gap test demonstrates a -10.3% net loss including 30bps; -8% is
a threshold, **not a guarantee of a maximum -8% realized loss**.

This is NOT whole-account cumulative/max-intratrade DD, independent
walk-forward validation of STOP8, a reliable 80% win-rate strategy, or
proof that H48+STOP8 is formally safe. Forward has only TWO trades.

## Requirements before creating a new production order plan

- Independent Owner decision on the actual Gross upper limits and on
  H48+STOP8 vs original H48_TIME_ONLY. Do not treat old approval as a
  signature over a new release or risk increase.
- If STOP8 selected, develop a new formally signed contract and Root gate
  with emergency-only `STOP_MARKET` reduce-only protection and precise
  removal/ownership/readback rules. Existing ASTER client has the
  `placeStopMarketOrder` API, but the current H48 journal/authority does
  **not** manage a resident stop. NO LIVE while that gap persists.
- Demonstrate STOP installation immediately after confirmed entry and
  failure handling without duplicate/unmanaged orders; pending-exposure
  reservation remains after UNKNOWN. Monitor signed ASTER GET and STOP
  lineages before and after every protected state transition.
- Reproduce exact H48R4 entry candidate parity (84 base, 62 non-overlap,
  27 frozen WSIG target), with 10/30bps, market regime, synthetic gaps,
  venue exchange filters, funding and cumulative account DD.
- Create immutable final source release and Root-signed H48 certificate
  with exact source + final Owner-approved plan SHA; obtain a fresh,
  scope-specific Owner token and signed order permit for **each** Runner,
  including all six non-HYPE scopes, using the existing short-lived
  GitHub/HP approval flow.
- Re-run shared risk, Margin Guard, Gross, pending registry, account
  single-writer, Root activation, signed ASTER venue GET x3 and STOP
  protections. Only a formally authorized HOLD release may let LIVE
  orders pass. No test orders.

**Decision: HOLD_PROTECTED / HYPE SHADOW until every above gate passes.**
