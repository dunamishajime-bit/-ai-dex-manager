# V12 V4 LONG: route-wise initial STOP / profit-protection research (2026-10-21)

> STATUS: RESEARCH_ONLY_NO_DD_IMPROVING_CANDIDATE. No live, Production, VPS, HP or PENGU strategy changes.

## Source contract

- Sample: 2025-08-10..2026-08-10; initial capital JPY 10,000, no contributions after initial funding.
- 8-logics frozen original dynamic economic allocator, signed venue execution NOT simulated.
- 35 symbols, 422 ZIP market archive, 5m modeled STOP and H1 portfolio MTM.
- Source archive SHA256: 10cdc48705a6f9e310cd0aecc95ce781af24325b1a99c2eb9aaefe3bd2953934.
- 10bps is central research estimate; 30bps is cost stress test.
- Alternative Exit changes are pre-admission; the single economic allocator re-executes admission, gross, fills model, fees, funding and MTM.
- No synthetic same-side cooldown created by unadmitted candidate STOP. Existing runtime watchdog, resident stop and Shared Risk have not been changed.

## Full8 baseline

| Cost | Final JPY | PF | max MTM DD | closed trades | V12 LONG wins/losses | average V12 LONG loss JPY |
|---|---:|---:|---:|---:|---:|---:|
| 10bps | 222,818,967 | 3.4588 | -15.6206% | 1310 | 120/22 | -61,770 |
| 30bps | 124,289,207 | 3.0786 | -16.7878% | 1307 | 108/32 | -32,897 |

## 8 source-backed full8 price-model simulations

Positive DD delta means maximum DD improved. All cases are exploratory and post-hoc.

| Targeted exit candidate | ΔDD 10bps | ΔDD 30bps | Equity retention 10bps | Equity retention 30bps | admitted LONG exits 10/30 | losers improved / winners exited early (10bps) |
|---|---:|---:|---:|---:|---:|---:|
| X09_X14_INITIAL_2P5_H6 | +0.0000pp | +0.0000pp | 1.000 | 1.000 | 0/0 | 0/0 |
| X09_X14_INITIAL_2P5_H6_S3 | +0.0000pp | +0.0000pp | 1.000 | 1.000 | 0/0 | 0/0 |
| X09_X10_X14_INITIAL_3P0_H12_S3 | -0.0034pp | +0.0000pp | 1.006 | 0.999 | 3/1 | 0/0 |
| X09_X10_X14_INITIAL_2P5_H6_S3 | +0.0000pp | +0.0000pp | 1.000 | 0.999 | 1/1 | 0/0 |
| Y04_Y13_Y17_INITIAL_2P5_H6_S3 | +0.0000pp | +0.0000pp | 1.001 | 1.001 | 1/1 | 1/0 |
| X09_X14_PROFIT_3P0_FLOOR0P5_T2P0 | -0.1140pp | -0.0189pp | 1.005 | 0.981 | 5/5 | 1/4 |
| X09_X10_X14_PROFIT_4P0_FLOOR1P0_T2P5 | -0.2109pp | -0.0309pp | 0.990 | 0.954 | 8/8 | 0/8 |
| X09_X14_DUAL_INITIAL_AND_PROFIT | -0.1140pp | -0.0189pp | 1.005 | 0.981 | 5/5 | 1/4 |

**Result:** All 8 cases fail the predeclared dual-cost +0.10 percentage-point improvement gate.
The weakest-route Y04/Y13/Y17 initial stop reduced one historical losing LONG in both 10 and 30bps and maintained winning trades, but maximum portfolio DD was unchanged.
The X09/X14 profit guard rescued one loser while exiting four baseline winners early and worsened DD. The dual initial+profit variant produces the same economic result and is not independent confirmation.

## Baseline LONG loss decomposition

- 10bps: V12 LONG 142 positions; 120 wins and 22 losses (84.51% WR); mean MFE +4.27%, mean MAE -1.63%.
- 13/22 losing positions had max MFE less than +1%; 9/22 reached at least +1%.
- An adverse -2% threshold was touched by 13 losing positions **and 26 positions that later won**. Standalone tight STOP can severely damage winners.
- 19 of the 22 10bps LONG losers came from the six routes X09/X10/X14/Y04/Y13/Y17 (45 profitable positions in those routes). Do not indiscriminately disable them.

## Actual portfolio DD peak-to-trough

- Both costs: peak 2025-12-05 19:00 UTC, trough 2025-12-10 23:00 UTC.
- No V12 LONG position overlaps that peak-to-trough. Direct V12 LONG held-risk losses do not create the maximum-DD interval.
- During that interval, two modeled PENGU STOP exits were -54,867 JPY SHORT and -51,801 JPY LONG at 10bps. These are realized-event contributions, not a complete H1 MTM attribution.
- PENGU entry/exit parameters remain unchanged. Portfolio-level risk source must be evaluated separately if significant max-DD reduction is required.

## Research and operational limitations

1. All candidates selected after observing historical LONG losses; results are post-hoc and not an untouched future holdout.
2. The frozen V4 H1/5m model has gap and intrabar ambiguity; true Aster signed fills, partial fills, venue resident STOP and slippage are not certified.
3. This uses the same historic economic allocator and model prices; parity with the earlier independent TypeScript dynamic allocator and current LIVE V4 is not independently proven.
4. A few improvements in *average single trade loss* are not guaranteed portfolio DD improvement, especially if compounded entry equity changed.
5. No candidate passes both 10bps and 30bps maximum DD +0.1pp. **No LONG STOP setting promoted to Production.**
6. Prior PENGU exit settings are not changed and rejected SHORT experimental STOP is not carried forward as if accepted.

## Reproduction and artifacts

- Source script: scripts/dd-reduction/run-task9-v4-long-route-risk-20261021.py
- Synthetic causal regression: scripts/dd-reduction/test-v4-long-route-risk-20261021.py
- Full raw portfolio ledgers, OHLC ZIPs, scenario results are stored only under user Windows research directory (not pushed).
- Compact comparison and hashes are in this directory. The original full8 adapter resolves a local untracked task8 helper; exact re-execution elsewhere requires that frozen helper and archived market dataset.

Decision: KEEP V12 V4 LONG EXIT BASELINE; prioritize differentiated initial-loss diagnostics and a separate portfolio-level DD risk investigation. Research only.

## Independent exact-repeat check

- Replayed the best isolated initial-stop candidate and profit-protection candidate in a second independent output directory with the same frozen 8-logic source.
- **20/20** full candidate-decisions, portfolio-trades, portfolio-events, task9-mtm and metrics JSONL/JSON file SHA256 hashes matched exactly (two scenarios x two costs x five files).
- Full verification hashes are saved in V12_V4_LONG_INDEPENDENT_REPLAY_SHA_PROOF_20261021.json. Venue signatures are outside this research scope.
