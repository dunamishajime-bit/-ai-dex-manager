# ChatGPT Work Handoff — V12 Dynamic Residual LIVE

Use the exact implementation/LIVE contract in:

- `docs/implementation/V12_DYNAMIC_RESIDUAL_LIVE_CONTRACT_20260919.md`
- `docs/implementation/v12-dynamic-residual-live-contract-20260919.json`

and the validated research evidence in commit:

`27f934424b201e4c63986b9b7db64b89ff69b4bb`

Your job begins from the **current Production source/runtime**, not from the research branch.

Complete the remaining work end-to-end:

1. Resolve the current Production SHA and VPS runtime truth.
2. Create a clean implementation branch from that exact Production source.
3. Implement only the required Production differences from the contract.
4. Add/adjust tests, migration, persistence, protection, reconciliation, concurrency and observability.
5. Re-run the formal NORMAL/SEVERE acceptance replay and all relevant regressions.
6. Commit and Push the exact tested implementation SHA.
7. Deploy that exact SHA as a new immutable VPS release with rollback preserved.
8. Run migration, reconciliation, Aster read-only checks and full preflight.
9. Activate LIVE only if every contract gate passes.
10. Verify unified runtime SHA, services, protection, Shared Risk, Margin Guard, Kill Switch, watchdog, history sync and HP/mobile observability.
11. End only with either:
   - `STATUS: V12_DYNAMIC_RESIDUAL_LIVE_FULLY_VERIFIED`, or
   - `STATUS: LIVE_ACTIVATION_BLOCKED` with Fail Closed preserved and exact blockers reported.

Do not stop at code implementation, tests, Push or deployment if the next gate is safe to execute.

Do not weaken Fail Closed, fabricate missing state, clear Kill Switch merely to force activation, run old/new strategy runtimes simultaneously, or submit a synthetic LIVE market order just for verification.
