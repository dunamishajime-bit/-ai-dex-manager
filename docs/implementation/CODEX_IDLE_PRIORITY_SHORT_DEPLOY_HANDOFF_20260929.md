> **2026-09-30 cost/replay correction:** `docs/implementation/IDLE_PRIORITY_COST_RECONCILIATION_20260930.md` controls economic parity. The historical JPY268.05M / 1,342 bundle is not a coherent single 10bps run and must not be used as a Production/LIVE acceptance target. Primary coherent 10bps reference: 61 Idle, 1,339 total trades, ~JPY214.78M.

# Codex Handoff — Idle Priority SHORT Production Deployment

Date: 2026-09-29
Source branch: `design/idle-priority-bt-parity-20260929`

## Authority
Use `docs/superpowers/specs/2026-09-29-idle-priority-bt-parity-design.md` as the controlling strategy contract.
Do not retune, reinterpret priority, add partial sizing, revive ZEC, or reset Production backward.

## Recovered immutable research evidence
- `idle_candidate_events.csv`: 495 rows / 149207 bytes / SHA256 `09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb`
- `idle_candidate_filtered.csv`: 63 rows / 22234 bytes / SHA256 `5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48`
- raw filtered outcomes: 50W / 13L
- exact route counts: DOT 15 / JUP 14 / RENDER 15 / TAO 9 / TIA 10
- integrated acceptance anchor: 61 trades / 48W / 13L
- historical mixed-report bundle (not a valid acceptance target): baseline ~JPY141.85M, final ~JPY268.05M, PF ~2.055, max DD ~-23.24%, total ~1342
- 63 -> 61 historical exclusion identity is constrained to one DOT and one TIA; do not guess which timestamps.

The two CSV files were recovered from the prior ChatGPT research workspace/library and independently hash-verified. The JPY141.85M -> JPY268.05M integrated replay itself was a prior-thread local analysis run; its exact baseline ledger is not present in the GitHub formal-five `latest` artifacts. The inspected formal-five 10bps `latest` artifact is a DIFFERENT run: JPY105,474,659.39616707 / PF 1.6884972891846897 / DD -37.521093%. Never substitute that ledger or claim it is the JPY141.85M anchor. If the exact JPY141.85M ledger cannot be recovered, the 61-trade/final-equity acceptance gate remains unproven and LIVE must stay blocked.

## Mandatory pre-deployment block
LIVE activation remains BLOCKED until the exact baseline ledger used by the JPY141.85M anchor is recovered and replay proves:
1. exact 63 filtered rows/no extras
2. exact one DOT + one TIA historical baseline exclusion
3. 61 admitted
4. 48W/13L
5. coherent 10bps fixed-intent replay: 61 Idle / 1,339 total trades / ~JPY214.78M, with 8bps reported separately
6. emergency -10%/+25% does not alter historical paths

Do not choose the two exclusions by outcome, proximity, or by forcing final equity.

## Existing implementation
- immutable policy: `config/idlePriorityShortPolicy.ts`
- runtime config: `config/idlePriorityShortRuntime.ts`
- closed-H1 pure signal evaluator: `lib/idle-priority-short-signal.ts`
- baseline/sidecar/full-1x/5x-Cross admission gate: `lib/idle-priority-short-idle-gate.ts`
- SHA-bound state: `lib/idle-priority-short-state.ts`
- SHA-bound parity certificate reader: `lib/idle-priority-short-parity-cert.ts`
- SHADOW fail-closed entrypoint: `scripts/disdex-idle-priority-short-live-runner.ts`
- systemd template: `ops/systemd/disdex-idle-priority-short@.service`
- pending registry recognizes `IDLE_PRIORITY_SHORT` as CRYPTO
- HP route: `/decision-status/idle-priority`
- evidence validators:
  - `scripts/idle-priority-short-parity-evidence.ts`
  - `scripts/idle-priority-short-495-63-parity.ts`

Current runner intentionally contains NO certified LIVE order path. Do not bypass `IDLE_LIVE_ORDER_PATH_NOT_CERTIFIED`.

## Required completion before VPS mutation
1. Recover exact JPY141.85M baseline artifact/ledger, not the later JPY105.47M formal-five output.
2. Build deterministic 63->61 portfolio replay and parity certificate generator.
3. Complete market-data loader, reconciliation/ownership, account lock, strict planner, pending registry, guarded executor, venue protection readback, fixed hold exits.
4. Add watchdog/current-runtime/health snapshot integration.
5. Finish HP read-only runtime telemetry/history/performance/position attribution.
6. Add tests for all 15 acceptance clauses in the controlling spec.
7. Typecheck/build/selftests/parity must all pass.

## Deployment procedure
Only after all parity gates pass:
1. fresh READ-ONLY VPS probe
2. capture current Production/UI SHA; never force checkout backward
3. integrate onto actual current production lineage
4. preserve all existing positions/protective orders
5. isolated versioned release + rollback
6. exact-SHA root-owned operator activation artifact
7. verify core runners + Shared Risk + Margin Guard healthy before starting Idle
8. no forced/test order
9. verify SHA/PID/restarts/Kill Switch/pending/account lock/positions/orders/protections/disk/API/HP

Final status only:
- `LIVE_ACTIVATED_VERIFIED`
- or `BLOCKED_<EXACT_REASON>`

Never report LIVE from GitHub/CI alone.

## Additional recovered baseline identity evidence (2026-09-29)

The controlling local Idle replay baseline metrics recovered from prior-session records are:
- 10bps baseline final equity: approximately JPY 141.85M
- baseline PF: approximately 2.077
- baseline max DD: approximately -22.87%
- baseline closed trades: 1,284
- Historical mixed-report integrated count: 1,342 (unsupported; do not certify)
- Idle integrated PF: approximately 2.055
- Idle integrated max DD: approximately -23.24%

The former inference that exactly three baseline trades changed was based only on the unsupported 1,342 count and is withdrawn. The coherent 10bps replay causally rejects six baseline intents.

Recovered older source bundle proves the evaluation capital convention was 2025-08-10 through 2026-08-10, initial JPY10,000 + JPY10,000 monthly x12 = JPY130,000 total contributed, but its old-engine NORMAL baseline JPY165.415M and native-new-PENGU paired JPY318.750M are NOT the controlling JPY141.85M run. Likewise the later formal-five 10bps JPY105.475M / PF1.6885 / DD-37.52% / 1,037 trades is NOT the controlling run. Do not substitute any of these.

A source bundle recovered from the research workspace contains the immutable old integrated engine SHA256 `cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d`, historical V12/PENGU ledgers, and the 2025-08-10..2026-08-10 capital convention. Use these only as reconstruction inputs; the JPY141.85M identity must still be matched before LIVE certification.
