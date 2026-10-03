# Ownership-corrected Core / retained Overlay causal diagnostic

## Status

`BLOCKED_OVERLAY_FULL_H1_BASELINE_EVIDENCE_AND_MARGIN_PARITY_NOT_PROVEN`

This is **not** LIVE certification. User approved separating the historical
1275-trade anchor from a new ownership-corrected Core baseline. Existing LIVE
53eeff5417636369d4709fddfd47d7916ddcf3b1, operator approval and HP are unchanged.
No authenticated mutation or synthetic/test orders were used.

## What was actually rerun

- Original archived engine is SHA-verified and never overwritten. The research
  derivative rejects cross-strategy same-symbol ownership before entry/fees.
- Original raw/FET-dual-gated candidates, Aster H1/funding, ECB delayed FX and
  frozen V52 Yahoo-origin lifecycle source are retained, no sizing retuning.
- Production TS signal functions compute fresh closed-H1 features. No 63/61
  timestamp membership, old1284/1339/1390 accepted-intent schedule or future
  target PnL is used to select Overlay entries.
- Five configurations share the same wallet, daily loss, gross allocator,
  fees/funding/deposits, actual model exit cooldown and preemption functions.
- Idle does not preempt Core and is not preempted by later Core. Residual
  LONG has shared one-slot/full1x sizing and yields whole position to Core.
- Generic LONG/unselected Idle routes advance the 12h candidate lifecycle
  while Core is idle; they are not counted as executed trades/PnL.
- Source-incomplete hours block new Overlay admission. No missing source
  features were patched from historical candidate membership.

## 10bps diagnostic comparisons

Initial JPY10000 + monthly JPY10000 x12, compounded. Period follows the original
engine: 2025-08-10 through 2026-08-10 inclusive (2026-08-11 exclusive).

| Configuration | Final equity JPY | PF | MTM DD | Closed trades |
|---|---:|---:|---:|---:|
| Historical original Core (unchanged) | 1,229,065,462.0472791 | 2.4887028036012624 | -21.296368751349548% | 1275 |
| Ownership-corrected Core | 924,164,577.384132 | 2.432055367261132 | -21.296368751349548% | 1264 |
| Core + Idle | 1,537,800,452.767332 | 2.4876122235709524 | -22.712596458622347% | 1299 |
| Core + Idle + DOGE | 1,562,061,878.1192062 | 2.487703184615187 | -22.71259645862237% | 1302 |
| Core + Idle + AVAX | 1,535,339,098.068683 | 2.4936522461719703 | -22.71259645862237% | 1307 |
| Core + Idle + DOGE + AVAX | 1,584,517,987.2094781 | 2.494581557780963 | -22.712596458622325% | 1309 |

All20 configuration/cost scenarios: same-symbol ownership overlaps0,
accounting reconciliation PASS. These checks alone do NOT establish LIVE parity.
The combined10bps case contains V12975/PENGU63/Q102127/FET12/V5284/Idle38/
residual10. The paths and compounding differ from both old historical anchors.

## Combined diagnostic cost sensitivities

| Cost | Final equity JPY | PF | DD | Trades |
|---|---:|---:|---:|---:|
| 8bps | 2,007,632,221.5572104 | 2.5532987201849173 | -22.63584676194199% | 1309 |
| 10bps | 1,584,517,987.2094781 | 2.494581557780963 | -22.712596458622325% | 1309 |
| 20bps | 489,659,419.34963065 | 2.2181783262028247 | -23.094345459237897% | 1308 |
| 30bps | 152,638,385.46280393 | 1.9740710734719797 | -23.472777065850525% | 1308 |

## Material unresolved proofs

1. The saved Aster source starts Jan2026 for TAO/TIA/JUP/RENDER, not Aug2025:
   TAO/JUP first2026-01-09T14:00Z, TIA2026-01-09T18:00Z,
   RENDER2026-01-06T13:00Z. A total4993/8784 hourly all-source checks are
   incomplete, including missing exact bars and invalid zero-volume medians.
   Distinguish invalid/zero-volume data from missing bars; do not fabricate volume.
2. A bounded official public GET probe for 2025-08-10 returned0 bars for
   TIA/TAO/RENDER. This is evidence about that query, not proof that no archive
   can exist or permission to replace these symbols with another exchange.
3. Frozen closed-lifecycle Core candidates are NOT complete current-H1 runner
   eligible/no-signal evidence. The diagnostic uses same-timestamp Core
   candidates as its priority proxy and does not certify that proxy as LIVE.
4. Atomic H1 model fills do not reconstruct pending reservation latency,
   actual fills, global daemon tie-break, account available margin or filters.
5. STOP-first bar handling is a conservative deterministic price-model rule,
   not verified intrabar venue stop time. Residual source-error priority exit
   behavior is not fully reconstructed: admission is blocked, but this model
   must not be represented as exact retained LIVE behavior on those hours.
6. The engine allocates Gross using pre-entry-fee equity; new strict post-fee
   quantity/margin parity is not established. Fee/slippage headroom must be
   assessed before any runtime certification or actual execution mapping.

Therefore no new certification/operator artifact, state migration, current
symlink update, systemd restart or HP deployment was performed.

## Inspectable evidence / replay

`comparison-manifest.json` contains all20 results, monthly equity, strategy PnL,
rejection counts, file SHA256, source-byte SHA256 and bounded public GET probe.
`replay-ledgers.zip` contains every scenario's trades, candidate decisions,
global events and detailed metrics (including strategy/symbol/family outcomes).
`production-feature-stream.zip` contains8784 freshly evaluated hourly records,
including explicit source errors. Full byte identities are in the manifest.

```text
tsx scripts/research/formal_overlay_feature_stream.ts <MARKET_ROOT> <FEATURES_JSONL>
python -B -m scripts.research.run_formal_core_overlay_diagnostic --baseline-root <VERIFIED_RELEASE_ROOT> --candidate-root <VERIFIED_GATED_CANDIDATES> --features <FEATURES_JSONL> --output <NEW_OUTPUT>
```

Regression tests: newownership5 / allocator17 executions (contains inherited
ownership test executions) / previous source-audit20 PASS. TypeScript PASS.
Full Python discovery attempts in this turn exited1 with no aggregate output;
no full-suite PASS is claimed. Previous complete full discovery remains
162tests/156pass/2stale-contractfailures/2Windowsfcntlerrors/2POSIXskips.
Review was author self-review (no fresh subagent tool), not independent review.
