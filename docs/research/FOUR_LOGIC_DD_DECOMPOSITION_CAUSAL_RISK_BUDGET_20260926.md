# 2026-09-26: Four-logic DD decomposition and prior-only risk-budget sensitivity (RESEARCH ONLY)

## Non-negotiable source provenance

This is an in-sample **sensitivity study, NOT a new formal live-execution BT or a production release**. Freeze old integrated source byte SHA256 `cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d`; pinned effective VPS source `e1b58060d6263a3af7ced51bec854d3e211d2f35`; independently acquired Aster/Yahoo source raw SHA256 `8e416fe25a9c9e722c428062589151bbd0d8dda4fc98ed4bdb53154a9fe3d7fe`. Baseline source details and exclusion/limitations: [FOUR_LIVE_SOURCE_RULES_BT_V52_EXCLUDED_20260926.md](./FOUR_LIVE_SOURCE_RULES_BT_V52_EXCLUDED_20260926.md).

Exact same 2025-08-10 to 2026-08-10 12-month period, JPY10,000 initial + JPY10,000 monthly x12, JPY130,000 total contributed, NORMAL and SEVERE. V52 **zero trades and zero PnL** in every case. Source-native V12 Top3 candidate generation with historic H1 exit approximation, PENGU requested COMBINED_FILTERED Q60/realized DD17/H72 source ledger, Q102 causal V4 per-symbol historical source-native 109 signal candidates with native hardStop fields, FET BRK48 24h/-5%/+5→+0.5% H1 exit proxy and full conflict-close conditional on nonzero observed historical public Aster 1m volume. All research adapters modify **only isolated in-memory source at checksum-unique anchors**. No edit to immutable original, no actual trading order or LIVE parameter update.

## Actual historical drawdown contribution

NORMAL original four-sleeve closed-event TWR max DD **-45.685749%**, H1-OPEN marked crypto DD **-46.341681%**. Between closed TWR peak 2026-07-06 and trough 2026-07-30, approx JPY5.038m loss: Q102 -JPY2.577m (51%), PENGU -JPY1.363m (27%), FET -JPY0.893m (18%), V12 -JPY0.205m (4%). SEVERE original final JPY1,231,256.71, closed DD -52.630397% and H1 DD -52.989602%. Q102 source-native BRK gross2.465 * native hard stop8% = 19.72% account loss exposure at intended stop, before gap/slippage. FET2.25*5% = 11.25%. A 7.5% UTC daily NEW-ENTRY latch is not an absolute maximum account DD or guaranteed native flatten stop.

## Native-stop risk-budget design, preserving all FOUR candidate sleeves

The Q102 sizing alternative uses its **native source signal's hardStop known at entry**, not future losses: `requestedGross = min(original native family requestedGross, perEntryAccountStopRiskBudgetPct / nativeHardStopPct)`. E.g., if risk budget1%, BRK8% stop has cap0.125x, HIGH_VOL10% stop0.10x, MR7% stop0.142857x. No symbol/date filter or disabling Q102; source signals and one-slot/base-idle condition unchanged. Incoming FET/PENGU caps are explicit *counterfactual* modifications to current production, not a claim of current LIVE behavior.

A second alternative throttles **future NEW orders ONLY** after **previously realized** TWR DD reaches 5% from its causal peak, restoring original trial caps after recovery; preexisting positions are NOT flattened by that added rule. In-memory native source price, requested gross, allocation conflict, day-risk read-only observational hooks, 8,760 H1 MTM samples NORMAL and SEVERE and all 13 monthly points unchanged by H1 observers.

## Matched research sensitivity

All DD columns are **crypto-only 8,760-hour Aster H1 OPEN observed DD**, except the separate closed-event column. NOT worst intrahour, historical executable bid/ask, account margin path, or formal live replay.

| Condition | NORMAL final JPY | NORMAL PF | NORMAL closed DD | NORMAL H1 DD | SEVERE final JPY | SEVERE PF | SEVERE closed DD | SEVERE H1 DD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Unchanged four-logic source-staged baseline | 6,077,702.63 | 2.64305 | -45.68575% | -46.34168% | 1,231,256.71 | 1.84651 | -52.63040% | -52.98960% |
| Native Q102 stop-budget1.5%, always FET/PENGU0.5x | 1,711,588.74 | 2.76463 | -15.30202% | -15.815% | 544,119.57 | 1.78209 | -18.34152% | -18.947% |
| **Native Q102 stop-budget1%, FET1.0x/PENGU0.75x until prior realized DD>=5%, then both0.5x** | **3,437,701.14** | **2.98947** | **-15.35168%** | **-16.019%** | **840,104.45** | **1.94088** | **-18.49710%** | **-19.208%** |
| Native Q102 stop-budget1%, FET0.75x/PENGU0.65x until prior realized DD>=5%, then both0.5x | 2,560,356.63 | 2.90636 | -14.89471% | -15.504% | 715,206.34 | 1.88335 | -17.99399% | -18.667% |
| Same as preceding, but trigger at 8% prior DD | 2,549,723.08 | 2.88480 | -15.68836% | -16.292% | 731,811.66 | 1.88304 | -18.98833% | -19.652% |
| Q stop-budget1.5%, FET1/PENGU.75→both.5 at DD5% | 3,406,837.31 | 2.96007 | -16.42989% | -17.089% | 831,419.76 | 1.92810 | -19.58254% | **-20.285%** (breaches 20%) |

Four retained cases above still admit Q102 24 NORMAL and 25 SEVERE source-native entries. In Q-budget1% + DD5% FET1/PENGU.75 case, NORMAL per-sleeve PnL: V12 +JPY2,130,769; PENGU +JPY1,067,060; Q102 -JPY72,431; FET +JPY182,303; SEVERE V12 +JPY387,842; PENGU +JPY276,309; Q102 -JPY19,390; FET +JPY65,343. Sum +JPY130,000 deposits reconciles every final total within JPY0.05.

### Qualification crucial for operational risk

These are **in-sample** single-year counterfactual trials obtained after decomposing this very same year's July drawdown. Neither NORMAL nor SEVERE is a held-out external future period. The 19.208% stress H1 observed DD has <0.8 percentage-point apparent headroom versus target20%, before unknown intrahour extremes, executable broker slippage, protective stop and kill-switch execution, funding double-count risk, true sourceComplete and actual native dynamic Governor state. Even 18.667% offers <1.34pp margin. Source-native actual profit Governor normally expands gross under strong prior TWR/profit and 120s freshness; the **new DD5% shrink rule does NOT exist on current VPS and has not been deployed**. Exact live V12/FET stop fills/read-back and 10-minute HOLD_PROTECTED require absent historical broker/orderbook evidence. Do not change real risk parameters from these observations alone.

### Reproduction

Results, original source snapshot, one-year independent four-sleeve source evidence, 28 simple sizing trials, 36 keep-four/cooldown trials, 12 native-stop Q risk trials, 18 prior-only TWR-throttle trial outcomes, 8,760h hourly parity tests for the selected cases, 13-month cash evolution, event-per-sleeve reconciled source ledgers, Japanese graphics, scripts and each-file SHA256 manifest are in the conversation artifact `BT_DD_REDUCTION_FOUR_LOGIC_RESEARCH_20260926.zip` (incremental package). Earlier full unchanged-input archive: `BT_FOUR_LOGIC_SOURCE_RULES_V52_EXCLUDED_20260926.zip`. The current research GitHub branch stores audit summaries, **not the private-conversation ZIP or its extracted source scripts**.
