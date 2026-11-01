# V4 DOGE direct operator route — NEAR parity

## Purpose

Restore the DOGE missed-TIME recovery architecture to the same operational pattern
that previously succeeded for the exact NEAR one-shot exit.

The canonical route is:

owner approval -> exact preflight -> dedicated DOGE-only executor dry-run ->
dedicated DOGE-only executor apply by an authorized external operator ->
existing certified V4 one-shot hook -> durable exit reconciliation ->
signed venue flat proof -> resident STOP retirement -> postflight -> runner recovery.

The root-owned operator inbox/staging path introduced later is not the canonical
execution mechanism for this incident. It may remain as an audit artifact, but
production execution parity is defined by the dedicated one-shot executor pattern.

## Historical parity

NEAR used:
- lib/v12-v4-near-only-guard.mjs
- scripts/v12-v4-near-only-operator-exit.ts
- exact V4 SHA binding
- exact leg/qty/route/planned-exit validation
- signed venue readback under the account lease
- Shared Risk / Margin Guard / pending exposure checks
- dry-run without orders
- one-shot apply
- durable reconciliation
- signed flat proof before STOP retirement
- explicit post-exit verification

DOGE already has the equivalent pure guard:
- lib/v12-v4-doge-missed-time-guard.mjs

DOGE therefore requires the corresponding dedicated executor interface before the
historical route is complete.

## Required executor interface

Expected file:
`scripts/v12-v4-doge-only-operator-exit.ts`

It must be incident-specific and must not accept arbitrary symbol, side or quantity.

Exact immutable incident:
- V4 SHA: 53a0be396719f0284af4e11b35c66a4ac7d58f79
- leg: DOGEUSDT:REC_Y06_REV_D0_T72:SHORT:1793181600000
- symbol: DOGEUSDT
- side: SHORT
- qty: 226
- entry: 0.08052
- planned exit reason: TIME
- planned exit ts: 1793440800000
- model price: 0.07505
- resident STOP: v12-v4-98ded39746ed3502a4d7b0e26ef9

Dry-run must:
- verify exact release/SHA/ack binding;
- re-read durable state under the account lease;
- re-run Shared Risk / Margin Guard / pending exposure checks;
- perform multiple signed venue reads;
- prove exact DOGE short 226 and exact resident STOP;
- reject entries, unrelated cancels, different symbols, quantities or legs;
- send zero orders/cancels/position changes.

Apply, when performed by an authorized external operator, must use only the
existing certified V4 one-shot operator hook. It must not contain a second,
independent exchange-order implementation.

## Ambiguous-result rule

If the apply response is ambiguous, do not submit another reduction. Reconcile the
already-created durable EXIT intent and signed venue state first.

## Postflight

After an externally authorized apply, the read-only postflight must prove:
- durable leg CLOSED;
- durable qty 0;
- exactly one terminal EXIT intent for the DOGE leg;
- signed Aster DOGE net qty 0;
- resident STOP absent;
- no unrelated account mutation;
- exact V4 restart only after peer-runner recovery prerequisites are healthy.

## Current execution boundary

This document and the direct-readiness workflow below do not create or submit a
live DOGE order. They only restore the canonical NEAR-style route contract and
verify whether the exact dedicated executor exists and passes dry-run.
