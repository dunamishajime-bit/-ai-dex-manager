# Task 2 Report — Causal Signal Engine and Market Data Cutoff

Status: COMPLETE

Implementation commit: `f1d8478e` (`feat: generate causal Quality102 v1 signals`)

Base commit: `0eb8af40`

## Scope and controller rulings

- Implemented `QUALITY102_CAUSAL_V1` from recovered causal HIGH_VOL source behavior.
- Kept `historicalSelectorParity=false` and did not modify any legacy Quality102 capability flag.
- Kept BRK disabled in generation and telemetry (`brkEnabled=false`).
- Omitted PB, MR, and REV from LIVE generation because repository history contains their post-generation quality gates but not their upstream raw signal formulas. No replacement formulas were inferred.
- Did not infer or claim parity with the unrecovered historical HIGH_VOL 525-to-30 membership revision.
- Did not use frozen historical events, replay scripts, evidence CSVs, or historical event timestamps.
- Did not push, deploy, or touch the VPS.

## Recovered source used

### `26e915f9` — adaptive PENGU 72-hour ancestor

Used these functions/behaviors from `research/pengu_swing_robot/run_pengu_adaptive_72h_v2.py`:

- `rule_grid`: full 288-rule PENGU grid.
- `build_features`: 24-hour return, 14-day regime, Wilder RSI/ATR, 24-hour volume-median ratio, and reversal-bar direction, through the existing TypeScript causal feature functions.
- `backtest_range`: next-hour entry, maximum 72-hour hold, hard stop, no overlapping training trades, and normal cost/funding deductions.
- `trade_metrics`: compounded return, win rate, profit factor, expectancy, and drawdown.
- `select_rule` / `run_walk_forward`: one rule per calendar month trained only on the preceding 180 days, with the recovered base eligibility and Wilson-based score through `selectQuality102HighVolMonthlyRule`.

### `d9e069be` — 30-symbol wrapper

Used these functions/behaviors from `research/pengu_swing_robot/run_high_vol_scanner_30.py`:

- `compact_satellite_grid`: exact 72-rule non-PENGU grid (`3 x 2 x 3 x 2 x 2`).
- `choose_universe`: treated the runtime-provided symbol list as configured membership and did not reconstruct the unrecovered historical membership revision. BTC is loaded only as a reference and is excluded from trade candidates.

### `792b1e70` — reserved portfolio selector

Used these functions/behaviors from `research/pengu_swing_robot/run_high_vol_scanner_portfolio_v2.py` and its imported v1 source:

- `trailing_health_pass`: non-PENGU requires trailing win rate `>=58%`, PF `>=1.30`, expectancy `>0`, max drawdown `>=-30%`, and at least five trades.
- `candidate_score`: deterministic ranking from trailing win rate, capped PF, clipped expectancy, move extremity, ATR, volume, and the PENGU evidence bonus.
- `trailing_correlation` / `select_reserved_portfolio`: reject same-direction scanner candidates at absolute trailing-30-day PENGU correlation `>=0.80`, including a causally reconstructed still-active PENGU signal.
- Same-hour candidates are sorted by score and stable symbol/id tie-breaks before `routeQuality102OneSlot`; only one is accepted.

## TDD evidence

The interrupted production modules were deleted before the focused RED run. The test was rewritten to the controller rulings first, including fail-closed omission of source-incomplete families.

### RED 1 — missing implementation

Command:

```powershell
npx tsx scripts/disdex-quality102-causal-v1-signal-selftest.ts
```

Exit: `1`

Output:

```text
node:internal/modules/cjs/loader:1448
  const err = new Error(message);
              ^

Error: Cannot find module '../lib/disdex-quality102-causal-v1-market-data'
Require stack:
- C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\scripts\disdex-quality102-causal-v1-signal-selftest.ts
    at node:internal/modules/cjs/loader:1448:15
    at nextResolveSimple (C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\node_modules\tsx\dist\register-D46fvsV_.cjs:4:1004)
    at C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\node_modules\tsx\dist\register-D46fvsV_.cjs:3:2630
    at C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\node_modules\tsx\dist\register-D46fvsV_.cjs:3:1542
    at resolveTsPaths (C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\node_modules\tsx\dist\register-D46fvsV_.cjs:4:760)
    at C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\node_modules\tsx\dist\register-D46fvsV_.cjs:4:1102
    at m._resolveFilename (file:///C:/Users/dis/-ai-dex-manager/.worktrees/quality102-live-connection-20260904/node_modules/tsx/dist/register-B7jrtLTO.mjs:1:789)
    at defaultResolveImpl (node:internal/modules/cjs/loader:1059:19)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1064:22)
    at Module._load (node:internal/modules/cjs/loader:1234:25) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [
    'C:\\Users\\dis\\-ai-dex-manager\\.worktrees\\quality102-live-connection-20260904\\scripts\\disdex-quality102-causal-v1-signal-selftest.ts'
  ]
}

Node.js v24.13.1
```

### RED 2 — missing active-PENGU correlation behavior

After the first minimal implementation, self-review added a source-specific test for an already-active PENGU signal. The close series were identical, making trailing correlation exactly `1.0`; only the scanner had a current signal.

Command:

```powershell
npx tsx scripts/disdex-quality102-causal-v1-signal-selftest.ts
```

Exit: `1`

Output:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

1 !== 0

    at signalTests (C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\scripts\disdex-quality102-causal-v1-signal-selftest.ts:111:12)
    at run (C:\Users\dis\-ai-dex-manager\.worktrees\quality102-live-connection-20260904\scripts\disdex-quality102-causal-v1-signal-selftest.ts:175:5)
```

The minimal GREEN change reconstructed current-month PENGU signal occupancy from closed candles and applied the recovered 30-day same-direction correlation rejection.

## Final GREEN verification

Command and output:

```text
> npm run strategy:quality102-causal-v1:signal:selftest
> tsx scripts/disdex-quality102-causal-v1-signal-selftest.ts
QUALITY102_CAUSAL_V1_SIGNAL_SELFTEST_PASS {"historicalSelectorParity":false,"brkEnabled":false,"sourceIncompleteFamiliesGenerated":false}
```

```text
> npm run strategy:strict-bt33404708902:pipeline:selftest
> tsx scripts/disdex-quality102-causal-pipeline-selftest.ts
QUALITY102_CAUSAL_PIPELINE_SELFTEST_PASS {"raw":151,"quality124":124,"oneSlotBlocked":22,"quality102":102,"layers":{"S1":8,"S2":10,"S3":69,"S4":15}}
```

```text
> npm run strategy:strict-bt33404708902:causal-selector:selftest
> tsx scripts/disdex-quality102-causal-selector-selftest.ts
QUALITY102_CAUSAL_SELECTOR_SELFTEST_PASS {"s1s2RawGeneratorProven":false,"s34RawGeneratorProven":false,"selectorImplemented":false,"quality102LiveArmed":false,"quality102PositionCap":0.5,"cryptoGrossCap":2,"totalGrossCap":2.5}
```

Additional compatibility/static checks:

```text
> npm run strategy:market:selftest
> tsx scripts/aster-market-data-provider-selftest.ts
ASTER_MARKET_DATA_PROVIDER_SELFTEST_OK
```

```text
> npx tsc --noEmit
(no output; exit 0)
```

All five commands exited `0` in the final pre-commit run.

## Changed files

- `lib/disdex-quality102-causal-v1-signal.ts` — strict causal validation, monthly HIGH_VOL training, source health/ranking/correlation logic, one-slot routing, fail-closed no-signal output.
- `lib/disdex-quality102-causal-v1-market-data.ts` — configured symbols plus BTC, immutable closed-range pagination, exchange timestamp preservation, duplicate/gap rejection, and cache capped at five minutes. The default is 225 days so a decision anywhere in a 31-day month can retain 180 training days plus 14 days of indicator warm-up.
- `lib/aster-v3-client.ts` — optional fourth `AsterKlineRange` argument with `startTime`/`endTime`; existing three-argument callers are unchanged.
- `scripts/disdex-quality102-causal-v1-signal-selftest.ts` — cutoff, omitted-family, HIGH_VOL, deterministic one-slot, active-PENGU correlation, pagination, cache, duplicate, and gap tests.
- `scripts/aster-market-data-provider-selftest.ts` — verifies old calls omit range parameters and ranged calls serialize both timestamps.
- `package.json` — adds `strategy:quality102-causal-v1:signal:selftest`.

## Omissions and concerns

- PB/MR/REV are intentionally absent from LIVE generation. Only their post-generation gates are recovered; `evaluateS34QualityGate` cannot create raw candidates and is therefore not used as a substitute.
- BRK remains entirely disabled because its upstream `strength` formula is unproven.
- The historical 525-to-30 membership revision remains unrecovered. This engine consumes the explicitly configured runtime universe and does not claim historical parity.
- `generateQuality102HighVolSignals` requires a known next-hour entry candle; a live decision has only the just-closed signal candle. The engine uses the same recovered `computeQuality102HighVolFeatures` and `matchQuality102HighVolGrid` conditions directly and does not synthesize a future exchange candle to satisfy that helper.
- Aster range pagination is covered with a protocol-level mock but still needs the later no-write venue preflight. No network or VPS action was taken in Task 2.
- Monthly training is CPU-bound per configured symbol. It is deterministic and bounded, but runtime latency should be observed during later no-write preflight with the full configured universe.

## Self-review

- Confirmed no imports of replay scripts, evidence CSVs, or historical event timestamps.
- Confirmed no changes to legacy capability flags or runtime parity flags.
- Confirmed BTC reference data cannot become a trade candidate.
- Confirmed old `getKlines(symbol, interval, limit)` requests contain neither `startTime` nor `endTime`.
- Confirmed exchange open timestamps are returned unchanged and candle eligibility uses exchange close time `< now`.
- Confirmed `git diff --check` produced no whitespace errors before commit.
