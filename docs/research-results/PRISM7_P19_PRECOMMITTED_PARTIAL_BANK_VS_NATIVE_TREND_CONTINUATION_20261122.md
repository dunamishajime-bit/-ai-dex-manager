# PRISM VII P19 — BTC confirmed MFE3反転で部分利確し、残りSOURCE nativeでトレンド継続 (経済結果前登録)

**研究仮説に過ぎずLIVE未採用。** P18既見全量決済はnative source/P14勝ち29維持、P14負け→勝ち6件で52件勝率29→35になるが元勝ち利益額を削り、30bps mean+0.858779→+0.568674、PF1.314102→1.260399（強BTC条件）。次の疑問は**取引数を削らず大幅下落トレンドへの残存ロットを維持しても、部分利確で損失を少し改善できるか**。この仮説も既見53/既見P18 signalからの研究であり未見OOSではない。

固定SOURCE pinned `1657e173d250ad58f53e62f7bb0a3428fb405496`、P14 event-time SOURCE native closeout 52/53 and no-print 1 retained。P18の2種類のBTC confirmed EXITについて、MFE3/giveback signal, native STOP優先、M5 positive next-open proxy、trigger時間と価格は一切変更しない。BTC M5の1不正足の観測窓外隔離 (P18A) を維持。

**事前固定する部分利確率：** 25%、50%、75%、100%（全量P18と経済完全一致するコントロール）、0%（SOURCE P14元出口完全一致コントロール）。early signalが発火した場合、その時点で短期SHORTロットの指定割合だけをbuy to coverしたと仮定し、残りは**元SOURCE P14 native STOP/EXITの価格代理を保持する**。SOURCE P14側でトレーリング・期限やポジションサイズ依存のstateを再計算しないため、純粋な**仮想キャッシュフロー配分テスト**であり本番実行可能な分割注文・native residual engineと同値ではない。実装上この差を隠さない。

- **PnLは sourceOriginal gross * (1-f) + P18 early gross * f - (10/30bps total entry&exit cost) - (added early exit slippage 0/10/25bps * f)**。仮にsource tradeが証拠なしならnullのまま、53原intentは残す。0%/100%には固定式で経済一致保証。
- 固定条件 2 signal rules×5 fractions×2 fees×3 extra-slip=60 economic scenarios×53 native intents =3180 detailed rows。source 53 original intentsは**いかなる場合も減らさない**、同時に価格観測可能52件と源SOURCEの同じ52件を比較。source winning dollar PnL total delta, source loser profit total delta, win count, PF, mean, fee stress、each cohortを個別記録。
- 数学的に元SOURCE P14の全価格観測52件との差は、固定triggerの場合 **f × (P18 FullCloseMean - P14 Mean) − f × exitSlip**。P18 FullCloseMeanは両BTCルールともSOURCE baseline未満だったため、**どの固定f>0でも平均利益を改善することはできない**。実行前の否定的予測として固定し、出来高/リスクの改善やPFの非線形変化がたとえ改善しても、源勝者の元利益総額が失われているかを必ず表示。結果を見て割合を最適化しない。
- source tradeが途中で分割されてパフォーマンスが変わるLIVEエンジンはまだ無い。実約定、分割手数料、注文競合、multi-runner gross、funding、gross position DD、OOS、portfolio DD 20%はすべて別検証。PENGU80%の達成宣言は禁止。
- PRE/BASE/POST cohort分割、コード/元53×3180ケース台帳/全SHA＋unit testsをDraft PR #595研究のみへ保存。Production VPS/MASTER/Runner/STOP/実注文/HYPE等は変更しない。

採用条件はSOURCEを含む全経済指標と未見市場での優位性。失敗なら明確にREJECTし、追加閾値の最適化ではなく**出口反転の識別情報自体が不足する**という根本課題へ戻す。
