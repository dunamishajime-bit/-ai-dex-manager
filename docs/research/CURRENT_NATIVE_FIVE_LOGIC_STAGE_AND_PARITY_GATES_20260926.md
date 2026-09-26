# Current VPS five-logic historical integration: immutable old-engine staging and parity gates (2026-09-26)

**Status: SOURCE-NATIVE V12/FET SIGNAL RECOVERY VERIFIED; FULL CURRENT FIVE-STRATEGY BT NOT VERIFIED.**

## Provenance (do not fit target profit)

- Frozen original integrated engine SHA-256 `cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d`. Regression gates: Sep18 restored NORMAL JPY 165,415,076.53599954; SEVERE JPY 22,177,854.10721198. Original 2026-09-26 PENGU Q60 DD17/H72 substitution normal JPY 318,749,762 approximately and severe JPY 33,887,246 approximately. These are archival pairwise controls, **not current LIVE parity**.
- Source byte-matched to actual VPS, commit `e1b58060d6263a3af7ced51bec854d3e211d2f35`, 207 files, zero differences in read-only manifest from Actions 36219061208.
- Native current `lib/v12-x1-all.ts::buildV12Signals` and `lib/fet-brk48-signal.ts::buildFetBrk48Signal` executed on 15 Aster H1 historical symbols. The first adapter incorrectly started the 160x2H eligible streak at the evaluation period rather than before it, silently excluding the first ~7 calendar days. Patched research-only adapter and reran Actions **36220005083: PASS**. Corrected source-native V12 candidates **1,459** (Rank1 904; Rank2 539; Rank3 16; HC1.75 208); FET candidates **26**. Aster FET H1 begins 2026-01-09, so no invented FET trading before that date.
- Source-native output artifact 10898756386; archive SHA-256 `68e36ce47ea79d94ce5074682b8bd3ace6920caded0060ff2f2367bda6f187bc`. Candidate signals are **not** actual fills or an integrated BT.

## Original-engine staging vs actual current VPS contract

Research-only adapter: `scripts/research/stage_native_current_v12_in_old_engine_20260926.py`; read-only workflow `.github/workflows/native-current-staged-old-engine-20260926.yml`. It pins the same original source SHA, first replays original baseline with a hard equality check, next replaces the native PENGU ledger, next replaces source-native V12 entry signals + an explicitly labelled H1-OHLC exit approximation. It derives independent FET H1-OHLC entry/exits for diagnostic review only. It does **not** fabricate a fifth FET sleeve or rename the old Q102 frozen trades as causal V4. Its archived V52 inputs remain the old historical stock reconstruction.

Current source-pinned production policy (inspect exact pinned files before any full integration):
- V12 maximum 3 positions, Rank3 min score 0.70 and gross 0.10x, HC multiplier 1.75, V12 aggregate base/dynamic 2.0x, risk per trade 3.19%, ATR stop 2.477 / TP 3.1995 / trailing 0.4.
- Native PENGU Q60 same-route quarantine 60h, realized -17% DD / 72h governor, every order gross 1.0x, COMBINED_FILTERED fixed.
- FET BRK48 LONG volume > 1.2× 72h median, 24-hour hold, hard stop -5%; after +5% stop moves to +0.5%, portfolio gross cap 2.25x and preemption by core strategies.
- Q102 Causal V4 family gross HIGH_VOL 1.661, MR 1.0, BRK 2.465, REV 2.5, PB 2.5, max 3.0x with DD <=0.30% governor, one slot; **causal 181-day rolling history** and selector output required for a current source-faithful replacement. Historical frozen 102 rows are NOT current Causal V4 evidence.
- Actual current V52 V50 policy `V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20`: slot 2.0x, stock aggregate 4.0x; archived V50 B75 raw candidates do not meet native current parity by construction.
- Current normal crypto gross 3.0x and total 4.25x; absolute hard ceilings crypto 5.0x/total 8.0x. Dynamic expansion requires source-native integrated profit/DD/margin governor and available balance reserve >=15%. Old engine static 3.0x/3.5x pairwise replay is not the current governor.

## Full current five-strategy acceptance checklist

1. Original engine source checksum and original baseline normal/severe exactness must pass before any source swaps. The old engine is never replaced with an unrelated profit-fitting calculation.
2. Native current V12/FET/PENGU/Q102 Causal V4/V52 signals generated with prior-time-only data; new Causal V4 should have >=181 days of actual contiguous hourly history before candidate admission. Admit a symbol only from its actual available-history date.
3. Verify exit timing and price independently per sleeve, including max hold, stop priority, trailing evolution, fee/funding/slippage, FET profit floor and preemption, Q102 family-specific stop and all source-native stock policies.
4. Integration must implement FET as its **own** position/ownership sleeve, Q102 Causal V4 not frozen CSV, and actual dynamic profit/DD/margin Governor; verify FET/Q102/V12 shared exposure and priority/read-back. Static cap sensitivity only is not LIVE parity.
5. Run NORMAL/SEVERE from 2025-08-10 inclusive to 2026-08-10 exclusive, initial JPY 10k plus 12 x JPY 10k monthly (total contributions JPY 130k). Export complete event ledger, per-logic PnL, all monthly asset points, PF, closed-event and marked-to-market DD, worst-case gross, missing-history diagnostics, source SHA/digest and test logs.
6. Reject any final claim if a new suite merely matches an old target final yen amount, mixes September and August ledger parameters, silently fills missing pre-listing prices, or claims current LIVE parity from only source-native signal candidates.

**Until all gates pass:** report stage output only with explicit unmapped semantics. Do not use staged yen figures to configure LIVE risk or leverage.
