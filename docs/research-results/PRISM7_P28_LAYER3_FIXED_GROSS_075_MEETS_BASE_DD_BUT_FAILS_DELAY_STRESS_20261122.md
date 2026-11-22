# PRISM VII P28 — Layer3の固定建玉倍率0.75/1.0/1.25とDD20%の時間遅延感度

**研究名 `PENGU_S4_CAPITULATION_CAPTURE_V1 + LAYER3_FIXED_GROSS`、本番候補としてはまだ不合格。** P27までに元PENGU SHORT V20の既存native53件と、独立S4元120H1構造/21reference完了/15勝+1右打切りを確保。P25レジーム例外は既知の2025-10-10 Flash Crashで設計した1件しか発火しておらず、独立OOSでの勝率優位は未証明。今回入口・EXIT・M5足時刻・参考STOP・Source priceを一切変えず、**Layer3建玉倍率**の差のみを研究した。

## 事前固定した90シナリオ

`PRISM7_P28_PRECOMMITTED_LAYER3_CAPITAL_ALLOCATION_075_100_125_20261122.md` に固定した gross0.75/1.0/1.25 × P25 source positive M5 EXIT遅延1/2/3本 × 追加スリッページ0/25/100/500/1000bps × fee10/30bps = **90条件**。毎回元120setup、SOURCE単一枠の21reference決済/15勝、右打切り1件を不変として **合計1,980建玉別証跡**を保存した。利益と費用・含み益はentry時点NAVに比例したgross notionalで複利計算。元のsource1x M5評価額/close DD/P26因果HIGH stressの全30費用遅延パターンと**数値完全一致**している。

### 基本案：30bps・第2本目のpositive M5 EXIT・追加滑り0

| 固定倍率 | 勝ち/決済完了 | 平均net/口座持分1trade | PF | M5 close mark DD | 前完成M5ピーク対HIGH stress DD | 1万円→研究参考最終NAV（1右打切り含む） |
|---|---:|---:|---:|---:|---:|---:|
| **0.75x** | **15/21** | +5.264627% | **5.134050** | **16.950944%** | **16.950944%** | 約26,751円 |
| 1.0x | 15/21 | +7.019503% | 5.134050 | 21.958773% | 21.958773% | 約35,621円 |
| 1.25x | 15/21 | +8.774379% | 5.134050 | 26.688454% | 26.688454% | 約46,631円 |

倍率では**勝率もPFも改善しない**。SOURCE1xの勝ち15/21が維持されるという利点と引き換えに、0.75xは資金収益率・最終NAVも小さくなる。したがって`gross0.75`自体を「勝率80%を達成した新ロジック」と誤称してはならない。保有中5M DDが減るのは単純なリスク量の減少という会計的効果。真正の注文執行・流動性/stop・他Runnerを含むportfolio DDではない。

### 致命的な遅延感度：0.75xでもDD20%を超える

30bps/0.75x、研究CAPITULATION SOURCEイベント後のpositive M5の何本目で実際に買い戻せるかで、**5M close/DD**は以下。追加slipはEXIT買い戻しproxy価格のみに反映する。

| 認識確定後のpositive M5 EXIT | 追加滑り0bps | 追加滑り100bps | 追加滑り1000bps |
|---|---:|---:|---:|
| 1本目 | **16.95%** | 16.95% | 16.95% |
| 2本目（主案） | **16.95%** | 16.95% | 16.95% |
| **3本目** | **20.47%** | **20.81%** | **23.87%** |

3本目の0bpsで**既にDD20%を超える**ので、実行の遅れ・約定薄さ・APIのレート制限があれば安全余地が非常に薄い。元SOURCE 2025Oct Flash crashの価格代理が完全に1本ごと約定可能だったことを証明できない以上、P28 **Layer3 0.75xを本番Grossとして反映しない**。1000bps追加滑り後でも利益の参考総額はプラスだが、リスク閾値未達という事実を優先する。

## 出口ではなく市場構造＋資金管理の設計課題

- S4の入口構造を独立再設計して、通常の弱いSHORT追随の誤判定を減らす（P20/P21/P22）。
- 一時的な出来高の薄い崩壊レジームのみ別処理して途中の大幅含み益を捕捉する（P24/P25。ただし1既知イベントの危険な当てはめ）。
- 利益取引を誤SHORT扱いしない：P27 `S3_07302`の2026Jun未実現ピークと`S3_10500`の2026Oct勝ち取引時点を独立検算し、真の負けトレードとの区別を固定する。
- DDが足りない場合、検証済み Layer3 grossの選択肢0.75/1.0/1.25を尊重するが、ENTRY/EXIT・候補の採否や元source winnersを削って「DD合格した」と演出しない。**勝率全体80%・DD実口座20%は未達**。

SOURCE本来PENGU V20と新S4の参考STOP72は同一ではない。SOURCEはAster public H1/M5価格代理、長期実運用のASK/queue、署名約定、funding、他Runner Gross、Kill Switch/Shared risk daily7.5%と複利Portfolio全体DDが不明。今回の「0.75x DD16.95%」だけで本番オーダー権限・総合ポジションに適用するのは不可。

## 再現可能な全source証跡

- 事前登録：`docs/research-results/PRISM7_P28_PRECOMMITTED_LAYER3_CAPITAL_ALLOCATION_075_100_125_20261122.md`。
- 計算コード `scripts/research/prism7_p28_layer3_fixed_gross_capital_allocation_20261122.py`
- regression `scripts/research/test_prism7_p28_layer3_gross_90scenario_contract_20261122.py`：**6/6 PASS**。元120setup・21/15勝＋1右打切り、全90SOURCE riskケース、0.75/1/1.25会計比例、P26 source1.0全ケース、3本目遅延DD不合格を全て固定検査。
- 全90条件summary・元source H1/M5とP22/P25/P26 SHA `docs/research-results/prism-phase2-20261122/PRISM7_P28_LAYER3_FIXED_GROSS_90_CASE_SUMMARY_20261122.json`
- 全90×22＝1980建玉の元ローカルJSON 1,918,746 bytesは、現行遠隔テキストファイル転送のサイズ制限のため**非破壊gzip/base64でGitHub text fileへ保存**：
`docs/research-results/prism-phase2-20261122/PRISM7_P28_LAYER3_FIXED_GROSS_1980_POSITION_LEDGERS_20261122.json.gz.b64`
`docs/research-results/prism-phase2-20261122/PRISM7_P28_LAYER3_FIXED_GROSS_1980_LEDGER_ARCHIVE_MANIFEST_20261122.json`
  - 元JSON `SHA256=3629abdcbbc2d7f8e3c53dede2e4d019e293b5cb5b66c1ff1ba1b84209629706`
  - gzip/base64 189,029 bytes, `SHA256=db1c9078ac631f51924d6e6ce9fe4f71c4f166b4cdbb92d606a3966669ffcd57`
  - **lossless restore済・元1980 rows と全byte SHA一致**、復元 `scripts/research/prism7_p28_restore_full_1980_ledger_20261122.py` で確認可能。

### 判定

P28の固定gross0.75は1倍よりM5 mark DDを減らしてSOURCE15勝を保護する**Layer3研究候補**である。しかし独立未見相場、ショック時1〜2印字以内の買い戻し、板の流動性、SharedRisk、他ロジックとの複合運用の証拠がないため、本番採用 **BLOCKED /未達**。最小限でも2025Oct以外の市場急落で同等の成行執行を観測し、合成SQUEEZEで規則を破綻させ、M5足内順序とLIVE適用するならOwner承認正式経路を検証する必要がある。

**master/Production/VPS/Runner/建玉/STOP/実注文/KillSwitch/HYPE変更なし、GitHub Draft PR #595研究のみ。**
