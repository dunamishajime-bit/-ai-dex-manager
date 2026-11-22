# PRISM VII P35 — original pinned V20 53自然エントリー（重複IDを区別）で P34 BTC6h Context gate の横展開を反証

**最終判断**：P34で `SELLER_PULLBACK_REJECTION` **だけ** に適用した `BTCret6<=0` を、**元PENGU V20の全53自然エントリーへ一律適用することは拒否**。この研究shadowでは元の勝ち29件中18件を消し、SOURCE native53のPFが1.377→1.060へ悪化し、勝率54.72%→52.38%に低下。逆にP34 S4 SELLERのBTC6h条件は研究候補として残すが、根拠は既知小標本21→19決済であり確定採用ではない。

## 固定事前仕様とSOURCE pin

- 先に `docs/research-results/PRISM7_P35_PRECOMMIT_ORIGINAL_NATIVE53_075_BTC6H_SHADOW_NEGATIVE_CONTROL_20261122.md` をPR #595 DraftへPush。SOURCE original V20 pin `1657e173d250ad58f53e62f7bb0a3428fb405496`、P8 original native 53約定ENTRY＋元native EXIT＋30bps `EXACT` 53/53を保持、**実行比率gross0.75倍固定**の参考資金比PnLにスケール。SOURCEの本番ロジックは変更なし。
- 特筆すべき構造：**original native 53件の `id` はユニーク43種類しかない**。同じIDを別の取引時点で再利用していたため、原53を単なるidキーのmapにすると10件が欠落する。P35では **entryTs一意53件・(id,entryTs,exitTs)一意53件** を証明し、個票もID＋ENTRY時刻で区別。元の履歴を編集・削除していない。
- 完了したH1バーのみを使う：`signalReferenceTs=entryTs-1h`、BTCret6=BTC前完了H1 close / 6H前close−1。PENGUminusBTC6hも同一SOURCE H1で計算。SOURCE H1区間は2025Aug〜2026Novで連続。BTC一部の元H1 OHLCに `high<open` のデータ不整合があり、別の既存`BTCUSDT-1h-20250801-20250924-RESEARCH_M5QA.jsonl.gz` の検証済み修正系列を読み、source hashを保存。原データの無断改ざんをしない（2つのファイルの差分を事実として保持）。
- 53元エントリーの原SOURCE時刻/価格/exit/feeを完全固定。入力は口座勝敗や未来情報でなく、対象ENTRYより前に完成したBTC/PENGU H1価格。モデルは `NATIVE53_UNMODIFIED`, `NATIVE53_SHADOW_BTC6H_NONPOSITIVE`, `NATIVE53_SHADOW_PENGU_REL_WEAK6H`, `NATIVE53_SHADOW_BOTH` の事前固定4案。
- SOURCE元53のENTRY-EXIT期間には**ペア単位38件の重複**、最大**6建玉同時重複**が存在。よって本P35で **1slot単一PENGU複利DD・本番のShared Risk DDなどは計算しない**。全元53機会に対する将来フィルターの選別効果を比較する参考 net points だけを表示。元S4研究21決済・DD17.03%とはPORTFOLIO母数が異なる。

## SOURCE原53の自然ENTRY→元native EXIT（30bps、gross0.75の単独参考リターン）

| 反証モデル | 残るSOURCE native取引 | 勝ち/負け | 勝率 | 参考平均net／元本資金割当 | PF | 元53機会を母数にしたnet合計ポイント |
|---|---:|---:|---:|---:|---:|---:|
| **元SOURCE V20・無改変** | 53 | **29/24** | **54.72%** | **+0.7505%** | **1.3773** | **+39.776** |
| SOURCE53にBTC6h<=0を一律適用したshadow | **21** | **11/10** | **52.38%** | **+0.1485%** | **1.0597** | **+3.118** |
| SOURCE53にPENGU-BTC6h相対弱を一律適用したshadow | 33 | 19/14 | 57.58% | +1.2346% | 1.6270 | +40.742 |
| SOURCE53に上記2条件ANDを一律適用したshadow | 16 | 7/9 | 43.75% | −0.3964% | 0.8621 | −6.343 |

**原SOURCE53へのBTC6h陰性だけのshadow**は32取引を外すが、その内訳は**SOURCE勝ち18件、負け14件**。失う元勝者の総参考利益 **89.8519ポイント**、回避する敗者総参考損失 **53.1943ポイント**、差し引き netは参考原53 +39.776→+3.118へ激減（いずれも1件の元本持分0.75倍換算値を53機会に足し合わせたもので、本番の複利ではない）。従ってP34 BTC6h guardを**original V20 native 全取引へ展開しない**。

PENGU-BTC相対弱の参考PF1.627は原V20より高いものの、元の勝ち10件を削除・元の負け10件回避による小標本retrospective shadowであり、入口ロジックの異なる S4 SELLER専用gateの採用根拠とは見なさない。両gate ANDは勝率43.75%、PF0.862と明白に悪い。P35の4案すべて、元ピンのSOURCE natural V20実行コードには適用しない。

## P33→P34→P35の正しい統合評価

- P33 gross0.75、S4新ENTRY+元SOURCE V20 native純EXIT＋P25確定ショック1件で 21決済15勝 (71.43%)、基本条件M5 DD17.0314%。3本目印字・追加1000bps滑りではDD23.8713%でユーザーDD20上限超え。
- P34 gross0.75、S4 `SELLER_PULLBACK_REJECTION` にのみSOURCE H1 BTCret6<=0で新ENTRYを許可すると 19決済14勝 (73.68%)、第3印字＋1000bpsモデルDD18.8177%に改善。一方1件元勝ちも消失、POST時期の選別は変わらず。**BUY早期執行をOFF**にするとDD24.855%で20未達、P25ショック既知1例の高依存は残る。
- P35別研究 negative controlで、同一BTC6hルールを元 native V20自然53へ無条件展開すると成績悪化。**市場状態gateの効果は戦略・構造に依存し、全Runner一律ルールは逆効果の可能性がある**。異なる入口に適用した結果だけでP34 SELLER特定gateを真のOOS検証と呼べない。
- 「元SOURCEショック利益をP29/P31の人工市場で破壊する」反例は継続成立。真の別相場でのvalidation、bid/ask/署名付き実約定・市場板・Funding・Margin・PENGU本体勝率80%以上・全Runner DD20%/Shared日次7.5% 等が不足。P34/35は**研究のみ、本番採用 BLOCKED**。

## 検証資産と完了

- `scripts/research/prism7_p35_original_native53_btc6h_shadow_negative_control_075_20261122.py`
- `scripts/research/test_prism7_p35_native53_btc6h_shadow_negative_control_075_20261122.py` — **7/7 PASS**（元53を再利用IDの43に縮めない、H1先読みなし、SOURCE原PnL、0.75倍率、重複38/max6、BTC・相対弱・AND反証、原53結果不変）
- `docs/research-results/prism-phase2-20261122/PRISM7_P35_ORIGINAL_NATIVE53_075_BTC6H_SHADOW_NEGATIVE_CONTROL_20261122.json`（結果・H1 inputSHA）
- `docs/research-results/prism-phase2-20261122/PRISM7_P35_ORIGINAL_NATIVE53_075_ALL53_H1_CONTEXT_AND_POSITIONS_20261122.json`（元53 ENTRY/EXIT, time-causal BTC6h/PENGU6h, 全4モデル選別、元native30bps、0.75参考net）
- 本番 master, Production, VPS, Runner, live STOP,建玉,実注文, Kill Switch, HYPE, Codex worktree は完全未変更。PR #595 Draftの別研究ブランチにPushするのみ。

**次の研究優先順位**：0.75倍は固定のままS4 SELLER誤判定の一層深い「反転」・「市場状態」系の条件付確率推定を、勝ち/負けの事後識別ではなくpreEntry H1特徴と未見サンプルで評価。P25特殊一時価格の「未来の継続下落で元SHORT勝者を削る」問題を先に未見データ・反例テストで解消しない限りLIVE採用はできない。
