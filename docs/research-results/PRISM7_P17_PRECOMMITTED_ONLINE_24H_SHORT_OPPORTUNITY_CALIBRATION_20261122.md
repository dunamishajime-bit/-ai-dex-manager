# PRISM VII P17 — Source native SHORT候補への事前確定 Online 24H相場方向予測（経済結果閲覧前に固定）

**実験のみ。本番のENTRY/STOP/EXIT、HYPE、承認・注文は変更しない。** PENGU SHORT V20元SOURCE `1657e173d250ad58f53e62f7bb0a3428fb405496` の自然53件のENTRY/source EXIT完全一致が必須。P10一律保護EXITが損益を壊し、P16入口後2H六条件判定もAUC0.491/p≈0.906で失敗。今後のLayer2候補を予測の蓄積で検討するため、**市場の過去H1のみから逐次予測を出す基線**を作る。

## 凍結する対象/ラベル/時間順

1. 各period PRE 2025-Aug–Sep, BASE 2025-Oct–2026-Sep, POST 2026-Oct–Nov のnative `buildPenguDualLsV2EvaluationSeries` のsource H1 PENGU/BTC同期。SOURCE SHORT natural 53 intent全維持し、元のSOURCE source勝敗29/24と採用判断は変更しない。
2. H1 tのSOURCE特徴量で予測する目的変数は **t+24HのPENGU終値から算出したSHORT方向の30bpsコスト控除後がプラスか**（擬似短期市場方向学習目標）。元の72H native STOP/EXITの勝敗ラベルを学習に使うことは禁止。2時間後のP16特徴、synthetic未来regimeラベルも学習へ混ぜない。
3. at H1 t でモデルを更新してよい学習例は、**既に24H経過したt-24のH1特徴量だけ**。そのラベルを現時刻の確定t終値から計算し、tおよびt-24のPENGU volume>0、source H1価格正常、特徴のfiniteを要件とする。未確定将来データを学習に入れることは禁止。SOURCE natural53の今後 native profit labelは推定評価のためだけに保持。
4. モデルはシンプルなSGD logistic regression、オンライン初期w=0/bias0、固定学習率 `lr=0.03`、固定L2 `0.001`、1Hにつき成熟ラベル最大1件。以下の**凍結9特徴量**のみ、各値 `[-3,3]` クリップ：
    - PENGU24h return /0.10
    - PENGU72h return /0.25
    - BTC24h return /0.06
    - PENGU-BTC relative24h /0.10
    - (PENGU close / EMA72 -1)/0.12
    - BTC EMA168 distance /0.08
    - (volumeRatio6OverPrior36 -1)/2
    - (ATR24 ratio -0.025)/0.025
    - (RSI14 -50)/25
5. 予測をsource natural SHORTに与える時刻はそのH1シグナルが確定した `referenceTs` だけ。まずそのreferenceTsの時点までの成熟例でUPDATEし、その瞬間まで確定した本H1特徴をPREDICTして `probShortWin24h` を保存。SOURCE ENTERは**次のH1 OPEN**。同じSOURCE natural53候補を再選別・見送り・LONG反転しない。ラベルが後に成熟しても過去の予測を更新して書き換えない。
6. 比較基準は同じ時刻までの成熟過去ラベルから求めた単純な `online base-rate`（0件なら0.5）。SOURCE候補の本来native 30bps win29/53を事後ラベルとして、PREDICTした24H方向確率のnative勝敗AUC・Brier・cohort別を出す。**学習目標とnative trade targetは違うため、AUCが良くても自動で出金・STOPやENTRY gateを変える理由にはならない。**
7. native original-source53上で閾値 `p>=0.5` を見せる場合は**閲覧用のconfusion**に留める。候補を落として勝率だけ上げない。ORIGINAL勝者のうち誤って p<0.5 になる件数と、元敗者でもp>=0.5となる数を必ず出す。P17が逆効果なら明確にREJECT。別generator family/後発本物OOSで改善しない限りLIVE採用不可。
8. この学習器自体を変更・調整する前にprequential SOURCE結果をGitHub研究PRへ固定し、5,000 permutation等は使わずパラメータチューニングしない。SRC SHA/data quality、native signal full53、prequential training count/probability、source EXIT、time monotonicity、feeを全個票/summary保存。
9. 実市場source H1のcloseは実売買板/約定の保証ではなく、source H1/M5価格不整合/遅延print問題はP11-P14参照。未見OOS, Funding, Gross,複利DD20%は未達。

PR #595はDraft研究専用。master/VPS/Runner/建玉/STOP/Kill Switch/HYPE/実注文は変更しない。
