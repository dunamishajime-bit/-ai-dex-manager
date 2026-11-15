# BT-481-H3 | Saved seven-family source evidence visible in BT page (2026-11-16)

## Implementation

- The existing dedicated dark BT workspace now renders a **read-only saved source
  evidence panel** within the artificial-market configuration area, before the
  individual V4/Q102 native research diagnostics.
- Data comes from the **Git-committed manifest** at
  `reports/bt-verification/BT_PR481_H2_7_FAMILY_CAUSAL_OBSERVATIONS_20261116_V1.manifest.json`,
  validated by `lib/bt-verification/source-observation-evidence.ts`.
- Full 8,260-row audit remains in the neighboring gzip archive with canonical
  ledger SHA256. The browser displays the counts, seven source families, 54
  source-candidate rows, zero verified entries, zero orders and zero fills,
  and both audit checksums. It does not download or send hidden credentials.
- The panel explicitly states that this is **fixed historical artificial-source
  research**, `seed=20261115`, `rotation`, artificial feed `v4`, 33 symbols,
  Oct 1-23 2025 UTC. It does **not** follow the current preview seed/scenario,
  represent current LIVE, represent trade fills, or claim historical
  STABLE4_OPPORTUNITY 10bps/30bps return reproduction.
- The original H48 multiasset replay, source-only FET/PENGU/IDLE/Q102/V4
  probes, synthetic-market selector, historical archive, protected owner
  endpoints, non-BT pages and LIVE runners remain unchanged.

## Verification

- `scripts/bt-hp-seven-family-evidence-panel-selftest.ts` renders the
  actual React component using server-side React renderer and checks all
  seven source family rows, exact saved counts and checksum display, fixed
  artificial-market disclosure and zero-fill warning. It verifies the panel
  is integrated in the existing BT workspace page exactly once.
- `npm run typecheck` and `npm run build` must pass.
- This is a static UI evidence display test, **not a signed-in browser E2E**:
  authenticated browser/mobile tests remain in BT-481-N.
- No Production approval, PR merge or HP deployment occurs in this task.

## Next task

After H2 source results and H3 read-only evidence panel, resume
**BT-481-I**: reconcile the V4 native source manifest against the proper
referenced production pin *without editing Codex's LIVE worktree*, then add
only source-proven additional V4 strategy routes. Do not promote research
thresholds, partial FAILED_BREAK candidate events, or artificial prices
to verified orders or portfolio PnL.

All live orders, STOP changes, fills and HP Production actions: **0**.
