# PRISM VII P31 — 回復確定まで完全に同じPENGU/BTC過去でも二段目急落を予測できず、P30一律決済は利益破壊の危険

**研究のみ。本番不採用。** P29ではCAPITULATION直後のP25無条件EXITがCONTINUE_DOWNの勝者利益を25pp損なう反例を発見。P30ではそれを避けようと、CAPITULATION後のPENGU確定M5陽線+1%以上の回復およびBTC同期M5終値+0.5%以上を確認してから次M5 OPENでBUYする。P30は人工3+1レジームで元下落継続勝ちを守ったが、**実SOURCEでは買い戻し確認が遅く、DDは25.23%に悪化、目標DD20%不合格**。その後の回復確定自体が一般化できるかをP31で反証した。

## 完全に同一の過去と、決定できない未来

前処理SOURCE p25 元PENGU SHORT entry 0.022617 USDT、2025-10-10 21:15UTC PENGU M5 OPEN0.022617/HIGH0.023038/LOW0.010000/CLOSE0.010000＋BTC同時CLOSE104694.7を全未来で固定。その次の21:20～21:25の人工M5も全て同じ：

- PENGU OPEN0.010000,HIGH0.010750,LOW0.009950,CLOSE**0.010700** (7%回復),正出来高100000/takerBuy50000。
- BTC OPEN104694.7,HIGH105800,LOW104600,CLOSE**105500**（shock CLOSEから+0.77%回復）、正出来高1000。
- P30はこの**完了足の21:25UTC**で初めてRECOVERY_CONFIRMEDに遷移し、次のpositive M5 OPENが21:25 / 1本目なら全部 `0.010700`。SOURCE reference STOP72も同じ2025-10-10既知entryから追跡。ここまでのPENGU/BTC source人工M5 **全世界に共通のSHA**がsummaryに存在し、未来が回復/続落するレジームラベルは決定関数には渡さない。

**21:25UTC以降だけ**3未来へ分岐させる：
- `RECOVERY_CONTINUES` PENGU0.010700からtarget0.021へ指数tau1Hで回復。
- `SECOND_LEG_CRASH` 0.010700→0.004へ指数tau24Hで下落。
- `SECOND_LEG_FAST_CRASH` 0.010700→0.004へ指数tau1Hで急落。追加高速未来の事前固定は元P31実験に入る**前**にP31AとしてGitHub保存済みで、SOURCEトレーリングによる先行決済も含めて厳しく反証した。

3未来×8決定論的位相seed×3印字マスク=**72人工未来**、2正印字EXIT遅延×10/30bps×追加滑り0/100/1000bps=**864個票**。未見の実市場ではなく、独立した市場標本でもない。source P30 `detect_buyer_recovery` 関数を**そのままimport**、判断タイミング・ルール値を改変しない。価格代理ENTRY/EXITは元source runtimeの本人signed fillsではない。

## 決定的な反例（人工世界/30bps/追加滑り0/回復確認後1正印字OPEN）

| 21:25以降の人工未来 | 同じsource REFERENCE_STOP72 EXIT net | P30買い戻し確認後のEXIT net | 差 | 元SOURCE勝者の利益を削る人工位相 |
|---|---:|---:|---:|---|
| **RECOVERY_CONTINUES** | +32.2723% | **+52.3905%** | +20.1182pp | 0/8 |
| **SECOND_LEG_CRASH（緩やか）** | **+53.1083%** | +52.3905% | −0.7178pp | 8/8 |
| **SECOND_LEG_FAST_CRASH** | **+82.0297%** | +52.3905% | **−29.6393pp** | **8/8** |

3世界は**入口の価格だけでなく、ショックと買い回復の確定時刻、当時のPENGU/BTC M5価格・出来高・P30状態と次M5 OPEN価格まで同じ**。その同一情報である21:25時点には、以後急落するか回復するかを区別する情報は存在しない。出口の意思決定を同一ルールで行う以上、片方で+20pp有利、別の未来では元の正しいSHORTに対して−29.6pp不利となる。**今見えている最初の陽線・BTC同時回復だけでは原SHORTの大きい利益を保証して守る出口は作れない**。これはP25/P30の初期判定を多層化しても根本的に残る将来不確実性を示す。

## 結論と研究の次段

- P30改良には人工世界での「順行しているだけなら元SOURCE STOPを維持する」メリットがあるが、反発後の再下落（同一過去）ではその後続巨大な勝ちを削る。**P30の一律BUYER_RECOVERY_CONFIRMED→EXITは一般LIVE化不可**。
- PENGU元native SHORT V20 53自然候補/29勝24敗、別S4研究H1 setup120/21参考決済15勝、価格代理REFERENCE_STOP72と本来元native phase stopが違うことを保持。S4本体の80%以上達成は不可、他Runner Gross/Portfolio DD<=20も本研究からは証明できない。
- 次に試験するべきなのは**一律EXITの閾値をさらに複雑にすることではない**。取引中の確定可能な価格情報で`CAPITULATION -> LIQUIDITY_STRESS -> PENDING_RECOVERY -> TREND_RESTORED`などの状態を観測しつつ、(a) 部分利確で元勝者利益を壊したP19の再発を避け、(b) SOURCE STOPが権限通り有効に維持され、(c) 実市場のASK/気配板・positive M5 OPENの約定可能性を照合し、(d) 既見相場と人工相場を除いた真正OOSと70/80%勝率/portfolio DD20%の保守的な検証を必要とする。再び人工世界に合わせた即席閾値調整は過学習になるので行わない。
- ユーザーが認めた銘柄別候補gross0.75/1.0/1.25のうちP28で0.75基本条件DD16.95%は確認したが、3正印字遅延だけでDD20.47%に悪化、1000bps slipでは23.87%なので安全ゲート未達を維持する。

## GitHub再現証跡

- 事前登録：
  - docs/research-results/PRISM7_P31_PRECOMMITTED_IDENTICAL_POST_RECOVERY_PREFIX_SECOND_LEG_DUMP_20261122.md
  - docs/research-results/PRISM7_P31A_PREEXECUTION_EXTRA_FAST_SECOND_LEG_PATH_SCOPE_20261122.md（結果前の高速反証追加）
- ソース:
  - scripts/research/prism7_p31_same_buyer_confirmation_opposite_second_leg_20261122.py
  - scripts/research/test_prism7_p31_same_buyer_confirm_opposite_future_20261122.py **5/5 PASS**：全72source identical prefix、864economic cases、1回復確認時刻におけるBUY価格代理、緩やか/急速downの元SOURCE winner削減、費用・STOP先着・署名fill未証明。
- 個票・集計：
  - docs/research-results/prism-phase2-20261122/PRISM7_P31_IDENTICAL_BUYER_CONFIRM_PREFIX_72_FUTURES_SUMMARY_20261122.json
  - docs/research-results/prism-phase2-20261122/PRISM7_P31_864_CAUSAL_BUYER_FALSE_BOUNCE_LEDGER_20261122.csv
- 全源SOURCE pin・最新P30 source PENGU/BTC確認後prefixSHA・3未来の経済源個票保存。テストのUTC numeric timestamp期待値を最初の実行時に誤記していたが、**計算源は一切修正せずUTC期待値だけを直し再実行して5/5 PASS**。源の前未来区分を調整して良い数字を出していない。

**本番MASTER/VPS/Runner/建玉/実注文/STOP/KillSwitch/HYPE未変更。研究Draft PR #595のみ。**
