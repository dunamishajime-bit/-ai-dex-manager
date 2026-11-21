# PRISM VII P25 — BTC連動CAPITULATION専用EXITで利益/マークDD改善、ただし既知shock 1件のみ、DD20%未達

**研究名 `PENGU_S4_CAPITULATION_CAPTURE_V1`。元のSOURCE `PENGU_SHORT_V20`、PENGU V2、RecoveryV8、現行LIVEのいずれも変更していない。** P24で既知になった2025-10-10巨大FLASH SELL-OFFを見た後、通常のトレーリングと独立に`PENGU ENTRY比25%以上順行` + `M5約20%以上の急落` + `BTC同じM5急落3%以上` + `PENGU taker買い比率45%以下`が**完成M5 CLOSE**で確認された時だけCAPITULATION状態へ移る事前固定仕様 `PRISM7_P25_PRECOMMITTED_CROSS_ASSET_CAPITULATION_AFTER_5M_CLOSE_EXECUTOR_20261122.md` を実装。

保有中SOURCE positive M5+BTC 5Mを as-of で照合し、120元H1構造setupのうちCAPITULATION確定は **`S3_01700` 1件のみ**。発火M5は2025-10-10 21:15–21:20 UTCで `PENGU close 0.010000`、その時点でSOURCE entry0.022617比SHORT gross+55.8%、直前正出来高M5close0.022571比−55.7%。同時間BTC CLOSE104694.7 は1本前112137.1比−6.64%、PENGU taker買い比率0.0931。ソースPENGU/BTC H1+M5同時整合はP24参照。**検出閾値をこの既知データから設計した**ので、同じ期間で良い成績になっても独立OOSではない。

## 執行速度を遅らせた上での成績

仮想EXIT価格は、異常を確認したM5が完全確定した **21:20UTCより後**、次の正出来高5M足のOPENを使う。**基本案は第2本目のpositive M5 `21:25 OPEN0.0101`**。第1本目は`21:20 OPEN0.006241`で大変有利だがリアル市場で反応・板に約定できた根拠はない。第3本目は`21:30 OPEN0.0158`でより悲観的。元P22 SOURCE参考STOP EXIT `22:00 OPEN0.020007`より先にのみ適用、元130? ではなく **元120 setup全保存、21完了+1 right-censored維持**、追加M5スリッページをexitPriceにだけ反映。

| 30bps・1枠・仮想 positive M5買い戻し | P22元STOP | P25 1本後 | **P25 2本後（主案）** | P25 3本後 |
|---|---:|---:|---:|---:|
| PRICE代理で完了 | 21 | 21 | **21** | 21 |
| 勝ち | 15 | 15 | **15** | 15 |
| 条件付き勝率 | 71.43% | 71.43% | **71.43%** | 71.43% |
| 平均net % | +4.934% | +7.832% | **+7.020%** | +5.819% |
| PF | 3.906 | 5.613 | **5.134** | 4.427 |
| M5-close未実現含むDD | 35.942% | 21.959% | **21.959%** | 25.230% |
| P23 M5-high逆行stress DD | 37.647% | 37.075% | **37.075%** | 37.075% |

25/100/500/1000bps追加EXIT滑りも固定検証済み（元30bps両側費用とは別）。主案第2本 positive print、追加1000bpsで **平均net+6.807%、PF5.009、closeマークDD21.959%**。第3本目+1000bpsでは **平均+5.487%、PF4.231、closeマークDD29.253%**。価格代理や成交・実取引の保証ではない。全30条件（2費用×3遅延×5滑り）×120元setup＝**3,600個票**を保存。全SOURCE S4入口/STOP全120との完全パリティ、変更はショック1件だけ。

**重要：DD20%はまだ未達。** M5-close DD21.959%、highストレス37.075%であり、S4 Portfolio DD20以内・shared daily loss7.5%は検証未達。high stressには「同じM5のcloseマークからピーク更新した後、そのM5の先行highへ時間を遡って損失を評価する可能性」も含まれ、**経済的に実現可能な経路と同一視してはいけない**。時間順が成立する保守的stressと明確に区別してP26で独立検査が必要。とはいえclose mark DD自体が20%を超えるので、不合格判断は変わらない。

## 成行の流動性について

PENGU 21:20 5M barの正出来高 `211,606 PENGU` × OPEN `0.006241 USDT` 約**1,321 USDT**の5分足総出来高価格換算；主案21:25 5M bar `168,854 PENGU` × OPEN `0.0101 USDT` 約**1,705 USDT**。**OHLCV内の出来高は実際のOPEN時点で即座に使える買い板の厚みではない**。たとえ想定初期資金1万円の小口でも、板・スプレッド・市場の成行衝撃・stop注文バースト・自己約定識別はなく、参考利益を現実の約定とは言わない。1000bpsの滑りも実際の最大滑りを保証しない。

事前登録したSOURCE BTC M5 `2025-09-13T13:50UTC`の異常OHLC1本は、S4元ポジション全時間窓外と照合して**source原データ不改変・分析から隔離**（SOURCE SHA256保存）。それ以外のBTC/PENGU不整合が保有中にあればFAIL CLOSED。

## 再現証跡

- 実装 `scripts/research/prism7_p25_s4_cross_asset_capitulation_capture_20261122.py`：両通貨の同期M5、先に確定したM5以外は判定不可、source STOP先着、1/2/3正出来高M5の執行遅延、extra0/25/100/500/1000bps、元120setup1枠再選択、同一P23 M5 DD再計算。
- 回帰 `scripts/research/test_prism7_p25_capitulation_120_source_3600_scenario_contract_20261122.py` **6/6 PASS**：全120×30、信号1件のみ、全3 print timestamps、SOURCE時刻因果、STOP優先、1右打切り保持、源SOURCEへの注文なし、費用・遅延単調。
- `docs/research-results/prism-phase2-20261122/PRISM7_P25_CAPITULATION_30_SCENARIO_SUMMARY_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P25_CAPITULATION_120_SOURCE_EVENTS_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P25_CAPITULATION_3600_SCENARIO_CANDIDATES_20261122.csv`
- SOURCE p22/P23全SHA, Aster original PENGU/BTC 5M gzip SHA、fixed source pinを保存。

**判定：P25は既知イベント説明の研究候補のみ。本番採用は明確にREJECT。** このレジームを本物の市場構造として一般化するには、独立の別日shock sample（存在しなければ0）、合成同一過去→暴落/偽シグナルsqueeze二世界、他所の取引所の流動性/深度、実執行時計・STOP優先と未見OOSで反証する。PENGU80%・DD20%はいずれも証明していない。

**master/Production/VPS/Runner/注文/建玉/STOP/Kill Switch/HYPE不変更。Draft PR #595研究のみ。**
