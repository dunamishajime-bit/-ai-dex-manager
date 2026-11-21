# PRISM VII P13 — 実PENGU SHORT V20 SOURCE53のM5初回正印字を使った執行時刻・価格感度（2026-11-22）

**判定：SOURCE経済BTの実行可能性は依然として証明されていない。M5初回正取引の時点を価格代理にしただけでも、手数料・追加滑りにより利益/PFが低下。新しい勝率改善ロジックではないため本番採用不可。**

事前固定した方法：`PRISM7_P13_PRECOMMITTED_SOURCE53_M5_PRINT_TIMING_EXECUTION_SENSITIVITY_20261122.md`。元pinned source `1657e173d250ad58f53e62f7bb0a3428fb405496` の自然SHORT53件（SRC30bps29勝/53、mean+1.000655%、PF1.377342）を**全候補保持**。元source entry/EXIT intent/STOPレベルは絶対変更せず、注文板がない状態でM5最初の正出来高bar openに成行の価格代理を置いたイベント時間の感度分析。Source native engineのposition/stopをrepriceした新BTではない。実取引fill証明0件。

## 1. SOURCEモデルとM5取引印字代理の執行差

- 53件の元source自然SHORTは分母維持。エントリーH1内で正出来高M5がある52件はその最初のM5 openをENTRY代理とする。**残1件はsource上では勝ち取引だが、当該H1に取引印字が無く、`NO_ENTRY_POSITIVE_PRINT_IN_H1`（勝ち扱いも負け扱いもしていない）**。
- STOP 23件：元source hard/trailing STOPのレベルに決済判断H1内のM5 highが初めて到達した足を用いる。買い戻し価格は(A)SOURCE STOP価格そのもの（楽観）または(B)`max(STOP価格,当該M5 open)`（観測されるgap openの不利な方向のみ反映）。これはquote/queue/signed fillも実際の最悪値も再現しない。
- STOP以外のSOURCE EXIT30件：SOURCE `exitTs` 以降6Hの正出来高M5を時間順に探索、最初のM5 openをBUYの研究代理価格とする。元SOURCE EXITの時刻に取引記録がない場合も、仮想注文が成功したと偽装せず、待機時間を可視化。
- STOP 23件中**6件**で最初の価格印字openは元SOURCE STOP価格より不利だった。非STOP30件では、最初の印字が元SOURCE EXIT時刻から最大**165分後**の事例も確認。
- 53件×2 STOP価格仮説×10/30bps×追加EXIT滑り0/10/25bps ＝**636件のケース台帳**、全12条件でSOURCE natural候補53件。印字代理の入口・出口が確認可能52件、入口未観測1件、6H以内の出口未観測0件。追加滑りによって勝率が上がったり損益が改善することはない。

## 2. 費用/ギャップ感度（**同一の52価格代理観測可能候補に限定**）

| 30bps費用モデル | 同じ52件の元SOURCE（参考） | M5代理・source STOP価格 | M5代理・STOP gap open不利価格 | M5代理・STOP gap＋追加滑り25bps |
| --- | ---: | ---: | ---: | ---: |
| source自然ENTRY intents | 53 | 53 | 53 | 53 |
| 価格観測代理がある候補 | 52 | 52 | 52 | 52 |
| 勝ち | 28 | 29 | 29 | **27** |
| 52件内勝率（条件付き） | 53.85% | 55.77% | 55.77% | **51.92%** |
| 52件平均損益率 | **+0.903808%** | +0.933958% | +0.857381% | **+0.607381%** |
| PF | **1.334391** | 1.344715 | 1.316281 | **1.215175** |

上記の52件は、元source53のうち「source価格モデル上は+6.0367%の勝ちだがM5エントリー当該H1に正印字がない」1件を**母集団から除外した条件付き比較**。この成績を通常BTのPENGU勝率55.77%と主張してはならない。元SOURCE53件は別に29勝/53、mean+1.000655%、PF1.377342のまま保持している。

元source52件の28勝から、代理が29勝に変化した理由の一つはPREの`PENGU_00004`：元source次H1の仮想EXITで-0.44593%だったが、そのH1には実M5正印字がなく、実際に記録された次の最初のM5印字まで価格代理を移すと+1.06095%になったため。これは未来価格を使った**研究代理の事後結果**であり、元の注文がその価格で約定できた証明でも、新しい方向判定が成功したことでもない。

本番約定としての証拠不足を明示したまま比較すると、M5のギャップ処理/25bps追加EXIT滑りでPFは1.215、平均PnL+0.607%まで低下する。さらに大きなスリッページや注文未成立の場合、SOURCE結果から悪化するリスクを否定できない。

## 3. 再現性と検算

- 事前仕様とSOURCE H1/M5タイミング問題：P11 entry/53・P12 EXIT/53とraw source SHAを連結。全印字/初回価格の元データがあってもSIGNED BOT fillは存在しない。
- コード `scripts/research/prism7_p13_native53_m5_print_price_proxy_sensitivity_20261122.py`、テスト `scripts/research/test_prism7_p13_source53_m5_price_proxy_contract_20261122.py` **5/5 PASS**。
- 12経済シナリオ×53元intent＝636全行
  `docs/research-results/prism-phase2-20261122/PRISM7_P13_NATIVE53_M5_PRICE_PROXY_636_CASES_20261122.csv`
- summary `docs/research-results/prism-phase2-20261122/PRISM7_P13_NATIVE53_M5_PRICE_PROXY_SUMMARY_20261122.json`（入力P11/P12/M5 SHA256証跡を含む）
- 同じ入力からの**独立再計算で2出力SHA256完全一致**
  - all636 CSV `24191a038f8658a7731d121a38e08fcdebd0b2334b71d77042fb5ed90564e304`
  - JSON `53bcaed574cfc b56197bab33aec57f0a231b06a3794eb09d8780c6bb10a60e06`（表示空白を除いたSHAはファイルに記載）。

## 4. 決して主張しないこと

- P13は元source**動的STOP状態機械を改変後ENTRYに再接続して再評価していない**。H1 entryPriceと初印字M5 openが一致しても、実際のENTRY/EXIT時刻/position stateや同一bar内の高値/安値順序が異なり得る。このためSOURCE固定実装との新しい経済再現の証明は不可。
- M5 OHLCVで取引が観測されても、板のask数量・委託キュー・自己注文のfill/partial qtyは未証明。エントリー正印字52件を「約定52件」と呼ばない。
- 10/30bps費用単独 + 追加滑り0/10/25bpsは比較感度だけであり、実執行コストを分布的に推定していない。
- 本研究で勝率80%、DD≤20%、未見相場OOS、Funding/他Runner/Grossは全て**未達/未検証**。

**次の優先技術タスクは、SOURCE pinned signalを使いながらM5のsubmit→quote/first positive print→actual executable fill→native STOP activation/evolution→time-ordered stop/exitを再演し、H1時間ラベルによる先読みを除いたBTの信頼性ゲートを作ること。SOURCE P10等の失敗したEXITへ戻らない。**

本番master/VPS/Runner/注文・建玉/STOP/Kill Switch/HYPEは未変更、Draft PR #595研究ブランチのみ。
