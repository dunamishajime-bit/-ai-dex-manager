# CODEX DEPLOY-ONLY HANDOFF — V12 Score1.00 / Volume0.80, original rescue unchanged (2026-09-28)

**Status:** PRODUCTION_CODE_PUSHED_AND_CI_VERIFIED; HISTORICAL_FULL_EVIDENCE_RELEASED; **VPS_DEPLOY_NOT_EXECUTED**. Codex may perform *deployment only*, subject to the existing protected operator activation artifact and read-only live preflight. No additional strategy research, no new sizing rules, no forced trade or position liquidation.

## 0. Do not confuse the 141.85M model with the 68.35M model

User approves **normal V12 gate only**; previously examined rescue Score minimum 0.35 is **rejected**.

- Production source baseline from 2026-09-26: `a09ea45ca3cbd72100f9eb0eaae499039c40b6a0`, branch `codex/legacy-runtime-safety-audit-20260926`.
- Deployment-only source branch: `codex/v12-normal-gate-only-production-handoff-20260928`.
- Audited V12 implementation commit (exact two-threshold config change only): `d8b15f5d135224ca5833b0ba98c4bcaebca1a7ba`. Later commits on the handoff branch only add tests, CI, provenance, and this instruction document.
- Immutable research code SHA whose V12 config blob exactly matches the deployment implementation: `dbf84542311c15f69508f91a0e7311ff7e686d96`. Both point to config blob `dbd81d56de4980153ff0ddf5781715200d238e06`.
- **Production runtime source delta:** only `config/v12X1AllRuntime.ts`, two threshold values:
  - `minimumVolumeRatio: 0.9845` -> `0.80`;
  - `neutralScoreThreshold: 1.4649` -> `1.00`.
  - `lib/v12-x1-all.ts` **must be byte-identical** to current approved runtime source; NO `relaxedRegimeMinimumScore` addition.
- Retain both existing rescue routes (Strong Regime Score0.15–0.70 / ATR >=1.4%; nonstrong directional Momentum >=5.4% and ATR >=1.4% without Score min); existing HC1.75 WinRateGate, Top3 Rank3 >=Score0.70 and gross0.10, stop/exit, gross reservations, cooldowns, 5x-cross margin requirements, operator gates, HP and all other strategies unchanged. Do not silently port the unrelated research alternates.

## 1. Reusable model and exact annual evidence (already archived)

**Primary reference / complete forever-style release assets:** https://github.com/dunamishajime-bit/-ai-dex-manager/releases/tag/bt-v12-score100-volume080-normalonly-20260928

Tag: `bt-v12-score100-volume080-normalonly-20260928`; archive `bt-v12-score100-volume080-normalonly-20260928.tar.gz`, 51,556,747 bytes, SHA256 **`891c36d8a5957cafe3aae65656a98b7c02a3c437c4f520fe63756d550f08b4fb`**. `RELEASE_MANIFEST.json` verifies **764 files** by SHA-256; `REPLAY_INDEX.json` in the archive covers every file's hash/size. Copy the release files and always verify sha256 before reuse; never substitute a same-named but freshly downloaded Yahoo source.

Research source, provenance, small metrics and quick-start have also been copied to the deployment branch under `docs/research/results/v12-score100-vol080-normal-only-20260928/`.

Run date 2025-08-10 to 2026-08-10; JPY 10,000 initial and JPY 10,000 added monthly x12, five-strategy causal price-model shared capital allocation; Q102 BRK/MR 0.75x, FET 1.00x + two frozen FET pre-entry refusal gates, PENGU and V52 original frozen strategy source; real Aster H1/funding, original verified Yahoo-based V52 tape, ECB delayed FX *reference*.

| 10bps model | Original (Score1.4649 Vol0.9845) | Adopted normal-only (Score1.00 Vol0.80) |
|---|---:|---:|
| Final JPY asset | 130,287,867.06655651 | **141,845,207.7243423** |
| Closed portfolio transactions | 1,046 | **1,284** |
| V12 transactions | 754 | **991** |
| PF | 2.417612579 | **2.077173748** |
| Win rate | 57.456979% | **55.140187%** |
| Maximum MTM DD | -22.9449638% | **-22.8733513%** |

8bps adopted final JPY 175,059,528.3889343 vs original 155,417,832.2837019. Original baseline exact PF/DD/trade/final verification PASS before variant. Only one of the audited 90 runtime source files changed; same Aster market data and SHA-pinned original V52 source tape.

**Critical:** all `portfolio-trades.jsonl` and `candidate-decisions.jsonl` are H1 **SIMULATED** fills/decisions, not live Aster exchange executions, and 8/10bps are not a formally reconstructed order-book SEVERE model. These are in-sample research figures, not a guaranteed outcome.

### Quick extraction / exact file paths

```bash
gh release download bt-v12-score100-volume080-normalonly-20260928 \
  --repo dunamishajime-bit/-ai-dex-manager
sha256sum -c bt-v12-score100-volume080-normalonly-20260928.sha256
tar -xzf bt-v12-score100-volume080-normalonly-20260928.tar.gz
# <archive-root>/selected-five-logic-all-cases-all-costs/BRK0P75_MR0P75_FET1_DUAL_GATE/PRICE_MODEL_10BPS/
#   metrics.json, portfolio-trades.jsonl (ALL simulated trades),
#   candidate-decisions.jsonl (ALL accepts/rejects),
#   portfolio-events.jsonl (ALL cashflows/MTM/allocation)
# Sibling PRICE_MODEL_8BPS; baseline-five-logic-all-cases-all-costs/...
# Full source data, V52 source tape, acquisition manifest, signal scan ledgers and REPLAY_INDEX.json also inside.
```

The release README is `HOW_TO_REUSE.md`; on the production branch `FULL_LEDGER_REPLAY_README.md` mirrors it. Do not delete, overwrite, move, or merge away this original release.

## 2. CI and code integrity acceptance (before touching VPS)

Production branch CI: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36372901516 — PASSED. It verified only the two V12 numerical production behavior changes, TypeScript compile, original V12 selftest updated at the new boundary, additional original-route/no-Score-floor adoption selftest, WinRateGate, V12 execution safety and shared risk tests. It submitted **no real orders**.

Before deployment, independently compare the intended target branch's runtime `config/`, `lib/`, and actual VPS runtime config against baseline and verify ONLY the two values above changed. Do not deploy the research branch or copy the 90-file research snapshot as a production release. Validate production branch HEAD SHA and GitHub remote equality before making a VPS release; any changed source/CI drift means stop and re-review.

## 3. CODEX ACTION — VPS deployment only

1. **Read-only discovery FIRST:** SSH to authorized Xserver VPS. Record current Git SHA/branch and `current` symlink, all 5+ trading runner/systemd units' active status and runtime SHAs, watchdog/auto-repair/runtime owner, open exchange positions and live protective orders, shared Kill Switch, Shared Risk and Margin Guard status, disk free space and reserve, margin mode, live per-strategy gross caps, operator root-owned approval artifact, last 429/shared-lock incidents. Capture baseline snapshots (with private tokens/secrets omitted). No speculative claims about state based solely on old chats.
2. **Detect divergence:** production historical baseline was `a09ea45c...` and branch `codex/legacy-runtime-safety-audit-20260926`. If VPS/remote current production is newer/different, **do not reset, force checkout an old commit, override other logic or deploy this old branch verbatim**. Cherry-pick/apply ONLY the two verified config threshold values to the actual newer LIVE code; keep all other changes, regenerate a new approved SHA, rerun the same full safety tests and show exact source diff. If config/strategy routing differs materially, remain fail-closed and report blocker, do not invent equivalence.
3. Build and stage a new isolated release; preserve previous release, systemd unit files, `state` and protective-order ownership. Never bypass watchdog/operator startup gates or unpause trading merely to prove the threshold. Verify normal branch unit tests and V12 preflight in non-ordering mode, stale-data/WinRateGate/read-only exchange input, actual volume0.80 and Score1.00 threshold boundaries, existing Score-less Momentum rescue, risk reservations and position migration safeguards.
4. **Operator approval is mandatory** for the target SHA as enforced by existing root-owned activation artifact. If missing/invalid/stale, do not unlock Kill Switch or submit orders, and return `OPERATOR_LIVE_ACTIVATION_REQUIRED` with precise required manual operator action. User authorizes Codex *deployment task*, not an automatic bypass of platform safety/operator approval.
5. For an approved cutover only, atomically stage and activate release with exact runtime SHA, avoid orphaned protections and do not auto-close legitimate live positions. Existing venue-side protective orders must stay valid. Restart only the required units in the supported dependency order; preserve unrelated strategy parameters/sizing and contracts. Confirm runtime SHA, GitHub remote, all relevant runners, watchdog/auto-repair, Shared Risk, Margin Guard, live order routing, HP /decision-status V12 values and history, heartbeat freshness. No artificial, forced, duplicate or replayed live entries.
6. If a post-cutover issue appears, use a **safe** rollback approved for current open-position state, not a blind stale-SHA restart. Never roll back protective state or revoke safety guards to force a success status.

**Required final Codex report**: observed original VPS SHA/position/order snapshot (without secrets); target deployed SHA and Github remote equality; exact changed files; CI tests and preflight results; operator artifact status; LIVE order path and exchange read-only confirmation; protective-order and PENGU/Q102/FET/V52 invariants; HP status; any blocker; reversible rollback SHA; final machine-readable `LIVE_ACTIVATED_VERIFIED` or `BLOCKED_<REASON>`. If not fully verified, report the blocker and leave fail-closed rather than claiming LIVE.

**Strict division of work:** all model research, configuration Push, full 764-file evidence archive, selftest updates and CI have been performed upstream; Codex owns ONLY final VPS integration and deployment/safety verification. It must not retune V12, redo a different BT, add Score0.35, promote alternate rescues, change FET/PENGU/Q102/V52, or delete the preserved evidence. 
