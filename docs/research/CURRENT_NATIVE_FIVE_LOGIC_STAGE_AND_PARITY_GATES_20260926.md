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

## Completed pinned staged workflow 36220153847 (PASS staging; NOT full current LIVE)

The workflow consumed corrected native current VPS signals from Actions 36220005083 without refetching or fitting historical return, reloaded the **same unchanged checksum-frozen original integrated Python engine**, and reproduced both original baseline amounts exactly. Replacing only PENGU also reproduced earlier independently verified substitution amounts exactly.

| Paired control, JPY | NORMAL ending JPY | NORMAL PF | NORMAL closed-event DD | SEVERE ending JPY | SEVERE PF | SEVERE closed-event DD |
|---|---:|---:|---:|---:|---:|---:|
| Original archived engine/ledgers, initial JPY 10k + 12 x JPY 10k | 165,415,076.54 | 4.104 | -12.84% | 22,177,854.11 | 2.929 | -26.05% |
| Same source, only Q60/DD17 H72 COMBINED_FILTERED PENGU gross 1x | 318,749,762.47 | 4.079 | -15.67% | 33,887,246.27 | 2.868 | -33.10% |
| Same source + source-native current V12 Top3/HC1.75 signal candidates with **H1 OHLC exit approximation**, old frozen V52/Q102, static gross crypto 3.0 / total 3.5 and old stock 1.5 | 100,502,012.86 | 3.59966748 | -15.27696675% | 11,263,933.37 | 2.47068859 | -37.01301058% |

This final row is **only a partial sensitivity test**, **not a five-logic result**. It deliberately excludes FET from integrated routing (although FET source-native 26 candidates generate 19 independent H1 exit-assumption trades), uses the OLD FROZEN Q102 historical trades, uses old V52 B75 data instead of current B60, and has no profit/DD governor. Its new V12 exits are H1 OHLC assumptions, not a replay of actual LIVE order/read-back or funding. **Do not conclude from the 100.50m / 11.26m sensitivity test that the new full LIVE strategy produces those amounts or has those DDs.**

Candidate-to-assumed-trade diagnostic: V12 source-native candidates 1,459; V12 H1-OHLC simulated rows NORMAL 894 / SEVERE 895, then original engine admits NORMAL V12 884 / SEVERE V12 886. FET source-native candidates 26, 19 independent H1-OHLC positions in each mode, not added to the old engine. Old original baseline gross-conflict check and stage new-V12 run both report zero Q102 supplement gross conflicts.

Stage result artifact: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36220153847/artifacts/10899216129

**Current full-source 5-logic result remains OPEN and must not be labelled completed until native Q102 Causal V4, source-native current V52 B60, independent FET sleeve and actual dynamic profit/DD/margin governor are integrated with verified fill/protection semantics.**


## Continued remaining-work audit: source-only additional completions (2026-09-26)

Research branch includes all source-only scripts; original integrated-engine.py bytes and historical original inputs remain unchanged. No VPS/production trading mutations.

### Native Q102 Causal V4 per-symbol signals and actual Aster intrahour marks

- Pre-existing independently acquired SHA-pinned raw public archive: raw JSON SHA256 `8e416fe25a9c9e722c428062589151bbd0d8dda4fc98ed4bdb53154a9fe3d7fe`, current effective VPS source `e1b58060d6263a3af7ced51bec854d3e211d2f35`. Archived native Q102 replay run [36203478622](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36203478622), artifact `10893132316`, **109 complete native signal+exit candidates**, verified 5400-hour contiguous per-symbol admission. This is not an actual integrated-portfolio order ledger.
- Follow-on [actual Aster 1-minute retrieval](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36222150951), artifact `10899511947`, independently fetched and verified **15/15** previously off-hour Q102 MTM mark timestamps (on Aster V3 1m, not Binance Vision). No price interpolation or invented rows.
- Offline source-checksummed original integrated engine Q102 paired sensitivity uses 109 actual native Q102 candidate exits plus the native PENGU ledger and current V12 signal/H1-exit *assumptions*, but still frozen OLD stock B75, no FET admission and static crypto3/total3.5 caps. Same old engine SHA256 `cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d`. Q102 admitted NORMAL **23**, SEVERE **25**. Gross conflicts **0/0**; original engine cash/event/monthly JPY reconciliation passes with residual `<0.03 JPY` in both scenarios.
- This NON-FORMAL diagnostic produces NORMAL JPY **7,309,682.24**, PF **2.91690824**, closed-event DD **-35.54902255%**; SEVERE JPY **965,509.23**, PF **1.88331461**, DD **-41.92471912%**. These are **NOT** current VPS or exact five-logic results; they cannot support capital/risk decisions, primarily because Q102 native *candidate* construction had hypothetical base-idle occupancy, FET/stock/governor are not parity-replayed, and V12 fill/exits remain H1 OHLC approximations. The old frozen-Q102/stock baseline values must not be compared as if all else were equal.

### Original stock V50 source invoked with current B60/C20/STOP1.75 and verified Yahoo+Aster public market

- Original V50 research function `research_lab_aster_only_v50_post_open_basis_engine::build_raw_trades`, checkout SHA `04c1a369223bd27e9e42bc93604b3777b9230d92`; **current** runtime `V50_B60_C20_STOP1.75_EDGE7.5_COST60_SPREAD20` loaded from pinned `e1b580...` actual production config. No replacement rule fitted to yen profit.
- Read-only workflow [36221915231](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36221915231), artifact `10898583537`, successful after fixing exact legacy `AMZNUSDT` stock symbol identity. Original research generated **206 price-only** B60 candidates across **248** aligned Yahoo/Aster historical sessions; **183** pass a *hypothetical* 40-bps proxy cost threshold. **191/206 source Aster 30-minute volume bars are ZERO**; of 15 positive-volume candidate bars only **10** also pass the proxy-cost test. Zero volume on these bars does not prove fill impossibility, but native production bid/ask spread, depth 2x, ten-second preentry snapshot, stale-reference checks, post-only maker fills, funding and real order sequencing are **NOT recoverable** from OHLC and missing order-book snapshots. Even 10 candidates cannot be treated as actual admitted fills without venue evidence. Therefore actual current V52 stock-native parity is explicitly blocked; do not inject all 206 OHLC candidates into a formal old-engine portfolio and describe them as filled.
- Original standalone stock B75 historic input is preserved separately; no silent B75-to-B60 replacement claim.

### Source-native margin / DD governor tested; historical portfolio replay still absent

- Actual production exports `resolveIntegratedGrossGovernor` and `quality102GovernorGross` passed eight **synthetic input boundary tests** in [workflow 36222060129](https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36222060129), artifact `10899541777`. Static BASE crypto3.0/total4.25 with 15% balance reserve; stage PROFIT_1 reserve12.5%, PROFIT_2 reserve10%, PROFIT_3 reserve5%, PROFIT_4 reserve0. Profitable tier caps are additionally bounded by 5x Cross available collateral: with equity1000/available1000/currentTotal0, even PROFIT_4 reaches total **5.0x**, not theoretical total8.0x hard limit. Q102 DD<=0.30% boosts example HIGH_VOL gross1.661 to3.0; stale DD or DD0.31% keeps1.661. No historical account equity, available collateral, source-complete daily net PnL, unrealized fills, orderbook, 120-second freshness, or actual Q102 owner sequencing was reconstructed by these synthetic cases.
- Full-source five-sleeve integrated backtest remains **BLOCKED_ON_MISSING_EXECUTION_EVIDENCE_AND_ORIGINAL_ENGINE_FIFTH_SLEEVE_ADAPTER**. Passing pure-function unit tests or archive parity is not historical event-admission replay.


## Continued research: native Q102 exact Aster MTM + current V52 B60 + FET collision audit (2026-09-26)

**Research only. Source engine still pinned byte-for-byte SHA256 \`cae9785492ea5dda8173853fe2cbc7d99ea451f550a739fb7f014f4773d9899d\`.** The 2025-08-10 to 2026-08-10 contribution schedule remains initial JPY 10k plus twelve JPY 10k additions. Current VPS source is \`e1b58060d6263a3af7ced51bec854d3e211d2f35\`. New independently audited market source raw SHA256 \`8e416fe25a9c9e722c428062589151bbd0d8dda4fc98ed4bdb53154a9fe3d7fe\`.

1. **Native Q102 V4:** The independently sourced 5400H-per-symbol native source run \`36203478622\` yielded 109 candidates with complete exit windows. After source-authenticated Aster H1 candidate entries and 15 exact Aster V3 1-minute intrahour MTM marks, the original engine accepted 23 NORMAL / 25 SEVERE entries; absent FET and B60, this partial sensitivity ended JPY 7,309,682.24 NORMAL / JPY 965,509.23 SEVERE, with closed-event DD -35.549% / -41.925%. These are not current-LIVE portfolio parity results.
2. **Current B60 V52:** Original V50 research code and *current* frozen B60/C20/STOP1.75 thresholds applied to new Aster 30m and Yahoo 60m historical OHLC. Raw candidate count 206; 191 have **zero Aster volume at historical entry bar**, 15 nonzero. Historic venue bid/ask, depth and exact execution/funding are not available: zero-volume signals must not be assumed filled. The B60/old-V11/full-Q102 comparison uses stock aggregate 4x, per-stock-slot 2x and shared crypto 3x/total 4.25x **static sensitivity**. Extra exact ENAUSDT Aster V3 1-minute open \`1781717400000 => 0.0933\` fetched read-only via successful Actions \`36222343481\`; 16 total source-exact intrahour Q102 MTM marks now known for the B60/nonzero-volume scenario.
3. **Exact original-engine stage controls:** Old native-Q102 + old-B75 checkpoint re-ran to exact prior amounts. Instrumenting entry-occupancy logging produced **the same complete closing-event ledger and assets** as the unmodified source in both NORMAL and SEVERE. Zero supplement gross conflicts in all completed static B60 branches. This verifies historical source pairing, **not order execution, historical leverage/margin, live DD governor or FET fifth-sleeve parity**.

| V52 B60 candidate allowance with native Q102 & no integrated FET | NORMAL ending JPY | NORMAL closed-event DD | SEVERE ending JPY | SEVERE closed-event DD | |
|---|---:|---:|---:|---:|---|
| All 206 price-only candidates, **not executable** | 14,545,916.59 | -29.7853% | 965,509.23 | -41.9247% | Explicitly inadmissible as current LIVE |
| **15** positive observed 30m volume only; old engine admitted **9** V50 trades | 9,612,235.31 | -31.0685% | 965,509.23 | -41.9247% | Partial sensitivity only; bid/ask/depth/funding still unknown |
| New B60 zero-admission control (retain only old archived V11_EQ) | 8,143,251.61 | -31.5091% | 965,509.23 | -41.9247% | Conservative exclusion bound in this model |

**Caution:** SEVERE's old engine stock cost assumption 100bps exceeds source V50 maximum tradeable cost 60bps, therefore zero V52 trades in all three SEVERE runs. SEVERE does **not** prove stressed live V52 execution. The logged DD is *closed-event* TWR DD, not continuously marked-to-market margin DD. NORMAL at 15 positive-volume candidates includes 882 V12 trades, 69 PENGU, 59 V52 including archived V11_EQ (9 current B60 V50), plus 37 native-Q102 realized/partial-resize events; the Q102 sleeve's JPY contribution is **negative** in this static partial run. This is scenario-dependent and is **not a basis for unverified LIVE logic changes**.

4. **FET fifth-sleeve source conflict audit:** Native FET source generated 26 historical candidates and 19 independent H1-price exit-approximation trades. An **instrumentation-only** version of the old engine captured actual accepted entries without changing a single asset result or exit event. Of 19 FET independent holding windows, **7 contain accepted new core trades in each scenario**. NORMAL: 20 core admissions inside those windows (V12 17; PENGU 2; STOCK 1). SEVERE: 19 (V12 17; PENGU 2). The native FET residual-preemption contract therefore matters; blindly inserting 19 full-Gross FET positions without same-time market-mark/reduce-only and STOP rebuild would misrepresent the current strategy. No fifth-sleeve portfolio return has been claimed from this collision audit.
5. **Profit/DD/margin governor:** Read-only pinned production boundary test \`36222060129\` verifies nominal base caps crypto 3x / total 4.25x; profit tiers expand under source-validated eligible profit, DD and margin (hard caps crypto 5x / total 8x); Q102 portfolio governor <=0.30% raises its gross to max 3x only with a fresh valid source state. It is a **synthetic boundary test**, not a historical wallet, mark-to-market drawdown or available-balance replay. The missing historical inputs must not be replaced with final-return fitting.

Remaining formal acceptance gates: construct true source-native historical FET fifth-sleeve preemption and read-back/price rules, source-verifiable V52 liquidity/cost/fee/funding (or clearly exclude unobservable positions), source-native historical Q102/portfolio real-time occupancy and fresh realized DD state, 5x Cross available margin and full continuous MTM DD/funding. Retain exact pinned baseline regression, complete 13-contribution ledger, source timestamp/digest and full per-sleeve event/monthly outputs. **Until those pass, no number above is the full present-VPS 5-logic formal BT. Production and VPS have NOT been modified; no orders were sent.**
