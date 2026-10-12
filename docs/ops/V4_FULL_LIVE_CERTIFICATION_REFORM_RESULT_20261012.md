# V12 V4 — revised full-LIVE authorization conditions and actual evidence (2026-10-12)

## Outcome: certification design revised, evidence proof PASS, new code not activated

**Code-only release candidate SHA:** `3639ba7d52430a87f683579d1107c1cd2db3eb19`, GitHub branch `fix/v4-full-live-certified-peer-attestation-20261012`.

The prior full-LIVE v2 certification required authentic V4-specific partial fills, same-symbol STOP/exit races, restart recovery and direct LIVE fills **before** permitting the first V4 LIVE fill. This made the activation proof circular. The revised code adds separate **v3 established Aster execution** certification; v2 stays available for exhaustive independent certification.

### Existing evidence now accepted by v3 (no invented V4 trades)

1. **41 frozen route catalog** and existing historical market/route parity reports, preserving their retrospective—not prospective—scope.
2. **Previously authenticated Aster real-money Production order/STOP history**: 273 historical order records, 128 STOP and 200 reduceOnly (counts can overlap), 0 V4-tagged orders; original signed read-only archive SHA256 `cea9c612b85e0349f708601081ed1448d641777054d8004faea10c6b71570c5f`.
3. **Fresh signed Aster account and resident STOP GET-only readback**: one FETUSDT LONG 298 position, one reduceOnly SELL STOP_MARKET 298, no additional open orders; no order/position/cancel mutations.
4. **Full V4 safety regression**: 46 V4-related test files / **151 PASS / 0 FAIL** plus TypeScript typecheck PASS, including partial fills, journal, resident STOP and shared risk/peer ownership behavior tested offline. Do NOT label unit/fault-injection tests actual V4 broker execution.
5. **Current peer/risk state**: real active independent PENGU/Q102/V52/FET/HYPE/Idle/shared risk/Margin Guard systemd identity, daily risk not tripped, Margin Guard HEALTHY, Kill Switch false, pending exposure 0.

All five evidence files were archived as root:deploy 0640 under root-owned `/etc/disdex/v12-v4-evidence/`, with SHA256-checked contents. The new v3 contract *re-hashes actual root-owned files at runtime* instead of merely checking for 64-character hex strings:

| Exact evidence filename | SHA256 |
|---|---|
| route-source-parity.json | `3943707b298fc8d7737dff09ebaa857488f62157028bc47e20cc6b4ddd2a8ce4` |
| established-aster-orders.json | `cea9c612b85e0349f708601081ed1448d641777054d8004faea10c6b71570c5f` |
| signed-aster-account.json | `db6be18ffa4960b05864474de90876909bd93743d70ef873c2688ad0378ced8b` |
| v4-execution-tests.json | `99378028f56187a0d0b83e757ba9a853e13e7fd7bfc2a4f51e37a5c0e16639fc` |
| shared-risk-and-peers.json | `564bab246ab4a9cc843263916e123b859bbf7caeb69fb913bc3b5b6a390f0ca2` |

The new exact-SHA **v3 proof contract was executed on VPS against the actual root-owned evidence**: `SHARED_EXECUTION_V3_EVIDENCE_CONTRACT_PASS_IN_MEMORY_ONLY`, 41 routes and 5 files verified. No certificate was issued, no production switch, no order or cancel.

### Important distinction: retain runtime financial safety

A valid v3 root certificate still requires:
- **exact release SHA** (not a different commit), 41 route identities and finite approval expiry;
- actual **root-secured evidence files**, valid SHA256 and operator authorization;
- truthful explicit acknowledgement that V4 has not yet produced a live fill and that its historic independent forward performance was weak (V2 PF~0.57, Y06 PF~0.30);
- original strategy Gross policy (V12 3, crypto 3.5, total 4.75, recovery 2.5) as an upper policy; actual account/venue margin and shared risk can be lower;
- every live decision passing completed-candle causal integrity checks, latest signed exchange account/STOP reconciliation, pending reservations and exact active per-peer SHA/PID/freshness; unprotected or unowned positions, unknown order result and Kill Switch/Margin Guard fail closed;
- separately authorized actual LIVE service activation and safe transition/rollback. The new v3 approval contract does *not* turn research tests into real fill history or delete protective STOP checks.

### Engineering status on VPS

- Code candidate: `3639ba7d52430a87f683579d1107c1cd2db3eb19` staged **without activation** at `/home/deploy/disdex-trading/stage/candidates/3639ba7d52430a87f683579d1107c1cd2db3eb19`. Stage TypeScript and 41-route SELF_TEST PASS.
- Actual V4 Canary: `e8bdd2f522612179b148147d4f76951b2e30f9d7`, PID 838362 NRestarts 0 as last verified; old V12 and Canary remain inactive. Existing Production main `current` still `ce1edeead8d0f9e5d88e829d415057117502a335`.
- **Full LIVE v3 certificate is NOT installed** (`/etc/disdex/v12-v4-production-certification.json` missing), production service not activated.
- A separate operational configuration mismatch remains: the unactivated `disdex-v12-v4@.service` depends on nonexistent `shared risk@new SHA`, `Margin Guard@new SHA`, and requires two currently missing full-production env files. Do **not** start that existing unsafe unit unchanged. Revise it to use existing active shared risk and margin guards and existing validated environment, without starting duplicate shared services.
- Watchdog currently attests the active exact-SHA **Canary**. It needs a certified-V4 service attestation before a switch; don't silently disable the old V12 no-resurrection check.
- The existing one-entry Canary's exact-SHA approval remains unchanged, max 25 USDT until 2026-10-13 00:49 JST; no auto-extension.

**User requested simplifying unnecessarily strict conditions. This was implemented and its evidence tested. The work is NOT a completed full LIVE cutover.** Do not claim full deployment until startup policy, root certificate, exact ownership and signed post-cutover state are independently verified.

## 2026-10-12 subsequent operational configuration correction

The previously inactive V4 full-production systemd template `/etc/systemd/system/disdex-v12-v4@.service` was backed up and corrected. New `/etc/disdex/disdex-v12-v4.env` was copied from the *working* Canary environment, only changing `V12_V4_OPERATION_MODE=CANARY` to `CERTIFIED`. The service no longer mistakenly `Wants=` a second `shared-risk@newSHA` or `MarginGuard@newSHA` nor requires nonexistent `current-runtime/%i.env`. It now references the separate root operator authorization path `/var/lib/disdex/shared/operator-activation/v12-v4-full.json`, leaving the current Canary gate untouched.

A first `systemd-analyze verify` attempt on the raw template failed because it expanded `%i` to literal `i`, not a real release SHA; the script **restored its backup**. The exact-release `3639ba7d52430a87f683579d1107c1cd2db3eb19` artifact was subsequently placed immutably (and **not started**) at `/home/deploy/disdex-trading/releases/3639ba7d52430a87f683579d1107c1cd2db3eb19`. Its 41-route self-test passed. Then the guarded full-unit configuration edit was repeated and `systemd-analyze verify disdex-v12-v4@3639ba7d52430a87f683579d1107c1cd2db3eb19.service` passed.

The new full service remains `inactive, MainPID=0, disabled`; current V4 Canary remained active PID838362/NRestarts0 at final unit check, and Production current symlink unchanged. Independent signed Aster GET-only account readback *after unit changes* reconfirmed FET LONG 298 and its reduceOnly SELL STOP_MARKET 298, no other orders/positions, and zero venue mutations.

**Remaining operational activation, not missing V4-before-V4 historical data:** root-sign/install an exact-SHA v3 production certificate using five sealed root-owned files; install separate root V12_V4 full activation approval, adapt strict watchdog to attest the actual full V4 service after cutover, stop the existing Canary exactly once, reconcile the observation-only journal to new SHA, then start the full unit only after the full signed account, shared Gross/Margin and one-writer preflight and postdeployment readback. The user approved pursuing full LIVE, but these steps have **not** yet been executed; no automatic or unsupervised activation is implied.
