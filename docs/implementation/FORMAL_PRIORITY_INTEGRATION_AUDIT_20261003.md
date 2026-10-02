# Formal priority integration audit — 2026-10-03

Source handoff: `c7280876ecc3037cf9446e5e58a094e889a96d28`.
Observed Production: `53eeff5417636369d4709fddfd47d7916ddcf3b1`.
Observed UI: `207e0448d1c4243f7dc48a30c6479bac5e09fb77`.

## Source verification

- Canonical trades: 1,275 lines, 1,423,379 bytes, SHA256 `3433c0b033bb048b1aca22b21d97ff253bbb160edb47d00eb7a8fac6a1ac9915`.
- Candidate decisions: 2,588 lines, 2,148,750 bytes, SHA256 `48b68012f7e9dea1fc83b98119b7318e48193abe57ca9c27efb6062ea3b76b53`.
- Manifest COMPLETE; formal summary contains V12/PENGU/Q102/FET/V52 only.
- Handoff CI runs 37070647022, 37070647062, 37070647013 completed success; these are source CI, not verification of the subsequent integration commit.

## Execution-boundary defects reproduced and repaired

1. Handoff executor could close multiple V12 victims using pre-exit equity. It now returns after one verified whole-position exit; Q102 refreshes account, positions and quote and replans before another victim.
2. Venue quantity/side was not checked against durable V12 ownership immediately before the handoff. Mismatch now blocks before an order.
3. V12 runtime SHA/local Kill Switch now gate the handoff; Q102 supplies its exact expected runtime SHA.
4. Missing/non-finite/future exit timestamps now block before canceling protection or clearing pending, including resident fill and pending reconciliation paths.
5. Flat venue alone no longer certifies a canceled/partial exit. A verified full fill is required.
6. Handoff reason, victim rank, realized freed Gross and actual fill timestamp are persisted for read-only HP/history attribution. Normal/residual exits propagate their reason to the adapter.

RED evidence: handoff tests 4 failed / 5 passed; timestamp tests 5 failed / 1 passed; canceled/partial completion tests 2 failed / 6 passed. After fixes, the two new suites pass 17/17. V12 full selftest, Q102 runner selftest and V12/PENGU TypeScript checks pass with zero real exchange calls/orders.

## Deployment prerequisite not established

Existing Production retains Idle SHORT and DOGE/AVAX residual Overlay. Their root-owned exact-SHA certificates certify older integrated contracts:

- Idle SHORT v3: baseline 1,284, integrated 1,339, final JPY214,775,230.26444945.
- Residual Overlay v1: integrated 1,390, Idle61/DOGE11/AVAX16, final JPY1,319,918,378.8124561, contract SHA256 `b1f31c152d831131320e8e0159593a34b4679af7609715a0dd6efcd51b9de616`.
- Both certificate runtime SHAs and the operator artifact approve `53eeff...`.
- The new 1,275-trade formal artifact does **not** contain either Idle sleeve and does not establish combined parity after changing V12 sizing/priority/cooldown.

Do not rewrite the old certificates' runtime SHA and call that validation of the changed combined strategy. Do not disable/remove the retained Overlay merely to obtain activation. Keep its historical artifact unchanged and separate from the new five-logic formal reference. Resolve this prerequisite with a genuinely applicable canonical combined certificate or an explicit scope decision before switching current/creating operator approval/starting new trading units.

Preflight authenticated account diagnostic: balance USD65.77132849, available USD65.76014528, positions=[], openOrders=[], orders/cancels/positionChanges=0. These are timestamped observations, not authorization to omit the final preflight. Shared Risk maximumLossPct7.5/sourceComplete=true/tripped=false, Margin Guard HEALTHY/ordersAllowed=true, Shared Kill Switch=false. No VPS trading/runtime/state/operator mutations were performed during this audit.
