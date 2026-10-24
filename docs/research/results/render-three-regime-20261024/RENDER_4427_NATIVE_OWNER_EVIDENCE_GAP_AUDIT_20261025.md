# RENDER #4427 — Native8 independent Owner evidence gap (2026-10-25)

**STATUS: RESEARCH_ONLY / NATIVE_OWNER_ADMISSION_NOT_CERTIFIED / FAIL_CLOSED**

## Primary evidence and scope

- Parent research branch: `research/render4427-owner-route-preflight-contract-20261025`, SHA `458bfc51ec2e8310b4c87ebf5588a02b7ac2bd40`.
- Inspected **converged I1/I2 raw** Native8 candidate decisions, modeled trades, and portfolio events for 10bps and 30bps, from the independent fresh-process A/B audit in `C:/tmp/render4427-fresh-process-audit-20261025`.
- For each cost, two converged iterations have the same raw decision SHA; the independent B process has the same raw decision SHA. Audit script executed twice independently, output SHA256 **`67fa56fe27a1149a4fb8aa7cfc34c7bafa4d146803b0f8630b11bf0fbaac3719`**.
- Audited exactly three new RENDER route candidates at 2026-05-27 21:00, 2026-06-23 01:00, and 2026-06-25 07:00 UTC.

## New verified finding: modeled acceptance is not Owner/Route certification

The raw Native8 decisions for June 23 and June 25 are labeled `ACCEPTED_MODELED_ENTRY` in both cost models. **They are not venue-verified fills**:

- `source_venue_signed = false`
- `historical_fill_verified = false`
- `quantity_actual_fill = true` and `quantity_provenance = MODEL_ACCEPTED_DECISION_AT_T`. The field named `quantity_actual_fill` refers to the research model's simulated accepted quantity, **not** an authenticated Aster fill. Any downstream interpretation of this field as actual venue execution would be incorrect.
- `owner_id` and `capital_owner` are absent from these raw decision records. The explicit research Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH` is therefore **not** demonstrated as registered or admitted by these records.
- Across the inspected decision/trade/event artifacts, ten evidence fields for owner registration, as-of priority, Shared Risk, Margin Guard, Kill Switch, account lock, pending and dedup provenance are absent. **Zero of the thirteen required as-of GateProofs were independently authenticated by this audit.** Absence from these three artifact families does **not** prove that other evidence does not exist elsewhere.
- May 27 remains `REJECTED_PORTFOLIO` under the Native8 model; the earlier verified incumbent RENDER position must continue to block any new same-symbol entry.

## Decision

**No native Owner/Route admission certification and no new economic result.** The earlier modeled portfolio gains must not be interpreted as deployable improvements. The independent Owner route cannot be admitted until immutable as-of native evidence is bound to the candidate key, an explicit registry and priority decision are proven, and the unchanged global risk/ownership checks pass. Unknown evidence => Fail Closed.

No existing `_overlay_block` field was cleared or altered in this audit. No risk limit was relaxed. No 2025 Aster RENDER H1 mark was fabricated; actual Aster M5 fills, Funding, and signed stop lifecycle remain unverified. Historical periods are previously explored, not pristine OOS. **VPS, LIVE, Production, HP and actual orders were not changed.**

## Reproduction

Run `python scripts/dd-reduction/render_4427_native_owner_evidence_gap_audit_20261025.py` from the isolated research worktree, with the existing A/B research files mounted at the paths above. It writes `RENDER_4427_NATIVE_OWNER_EVIDENCE_GAP_AUDIT_20261025.json` alongside this report. The script asserts both cost models, all three candidate dates, raw A/B converged SHA parity, and the distinction between modeled fill quantity and verified venue execution.

Next research should implement the explicit Owner/Route registry **inside an isolated Native8 preallocation/priority pipeline** with immutable, candidate-key-bound, as-of proofs. It must not clear `_overlay_block` or bypass same-symbol, 12h cooldown, Shared Risk, Gross, Margin, Kill Switch, Pending, account lock or dedup. Run fresh-process 10/30bps only after evidence binding is authenticated.
