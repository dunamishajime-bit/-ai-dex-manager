# RESIDUAL複合ロジック：全8ロジック動的統合BTの最終判断（2026-10-23）

**STATUS: RESEARCH_BALANCED_NO_DOGE_CANDIDATE / NO_LIVE_CHANGE**

## 結論

DOGE・AVAXの新入口を75構成以上で試したが、高い勝率・PF・DD・取引件数を保つ安定した新たな複合入口はなかった。一方、**既存8ロジックの採択候補を再計算してDOGEのRESIDUALだけを遮断し、AVAX側を存続する**構成は、10bps・30bpsで最終資産・PF・最大MTM DDが改善し、年間取引件数を98%超維持した。

**研究上の選択:** NO_DOGE（RESIDUAL DOGE entry veto only）をバランス最優先候補とする。既存のV12/Q102/PENGU/IDLE/FET/V52/HYPEおよびAVAXの原本は変更しない。本番採用・発注は未承認／未実施。新DOGE LONG/SHORT複合案は現時点では採用しない。

## 固定された再生条件

- Source repository: dunamishajime-bit/-ai-dex-manager
- Parent research SHA: e1f2088574c933dab388d26ed3c113ad47c72321
- Replay: scripts/dd-reduction/research-residual-full8-ablation-20261023.py
- Baseline: 2025-08-10〜2026-08-10、10/30bps、10/22 HYPE・IDLE・FET exit＋AMZN Yahoo前日比+1.0% SHORT vetoを引き継いだnative 8ロジック研究BT（10bps最終資産247,438,945円、1,298件）。**これは2026-10-05の40.67億円アンカーや現在のVPS Productionの正本ではない。**
- V52 source 99 rows (88 closed/11 originally rejected): original suppressed 11 candidate events are NOT regenerated. Existing stock tape SHA pinned.
- Full8 allocator owns capital and account locking in research model; candidate filtering is applied before wallet admission then V12 cooldown reselection until convergence.
- Every case converged after three passes with accounting PASS. Baseline at both costs reproduced exactly including ledger SHA256.
- Research is historical H1/5m based price-model, **not** certified Aster exchange L2 book/slippage/funding/margin/position-protection lifecycle. Does not establish current LIVE code parity or unvisited holdout.

## All four cases, full8 result

|Case|10bps final asset JPY|10bps gain vs baseline|10bps trades|10bps PF|10bps MTM DD|30bps final asset JPY|30bps gain vs baseline|30bps trades|30bps PF|30bps MTM DD|
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|BASE_REPLAY|247,438,945|0|1,298|4.1254|−14.6033%|144,336,413|0|1,297|3.4650|−15.8077%|
|NO_RESIDUAL|259,925,587|+12,486,641|1,266|4.5767|−14.5150%|154,587,146|+10,250,733|1,267|3.7116|−15.8099%|
|**NO_DOGE (recommended research candidate)**|**258,560,040**|**+11,121,095**|**1,280**|**4.5435**|**−14.5150%**|**151,885,081**|**+7,548,668**|**1,280**|**3.6940**|**−15.7990%**|
|NO_AVAX|244,060,949|−3,377,997|1,282|4.1477|−14.6033%|144,317,987|−18,426|1,286|3.4775|−15.7783%|

NO_DOGE retention: 10bps 1280/1298 = 98.613%; 30bps 1280/1297 = 98.689%. The loss of 17 DOGE fills does not translate to precisely 17 fewer total trades because dynamic wallet reselection changes other runners; AVAX RESIDUAL entries increase from 13 to 15 on both cost tests.

Integrated win rates estimated from modeled positive PnL ledger:
- 10bps baseline 939/1298 = 72.34%; NO_DOGE 928/1280 = 72.50%.
- 30bps baseline 902/1297 = 69.55%; NO_DOGE 894/1280 = 69.84%.
Do not extrapolate historical rates into forward 70%.

## Selection logic / tradeoff

**Balanced research gate:** total count retention ≥98% of same-cost baseline, positive ending-equity delta in both costs, both-cost integrated PF non-decreasing and mark-to-market DD non-worsening; preserve all other existing logic definitions and actual portfolio ownership reselection. No primary/fallback strategy may be created from invented candidates.

- NO_DOGE: passes all historical balance metrics, despite approximately 1.3–1.4% lost total trades.
- NO_RESIDUAL: improves equity the most but count retention is only 97.535/97.687%; 30bps DD worsens slightly by 0.00219 percentage points.
- NO_AVAX: loses money at both costs, despite modeled standalone AVAX PnL not clearly profitable in the original ledger, showing account ownership effects.

The improvement of NO_DOGE accrues mainly in the later half of the same historical year. Analysis of ledger modeled-JPY contributions by half shows 10bps first-half sum is ~91,575 yen lower than baseline and later-half sum is ~11.32 million yen higher. This is **not** an untouched out-of-sample test. Historical cherry-picking and regime shift risks remain.

## Prior compound-entry research was rejected

- 27 high-win entry rules ×12 exits + 54 basic composite combinations + 21 symbol-adaptive composite combinations generated novel M5 candidates independently.
- The best high annual win rate AVAX SHORT 75% / 56 trades failed 30bps PF threshold and late-period performance; the further tail test failed.
- Large fallback combos could add up to 411 annual independent candidate trades but reduced 30bps PF below 1 and blew up closed-trade DD. The best balance of this family added ~165 trades but did not survive 30bps later sample.
- Therefore, simply adding those fallback routes to full8 would have no justified positive expectancy. Their output should NOT be interpolated into the full8 numbers above.

## Status and blockers to any production adoption

- Research code only, current LIVE untouched, no orders/cancels or service restarts.
- Full8 model is source-frozen and partially relies on selected historical V52 99-row tape with 11 events not regenerated.
- Must verify latest running VPS SHA and actual route config, recover all causal rejected raw candidates and same engine/cost/reselection for parity, venue signed fills/STOP reconstruction and capital/position ownership, and compare untouched forward shadow/regime segments before promotion.
- The user requested a **high-frequency + high-winning composite**: current evidence supports **dropping negative-expectancy DOGE RESIDUAL**, not creating a new unproven extra strategy. The original strong 8-logic composition remains high frequency, about 1280 annual fills.

**Recommendation:** Record NO_DOGE as the only candidate for subsequent formal parity and Forward Shadow; do not adopt a new DOGE/AVAX entry/exit, and do not change LIVE yet.