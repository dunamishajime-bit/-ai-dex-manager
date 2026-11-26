# Codex formal cutover handoff — STABLE4 DD30 + H48 STOP8
Date: 2026-11-26 JST
State: **SOURCE CANDIDATE — NOT OWNER-SIGNED FOR LIVE**
PR: https://github.com/dunamishajime-bit/-ai-dex-manager/pull/668
Branch: `fix/h48-native-lifecycle-20261125`

## Owner-approved policy facts (do not re-request the same Gross cap decision)

The Owner approved the **strict aggregate upper bounds**, not new profit-tier expansions:

| Gross | Explicit approved limit |
|---|---:|
| Crypto | 3.0× |
| Stock | 4.0× |
| Total | 4.25× |
| HYPE | 1.5× |

This is chat policy consent, **NOT** a cryptographically signed HP deployment approval, Root certificate, source-bound permit or authorization to clear GLOBAL HOLD. The old STABLE4 plan had Stock 1.5×, Total 3.5×, HYPE 1.0×. **Critical immutable-source integrity:** The old signed `config/integratedProductionRiskPolicy.ts` and `lib/disdex-integrated-gross-governor.ts` remain EXACTLY as `master` because editing them failed `STABLE4_DD30_INTEGRATED_SOURCE_BLOCKED:INTEGRATED_SOURCE_SHA_MISMATCH`. The new absolute-cap contract is **separately staged**, not deployed, in `lib/stable4-dd30-owner-hard-gross-candidate.ts` and `tests/stable4-dd30-owner-hard-gross-candidate.test.ts`. The old signed runtime governor can still escalate to Crypto 5.0× / Total 8.0× with profit/DD. **Codex MUST incorporate 3.0× / 4.25× HARD caps in a NEW immutable signed release, with new source fingerprints and formal Owner/Root source authorization. Never replace the pinned SHA hash in old release just to pass CI.**

The HYPE candidate policy is `H48_R4_RESIDENT_STOP8`. It preserves the frozen H48R4 6-hour entry grid / 48-hour next-open exit and additionally requires a resident ASTER reduce-only SELL `STOP_MARKET` at an -8% trigger. This is **not** the previous signed `H48_TIME_ONLY` / `residentStopRequired:false` contract, nor proof the loss is capped at 8% when the market gaps. The 2025-10-01 to 2026-10-01 TARGET sample had only 27 entries, and independent FORWARD had 2; source-equivalent, but insufficient for broad profitability or whole-account DD guarantees.

## Source code staged before switch

- Native deterministic H48 84 base → 62 base-nonoverlap → 27 WSIG target candidate research and 48h next-open: `lib/hype-h48-research-sequence.ts`, `lib/hype-h48-native-monitor.ts`.
- Durable entry/exit intent and signed ASTER GET reconciliation, state-transition lock and restart: `lib/hype-h48-execution-journal.ts`, `lib/hype-h48-journal-store.ts`, `lib/hype-h48-restart-admission.ts`.
- STOP8 protective order: `lib/hype-h48-resident-stop8.ts`, `lib/hype-h48-stop8-journal-store.ts`, `lib/hype-h48-stop8-native-handoff.ts`.
- **Protected restart** requires an exact signed resident STOP8 plus owned live position; otherwise protected HOLD: `lib/hype-h48-protected-restart.ts`.
- Root/Owner Ed25519 **read-only verifier** for the NEW STOP8 bundle + pinned source/plan, certificate SHA, Root file metadata and short-lived position evidence: `lib/hype-h48-stop8-root-authority.ts`, `lib/hype-h48-stop8-policy-intent.ts`. This code **does not issue or sign anything**.
- Post-confirmed-flat owned STOP8 cancellation using durable CANCEL_SUBMITTED state and signed GET with no retry on UNKNOWN: `lib/hype-h48-stop8-retirement.ts`, `lib/hype-h48-stop8-retirement-store.ts`.
- Exact new STOP8-certified ENTRY and 48h EXIT intent proof: `lib/hype-h48-stop8-policy-intent.ts`.
- Root/Owner Ed25519 signature verification and 2-minute scoped per-position evidence: `lib/hype-h48-stop8-root-authority.ts`. It never signs or mutates.
- Pure non-authorizing future-release hard-cap calculator: `lib/stable4-dd30-owner-hard-gross-candidate.ts`.
- Real signed-venue/pending UNKNOWN/DD30/Shared Risk/Margin Guard/Kill source precheck: `lib/hype-h48-allrunner-risk-precheck.ts`. This returns `tradingAuthorization:false` even when all evidence passes; native Runner must integrate it with the signed Root permit, not use it as a direct order gate.
- Correctly separate Root-authorized protected reduce-only exit from new-entry permission, while requiring signed STOP8 to complete a new BUY: `lib/hype-h48-native-order-executor.ts`.
- Cross-runner Root safety audit, Gross/STOP mismatch detection, canonical Kill Switch path validation: `lib/hype-h48-production-gates.ts`, `lib/hype-h48-kill-switch-consistency.ts`.
- Independent source-only CI without production credentials: `.github/workflows/disdex-h48-offline-native-safety.yml`. Protected original order-enable workflow intentionally retains its existing strict authorization.

## Known formal LIVE blockers (Codex MUST NOT ignore)

1. No new immutable, source-pinned release has been built and activated from this PR. The current VPS `current` symlink previously pointed to historic release `7688ed7c...`; 7 systemd runners were pinned to `4786f600ae7bf86ffca948f1412956a9113cb20d` and SHADOW/HOLD.
2. The currently issued H48 certificate is the **old no-resident-STOP** policy and is source-bound to SHA `4786f600...`. It cannot certify H48 STOP8, and NO compliant new STOP8 certificate exists.
3. `FileH48Stop8RootAuthority` is a strict **verifier only**. A separately reviewed formal Root STOP8 issuer and canonical Root bundle/receipt generation must be implemented, source-pinned, and connected to actual HP Owner signed approval. Do not copy/forge old approval IDs or reuse a previously redeemed token. The new bundle contract is documented by its `H48Stop8RootBundle` type; Root ownership and the Ed25519 Owner signature are independently checked.
4. The new H48 research/intent/STOP8 modules are NOT yet wired to a production systemd service. The current `disdex-hype-long` TREND/ATR runner must NOT be repurposed as if it were H48. Implement a separate native H48 adapter/service with H1 data, 6h entry grid, 48h next open, persistent state, Root grant verifier, ASTER single-writer lease, risk preflight, signed readbacks and protected recovery.
5. Stop cancellation must be integrated after **signed full flat**, not before; Root Owner-approved STOP8 retirement code is staged with a durable cancellation journal but needs runner lifecycle wiring. Do not cancel a protective STOP while its long position exists.
6. The full all-runner shared DD30/Shared Risk 7.5%/MarginGuard/current Gross/pending exposure/order owner checks must be part of the actual live decision, not an injected no-op callback. Source-only `auditH48LiveReadiness` always returns BLOCKED: it is a **diagnostic**, not a permit.
7. Root-scoped order permits are absent for all six non-HYPE runners and HYPE STOP8. Current GLOBAL HOLD is `HOLD_PROTECTED / GLOBAL` and must remain until the exact new certificates/permits, signed ASTER GET checks, and approved HOLD-transition transaction pass.
8. The old `.github/workflows/disdex-stable4-h48-order-enable.yml` formal job is pinned to **old TIME_ONLY** plan hash and old source. The existing all-runner execute job is deliberately fail-closed without complete signed Root approval. **Do not run these as a shortcut**. Review/replace through normal authorized GitHub workflow and HP Owner environment approval.
9. An earlier attempt to modify the protected order-enable workflow was rejected by safety controls. Do not bypass access/security enforcement; request the proper repository policy/owner review rather than weakening checks.
10. The exact old 4786 certificate and any legacy permit must be retired only as part of an auditable, rollback-safe Root transaction after the new signed plan is ready. Never remove a protected STOP or widen risk caps by unreviewed manual edits.

## Formal cutover sequence — for Codex after source/CI is independently reviewed

1. Finish and review the **actual H48 native systemd runtime adapter and Root issuer**, including 48h exit/STOP retirement, account lease renewal and signed ASTER position/order GET tests. Ensure full project `tsc --noEmit`, all H48 offline and existing integrated tests PASS; test missing/partial/unknown POST, restart, STOP gap, stale H1/price, wrong signer/source/plan, all-runner gross and DD.
2. Resolve independent/whole-account STABLE4 historical and synthetic BT (2025-10-01 to 2026-10-01, 10bps/30bps, 1万円 initial, signed actual trade candidates). Distinguish TARGET 27 / FORWARD 2 from full account outcomes; report cumulative peak-to-trough DD and order suppression under DD30. Do not assert passing absent measured evidence.
3. Merge reviewed code; compute immutable **new source SHA** and exact final **new policy plan SHA256**. Re-run source fingerprints, Root owner path metadata and validation; pin the final release. No SHA-mismatch bypass, symlink update before formal preflight, or manual permit creation.
4. Use official HP Owner request for the exact new SHA/STOP8 policy + all-runner Gross. Login preference: `他の認証方法 → メール認証`. The Owner performs actual email/2FA approval; neither Codex nor ChatGPT may synthesize an OTP/approval or sign on Owner's behalf.
5. After the actual signed HP approval is redeemed by the correct GitHub Environment run, Root issues a new immutable STOP8 certificate + owner receipt and the 7 Runner scoped order permits. Verify Ed25519 key, Owner nonce/ID/redeemed run, canonical plan, cert age/Root ownership, STOP8 protection and exact approved Gross.
6. With GLOBAL HOLD still protected, independently verify current signed ASTER positions, open orders and account equity at least 3 times; validate all7 process/runtime fingerprints, total/crypto/stock/HYPE gross, cumulative DD30, Shared Risk 7.5%, Margin Guard, pending exposures and the ASTER single writer. UNKNOWN/partial/outage states must remain blocked.
7. Only after formal owner-authorized Root preflight and launch transaction passes, make the atomic runtime switch and officially transition global/per-runner order permissions. No test orders. Verify actual LIVE order capability as permits/service checks; do not force an order merely to prove connectivity.
8. Post-switch continuous signed read-only audit and documented rollback to the last certified immutable source while preserving protected open orders, STOPs and positions. If any guard becomes stale/unknown, preserve HOLD or per-runner order block; never silently assume FLAT.

## Review commands (source-only; do not run production order enable from ChatGPT)

```bash
npm ci --ignore-scripts --no-audit --no-fund
for t in tests/hype-h48-*.test.ts; do npx --no-install tsx "$t"; done
npx --no-install tsx tests/integrated_gross_governor.test.ts
npx --no-install tsc --noEmit -p tsconfig.json
```

**Acceptance boundary:** Code/tests/PR preparation are valid deliverables. LIVE is **not complete** until the new Owner/Root credentials and source-bound permits are issued and post-deploy results actually prove them. Maintain no-orders/hold until that point.

## Additional strict stop/rollback preconditions before Codex formal switch

- Offline protected restart and STOP retirement tests do NOT prove the H48 systemd runtime is wired. Build separate native H48 Runner; never repurpose legacy TREND/ATR.
- STOP retirement DELETE is allowed only AFTER signed flat account GET, durable CANCEL_SUBMITTED and Root STOP8 approval; UNKNOWN remains pending and no retries.
- Root STOP8 verifier is NOT the certificate issuer. Obtain valid HP signed approval_id for exact NEW SHA and STOP8 policy, then separate Root-signed issuer; old TIME_ONLY permit is unusable.
- Source-only CI is no-secret/no-production, not a substitute for protected GitHub Environment and real Root preflight.
- Old runtime gross governor has 5.0/8.0 escalations: explicitly change it only in NEW signed release and verify strict upper bounds before any order.

## Additional source-complete fail-closed improvements (2026-11-26)

- `lib/hype-h48-execution-journal.ts`: H48 reduce-only 48-hour SELL reconciliation now permits only the **one deterministic owned resident STOP8** still working on ASTER. Entry/foreign/duplicated/altered HYPE STOP orders stay MANUAL_REVIEW. This avoids classifying a legitimate protective STOP as rogue during exit.
- `lib/hype-h48-native-order-executor.ts`: after a signed flat SELL, returning RECONCILED_FLAT requires the separate signed STOP8 retirement handoff. If DELETE outcome is UNKNOWN, report `FLAT_STOP8_RETIREMENT_REQUIRED` and never resend the SELL. Root-authorized protected EXIT remains separate from new-entry HOLD release.
- `lib/hype-h48-protected-restart.ts`: a later FLAT state may resume the next research 6h grid only after both a **matching durable confirmed STOP8 retirement receipt** and a fresh signed HYPE flat/no-stop GET. Never delete historical STOP8 journal to fake a new FLAT.
- `lib/hype-h48-native-monitor.ts`: the read-only monitor now accepts an explicitly configured STOP8 protection store, checks signed resident STOP8/retirement receipt on both OPEN/FLAT, and never sends an order. This is not yet a systemd LIVE runner.
- `lib/hype-h48-allrunner-risk-precheck.ts`: source-only all-runner ASTER positions/open orders, pending UNKNOWN, Shared Risk, DD30, Margin Guard and canonical GLOBAL HOLD precheck; Owner-approved gross arithmetic; **tradingAuthorization:false** unconditionally. The actual live executor still must obtain trusted signed data and independently approved Root/Owner permit before submission.
- `scripts/ops/deploy/disdex_h48_stop8_formal_issue.py`: newly staged **explicit --issue only** Root policy-certificate issuer. It requires a fresh exact HP redeemed approval row, same run ID **and same saved signed transport token**, 5min validity, trusted HP store owner, an immutable release and exact final STOP8 plan SHA, plus real Ed25519 verification. Does not issue any permit or clear HOLD; its normal invocation is read-only. It is NOT connected to the protected production workflow, which remains old TIME_ONLY.
- `lib/hype-h48-stop8-root-authority.ts`: Root runtime verifier now requires **(1) exact immutable STOP8 certificate, (2) matching immutable issuance receipt, (3) independently issued short-lived HYPE scoped order permit** before returning `H48ScopedOwnerOrderGrant`. The STOP installation/retirement authority uses matching cert+receipt to keep protective maintenance distinct from entry permission. Absence/mismatch/expiry is a hard block.
- Independent `.github/workflows/disdex-h48-offline-native-safety.yml` checks all H48 test files, strict Owner hard-cap candidate and the unchanged signed legacy governor, whole-project TypeScript, and Python formal-issuer contract without live credentials, SSH or order APIs. Confirm the latest HEAD CI before merging.

## LAST non-cutover engineering gaps (must not be described as completed)

1. The native **LIVE systemd runner** / sealed dependency factory remains unwired: H1 ASTER market feed, 6h schedule, Root STOP8 position attestation, signed venue snapshots, real account lease, stop installer and retirement coordinator, actual 7-runner source-integrated shared risk and order permission. Current code is source candidates with mock proof, not a live service.
2. The STOP8 source-only issuer **has not** been integrated into the officially reviewed HP `HYPE_STABLE4_H48_STOP8_LIVE` operation and GitHub Environment workflow. The protected workflow update previously hit a safety restriction and MUST NOT be bypassed.
3. The newly authorized STABLE4 hard caps must be applied to the **next** immutable risk-source release and source fingerprints formally signed. Existing pinned integrated risk code is intentionally unmodified because the exact SHA source gate rejected a direct edit; **do not fake the old fingerprint**.
4. The full seven-strategy, one-year portfolio simulation with 10/30bps, all exit/slippage/funding, synthetic gap and independent walk-forward still has not been reproduced and certified for the NEW H48+STOP8 portfolio. Existing 27 TARGET / 2 FORWARD H48 selected trades cannot substitute.
5. Final Root/Owner signed certs, seven source-matched permits, signed ASTER GETs and production activation/deploy remain Codex formal cutover tasks. No real orders/cancels/STOP, Kill Switch changes or VPS activation in this PR.


## Final native source candidate engineering summary — 2026-11-26

- Native H48 sequencer/Root-protected ENTRY and 48h EXIT orchestration: `lib/hype-h48-native-stop8-coordinator.ts`; source-level tests prove research state persisted BEFORE handoff, no HYPE order during global HOLD, exact STOP8 Root proof, and protected reduce-only time exit. It is not an installed LIVE service.
- Root-signed H48 STOP8 policy certificate **source issuer**: `scripts/ops/deploy/disdex_h48_stop8_formal_issue.py`, separate Python unit tests. Explicit --issue requires exact immutable final-plan source hash, genuine same-run HP REDEEMED approval row **and the identical fresh HP token from the backing store**, Owner Ed25519, trusted file owner and Root. Its default invocation is read-only. The issuer deliberately does not issue an order permit, clear HOLD, switch runtime, or send/cancel an ASTER order. Protected formal HP workflow is not yet connected.
- Runtime Root verifier requires THREE independent exact-sha pieces: STOP8 policy certificate, matching Root issuance receipt, and short-lived, separately-issued HYPE scoped order permit. It returns no order grant on missing/expired/wrong permit. Do not substitute the old TIME_ONLY certificate or receipt.
- Native stop-exit lifecycle: `lib/hype-h48-stop8-native-retirement-handoff.ts` finds exact owned STOP8 journal and cancellation-intent file, confirms flat signed ASTER GET, performs at most one Root-authorized DELETE, and uses signed GET-only recovery after UNKNOWN; `lib/hype-h48-native-order-executor.ts` cannot report safe FLAT before STOP retirement.
- Source-only SHADOW entrypoint `scripts/disdex-hype-h48-native-shadow.ts` obtains fresh authenticated ASTER account GET and HYPE/BTC H1 bars, uses immutable SHA and persistent journal, and intentionally **rejects LIVE mode**; it has no order/cancel API invocation. It is not a deployed/authorized real-order runner. Actual LIVE service, authorization factory, systemd integration, full Root protected order path and rollback remain formal deploy engineering.
- Current source candidate PC regression: H48 **24 suites / 131 PASS**, approved-hardcap 4 PASS, original signed integrated governor 5 PASS; full project `tsc --noEmit` PASS at latest checked source. Python issuer tests and latest CI must independently confirm on the same latest HEAD.
- The old signed risk policy source is unmodified; user-approved absolute Crypto3.0/Stock4.0/Total4.25/HYPE1.5 caps exist in `lib/stable4-dd30-owner-hard-gross-candidate.ts` and must be implemented in a NEW source SHA with newly approved Root fingerprint. Never edit a historical SHA pin to hide a changed source.
- This is still a **Draft staging candidate**: missing signed HP/Root STOP8 LIVE deployment, all seven scoped order permits, full 1-year cross-runner BT with independent forward synthetic stress, and formal verified transaction to switch actual seven runners. These remaining steps are not legitimately complete merely because tests pass.
