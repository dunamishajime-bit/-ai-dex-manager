# PRISM VII P19: 部分利確では総合利益とPFを維持できず不採用

元native source SHA `1657e173d250ad58f53e62f7bb0a3428fb405496` のPENGU SHORT V20 53自然候補（うち実印字価格代理52件、入口印字なし1件）を保持し、P18で観測したBTC-confirmed MFE3 givebackの研究EXIT時刻・価格を凍結して **0%、25%、50%、75%、100%** だけ先行利確、残りはP14のsource native stop/exit価格を保持する経済感度を検証。BTC買圧力確認2ルール×5比率×10/30bps×滑り0/10/25bps＝**全60条件、3,180個票**。元SOURCE勝者を1件も除外していない。事前登録 `PRISM7_P19_PRECOMMITTED_PARTIAL_BANK_VS_NATIVE_TREND_CONTINUATION_20261122.md` を厳守。

| 30bps・追加滑り0、観測可能52件のみ | 0%（元P14） | 25% | 50% | 75% | 100% |
|---|---:|---:|---:|---:|---:|
| BTC確認型・勝ち | 29 | 29 | 29 | 31 | 35 |
| BTC確認型・平均net % | +0.858779 | +0.736695 | +0.614611 | +0.492528 | +0.370444 |
| BTC確認型・PF | 1.314102 | 1.288629 | 1.259252 | 1.220492 | 1.169628 |
| BTC強反発型・勝ち | 29 | 29 | 29 | 29 | 35 |
| BTC強反発型・平均net % | +0.858779 | +0.786253 | +0.713727 | +0.641200 | +0.568674 |
| BTC強反発型・PF | 1.314102 | 1.305277 | 1.295294 | 1.283910 | 1.260399 |

見かけの勝率を上げるには先行利確を大きくする必要があり、特に元の下落継続中の強い勝ちトレードの利益を削る。分割早期利確によるnet収益は、固定研究EXIT価格の下で `(1−fraction)×元P14利益 + fraction×P18全量EXIT利益−fraction×追加滑り` であり、元P14とP18の平均損益の間を直線補間する。**両P18ルールの平均利益が元P14より低いので、どの正の固定割合でも平均利益を改善できないことが代数的にも証明できる。**

注意：分割ロットに対するSOURCEの動的native stop状態は再生成していない。P19は**キャッシュフロー配分感度**であり、実注文部分約定再現や完全native戦略BTではない。元の自然SHORT53候補は全条件で残り、入口印字が観測できない1件は条件付き52取引の損益に勝手に算入していない。10bps/30bps独立、追加滑り25bpsまで全件検査。

コード `scripts/research/prism7_p19_partial_capture_fixed_fraction_source53_20261122.py`、source保持・費用単調・比率端点一致の回帰 **5/5 PASS**、集計 `docs/research-results/prism-phase2-20261122/PRISM7_P19_SOURCE53_PARTIAL_CAPTURE_SUMMARY_20261122.json`、全3180個票 `docs/research-results/prism-phase2-20261122/PRISM7_P19_SOURCE53_PARTIAL_CAPTURE_3180_CASES_20261122.csv`、元SOURCE provenance固定SHA。

**結論：P19 REJECT。** P10/P16/P17/P18/P19の不採用結果は小さなEXITパラメータ調整の限界を示す。次はSHORT V20の方向予測・入口タイミング・市場構造・利益を逃さない経済ルールを**別名の新ロジックとして根本再設計**する。新たなSHORT候補を数え、元ソースの勝者の絶対利益額を失わないか検証する。既見市場と人工相場は独立未見OOSと誤称しない。PENGU80%・PortfolioDD≤20%は未達。Draft PR #595の研究のみでmaster/Production/VPS/Runner/STOP/建玉/実注文/HYPE/Kill Switch不変更。
