# PRISM VII P13 — SOURCE固定53件のタイムラインを維持したM5取引印字ベースの執行価格感度（計算前に固定）

**RESEARCH-ONLY PRICE-PROXY STUDY. 実約定や正式BTを再現したと称しない。** 固定source `1657e173d250ad58f53e62f7bb0a3428fb405496` の元PENGU SHORT V20自然候補53件のシグナル/EXIT意図/STOP価格は変更しない。元source PnL（30bps 29勝53、平均+1.000655%、PF1.377342）は独立baselineのまま保存。

## 計算前に凍結する執行感度仕様

1. **注文意図の母集団53維持**：元SOURCE H1 ENTRY予定時刻 `E` にSHORT成行を提出したと仮定し、取引所の板/注文キュー不在の代替として `[E,E+60min)` で初めて正出来高のPENGU M5の`open`を**研究用ENTRY proxy**にする。1時間中に正印字がなければ `NO_ENTRY_PRINT_WITHIN_H1`、翌H1へ自動延長して勝手に取引を追加しない。これは実注文がfillした証拠ではない。
2. **source STOP理由23件**：SOURCE native hard/trailing STOP価格をそのまま使用。sourceがSTOP判定したH1に最初にM5正印字high>=source stopPriceが記録された時刻で仮想STOP発火。仮想EXIT proxyの2本のscenario：(a) `STOP_AT_SOURCE_LEVEL` は源STOP指定価格（楽観）、(b) `STOP_GAP_AT_FIRST_PRINT_OPEN` はSHORTを買い戻す都合上、源STOPと当該M5 openの高い方（起点ギャップがある場合の観測上の一部不利な可能性）。実注文板では高値/スプレッド/stop market fillがさらに悪化し得るので保守的な上限ではない。
3. **SOURCE非STOP出口30件**：元SOURCEの出口意図 `exitTs` に市場成行BUYを提出したと仮定し、`[exitTs,exitTs+6h)` で初めてPENGUの正出来高M5`open`が得られた時刻/価格を仮想EXIT proxyとする。6hまで印字がなければ `EXIT_NOT_WITNESSED_WITHIN_6H`、利益0扱いや強制分母調整は禁止。SOURCE EXIT価格を据え置いた`SOURCE_NEXT_H1_OPEN`も独立baselineで保持。
4. **保有中のSOURCE動的状態は再実行しない**：仮想ENTRY時刻/priceを変えるとATR/Watermark/trailing/STOPが変化する可能性がある。本P13はこれらを変更して元SOURCE EXIT理由をそのまま仮定する**感度分析**。Production一致の経済BTまたは取引所実fillsと誤表示しない。
5. **費用/スリッページ**：10bpsと30bpsを別々に控除し（total both sides cost）、追加EXIT滑り0/10/25bpsの3条件を全scenariosで単独集計。P13 `entry price proxy`が元SOURCE priceと一致しても時刻は異なる可能性を明示。
6. **採用判定**：source53 intentは分母から削除しない。新たな「filled witnessed」件数・censored/entry not witnessed件数・win count・PF・平均PnLを分け、元source53の29勝をそのまま併記。利益/勝率が改善したと見える時も未filledを落としただけであれば戦略改善と呼ばない。
7. 数字の統計特性は元市場すでに既見で、未見OOSではない。源H1/M5整合/非STOP夜間print/STOP gap/funding/shared risk/DDが未検証である事実を維持。全53行と方法仕様・SHAにより再現可能にし、PR #595 Draft branch以外へPushしない。

**実注文・VPS・Production/STOP・HYPE・Kill Switch・master変更なし。**
