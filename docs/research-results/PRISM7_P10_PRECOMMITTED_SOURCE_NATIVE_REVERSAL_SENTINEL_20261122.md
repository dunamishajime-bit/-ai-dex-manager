# PRISM VII P10 — Native SHORT V20保有中の反転確認保護（結果取得前固定）

**RESEARCH ONLY / freeze before applying to 53 real, 157 synthetic, or 13 P9 twin pairs.** PENGU固定 `1657e173d250ad58f53e62f7bb0a3428fb405496` のENTRY, owner admissionやsource STOP純関数は変更しない。信号53/53再現、157人工候補の元出口100%照合が失敗した場合はFail Closed。

## P10A: 三方向・二連続確定足の反転観測を組み込む出口監視

1. Original SHORT entry time E、entry price P、entry時点のpin ATR24 absolute = `entryFeatures.atr24Ratio * entryFeatures.close`（>0）。**この値を保有期間中に変更しない**。
2. 最短保有2時間。時刻Tにおいて`T`で閉じた正出来高のPENGU H1、BTC H1を読み、印字のないH1を反転の証拠にしない。どの足にも `referenceTs<=T` を要求。H1が自然sourceだとvolume>0でもprint分布はM5と違うことがあるため、市場実約定の保証はしない。
3. 確定H1の **4つの独立証拠**：A 最新の3つの**連続するH1**が全部正出来高で、PENGU終値が2本連続上昇。B 最新PENGU終値/3時間前終値-1 >= `0.75 * entryAtr24Ratio`。C BTC最新/3時間前終値-1 >= +0.0015 (0.15%)。D Entry以来、元の正出来高H1終値だけで更新した底値から現在までの戻りが `>=0.75 * entryATRabs`、かつ底値までのsource価格モデル順行幅が `>=1.0 * entryATRabs`。Dは現在以前の確定足のみ。全条件は未観測ならfalse。
4. A+B+C+Dの**2票以上**をP10 buyer pressureと見なす。同じsource holdの**2本連続する完了済み正出来高H1**で2票以上になったときのみ `P10_REVERSAL_CONFIRM_EXIT` を次のH1 open価格モデルで要求。1本のみではWATCHでありEXITしない。もとのnative SOURCE STOP/EXITも毎時間先に評価し、**同じ時刻に競合したらnative STOP/EXIT優先**。native側の状態更新も元と同じ。
5. このP10EXITはSOURCE STOP指定価格や将来MFEからは決めない。次のH1開値が存在しない場合は `RIGHT_CENSORED` として記録。PENGUの次H1に正印字がない場合は**価格モデルEXITであってsigned fillではない**と明示し、印字有無・印字時刻とコストの不確実性を個別に保存。Source P8BでモデルEXITが既存157候補の全期間内に出る保証はない。
6. 経済モデルは**元の全自然SHORT候補を保持**、10/30bps + 追加slippage 0/10/25bps（新P10 EXITのみに保守的に追加）。勝率、平均PnL、PF、native勝ちから損失に落ちた取引とnative負けから勝ちへ転換した取引、利益額の破壊、実際に反転でSTOPに至った件数、前後判定の因果順を個別に監査。
7. P10は**既知結果で修正しない**。元53・人工P8B157・P9 identical-prefix13ペアはすべて既見資料であってOOSではない。今後の別市場/期間が必要。勝率のみの改善や取引数減少、元の1.000655%平均利益/価格PF1.377、人工49.045% baseline/mean+2.595%/PF1.677を破壊する方式は不採用。Synthetic paired13はshock後だけでEXITが分岐してよいが、pre-shockのENTRY/EXITが異なればFAIL。

## 研究の本質的な限界

人工分岐P9で下落継続11/13勝、急反発3/13勝、同じ過去の8件が勝ち→負けに変化。**未来反発を入口時点で正確に知ることはできない**。P10が改善しても、源STOP価格モデル・価格印字の質・注文キュー/ギャップ・Funding/Gross/ポートフォリオDDは別。単純な保証利確やsourceの不明なパラメータ最適化をしない。

成功の意味はあくまでP10を検証・反証すること。PENGU80%達成や本番反映を自動承認しない。PR #595のDraft research branchにコード/全候補台帳/検算を保存、VPS/Production/注文/STOP/HYPEは触らない。
