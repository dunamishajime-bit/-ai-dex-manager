# Pending reconciliation through the authorized Codex SSH route

This scope updates only the registry's `updatedAt` after fresh signed read-only
account reconciliation. It does not clear Kill Switch, issue an operator trading
activation, place orders, release reservations, or change any registry entry.

## Execution contract

The owner-authorized root SSH session invokes the immutable release-local
`scripts/ops/deploy/disdex_pending_refresh.py`. The existing installed root gate
authenticates `CODEX_SSH`. `--verify-only` validates the executor and release
without querying the venue or writing the registry. `--apply-refresh` creates a
60-second grant for one exact SHA, prior registry hash, random nonce, and root
parent PID. The grant is a truthful root-SSH authorization, not an owner signature.

The root executor starts exactly one Node process directly with the release-local
tsx import loader, drops all supplementary groups and runs as deploy. Credentials
come from the existing root-managed environment and are not command arguments.
The child requires a root-owned grant in a root-controlled `/run` directory and
checks its own parent PID. Separate invocations cannot reuse the grant. The root
executor removes it on every ordinary exit and leaves a root-only prepared audit
record. Even after a parent crash, a future child cannot reuse the old parent PID
and short lease without also matching the exact registry hash and SHA.

Inside the existing account lock, the child binds the current file hash, performs
sequential signed GETs of positions, open orders and balances through the global
budget, rejects any non-flat exposure or active reservation, renews the lock,
checks the hash again and revalidates grant expiry before writing. It preserves
all fields other than `updatedAt`, owner and mode; it fsyncs the file and directory.
Root verifies the actual post-write bytes and writes a receipt. An intervening
reservation after account-lock release fails receipt verification. It never
restores an old registry over a newer reservation.

## Rollout checklist

- [x] Add failing tests for grants, invalid scope/SHA/hash/PID and expiration.
- [x] Implement the restricted validator, child binding and root executor.
- [x] Preserve the existing no-grant rejection and flat-account checks.
- [x] Run local pending tests and the full staged-preview verification/typecheck.
- [ ] Confirm GitHub CI for the exact new candidate SHA.
- [ ] Stage and verify an immutable release and dependencies.
- [ ] Run root-SSH executor `--verify-only` on the VPS.
- [ ] Execute one authorized refresh after checking the current shared cooldown.
- [ ] Verify entries unchanged, pending exposure zero and actual receipt.

The final four unchecked steps are runtime certification, not implied by a source
test. Completion of this scope alone never authorizes trading or Kill removal.
