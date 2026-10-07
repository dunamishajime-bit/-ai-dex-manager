# PENGU M05 Shadow deployment

Authorized by user: deploy M05 observation only, never a Production gate. Source c97daf589d2c20ff6afee0f8ebe6319f59eecea4, runtime baseline 8ed7c2266af33758b0a0f301aefc2457a7a7eab6, preserve UI d4f526ed271cfa54c8516ce961ea3f855f463516. Runtime diff restricted to signal diagnostics, state history and selftests; config/sizing/order engines unchanged. UI excludes shadow gates from score, execution order and unmet Production requirements. Stage exact-SHA authorization; reuse audited rollback transaction; rebind unchanged Idle certificates; deploy all runners coherently; then deploy isolated UI and verify live telemetry, ranking animation and safety. Candidate history is recorded only for otherwise-valid SHORT candidates; zero records before the next candidate is expected.

Legacy Bitget frozen-ledger parity fails identically on baseline 8ed7c226 and candidate af1724f9: trade 9 entry actual 1761681600000 vs frozen 1761678000000. This predates M05. Deployment uses direct baseline-versus-candidate comparison of full features/eligibility and final signals on the same external 1-year market data, plus existing V20/V8/runner safety tests; no trading change to match the obsolete ledger.

## Final LIVE deployment evidence

Runtime and HP deployed SHA: `eabfeb1750666fac11f894a34cdcf68501ab923f`. Source shadow SHA: `c97daf589d2c20ff6afee0f8ebe6319f59eecea4`.

- Runtime workflow: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/37601368859 (SUCCESS).
- HP workflow: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/37602351639 (SUCCESS).
- All seven trading runners and both safety services active, zero restarts; exact runtime/operator/UI SHA agreement. Kill Switch off, Shared Risk not tripped, Margin Guard HEALTHY.
- Read-only account audit: zero positions, zero open orders, zero operator orders/cancels/position changes.
- M05 remains observation-only. No trading, sizing, score, ranking or execution gate changes. Current confirmed bar has no eligible SHORT candidate, so history is zero; future eligible candidates will append observations.
- UI: 89 tests passed; deployed-browser foreground ranking swap, stable/OFF/reduced-motion/reverse/cross22/filter/mobile regression passed. Score100 invariant and Q102 diagnostics verified.
- Direct comparison to current LIVE baseline: 9263 historical rows, 47 SHORT candidates, one hypothetical M05 block, identical Production decisions. Legacy frozen-ledger parity failure was reproduced on the unchanged baseline; Production rules were not altered to fit it.
- Sanitized machine-readable evidence: `pengu-m05-shadow-20261007-evidence.json`. Evidence commit is documentation-only; deployed SHA remains the one above.
