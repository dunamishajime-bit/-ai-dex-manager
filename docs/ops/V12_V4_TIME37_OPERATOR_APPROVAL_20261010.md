# TIME37 explicit operator approval and technical certification boundary

## Operator authorization

On 2026-10-10 the operator explicitly approved the TIME37 emergency protection
policy for `V2_M150_D05_CORE_NATIVE` (41 routes), against source commit
`cb945768dc2903b4c4c7373a5e8688fde2fe0031`:

- LONG: actual average entry fill price times 0.92.
- SHORT: actual average entry fill price times 1.08.
- Normal TIME exit remains unchanged; maximum tolerated drawdown is 21%.
- This is policy adoption approval, **not final Production activation approval**.

The approval is a record of the explicit operator message, not a cryptographic
operator signature or an independent exchange execution certificate.

## VPS artifact read-back

Created exclusively and atomically at
`/etc/disdex/v12-v4-time-stop-approval.json`, without overwriting any existing
approval. Owner/group `root:deploy`, mode `0640`, regular non-symlink file.

SHA256: `d74685b577694c930f1ed571a6dab1bd81d7d82eee4f4a9d1d624b03d3153903`.

The exact source commit's bundled validator successfully read the artifact as
the `deploy` service user. The approved SHA remains the commit above; subsequent
code commits are not implicitly approved by changing this field.

The Production current symlink and real-money operator activation artifact
hash were checked before and after the write and remained unchanged.
Production remains `ce1edeead8d0f9e5d88e829d415057117502a335`.
No LIVE certificate was created and no runner was restarted.
This operation made zero order, cancellation or position mutation calls.

## Additional defect addressed

Restart resident-STOP validation previously checked identity and remaining
quantity but not the trigger price. The regression first failed with
`Missing expected exception` for an altered trigger. Validation now compares
the venue trigger with the normalized price in the durable submission command;
missing, invalid or mismatched evidence fails closed. It does not recompute or
change the adopted STOP percentage, size or normal exit rule.

## Unresolved technical certification (no Production cutover)

- No dedicated Testnet credentials/configuration were found in the VPS env
  inventory. Production keys were not reused on another environment.
- Existing authenticated Production read-back proves a resident reduce-only
  STOP can exist, but is not independent evidence for partial STOP fills,
  cancellation/re-protection, competing EXITs or V4 restart execution.
- The normal EXIT path currently sends the EXIT before retiring its STOP.
  Its post-fill reconciliation detects inconsistencies, but does not establish
  that a concurrent STOP cannot consume another same-symbol virtual leg.
- ENTRY fills are protected after reconciliation. A crash between first fill
  and STOP creation, or a later cumulative ENTRY partial fill increasing
  quantity, still needs a certified restart/re-protection protocol. Refusing
  to continue on missing/mismatched protection is not proof of recovery.

These cases require independently observed exchange lifecycle records and a
tested reconciliation protocol, not a payload declaring the certificate PASS.
Existing mock/unit tests are explicitly not independent exchange certification.

## Work ledger

- [x] Preserve existing Production and final activation artifact.
- [x] Record explicit TIME37 policy approval at the approved source SHA.
- [x] Read back root-owned artifact using the actual validator as deploy.
- [x] Add RED/GREEN trigger-price regression.
- [x] Run all V4 tests: 120/120 PASS, no skipped/cancelled tests.
- [x] TypeScript `tsc --noEmit`: exit 0.
- [ ] Publish this minimal safety change; verify CI.
- [ ] Obtain dedicated Testnet execution evidence or equivalent existing signed
  lifecycle records for the unresolved cases above.
- [ ] Complete all-runner integrated safety certification.
- [ ] Present final SHA-bound evidence and risks for final LIVE approval.

No research backtest was rerun or modified.
