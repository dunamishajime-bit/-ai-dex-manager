# Q102 / HYPE / Idle DOT・RENDER 出口ロジック実装契約 (2026-10-17)

STATUS: RESEARCH_ONLY, NOT_LIVE. 研究成果の5変更を将来Codexが現LIVEへ移植するための仕様書。
研究SHAはGitHub handoff branchを参照。今のVPS/Production SHAは未監査、未切替。

## 対象政策

| 対象 | 5分足モデルの正確な条件 |
|---|---|
| Q102 | policy Q102_06_FLOOR_2_TO_0p5：価格利益+2%を確定5m足で観測後、建値に対する有利+0.5%をSTOP保護 (LONG/SHORT) |
| HYPE_LONG | policy HYPE_LONG_01_HARD_WALLET_2：口座損失の原則2%に相当する固定STOP、研究版では価格逆行閾値 min(0.25, 0.02 / accepted_gross)。HYPE75入口不変 |
| Idle DOTUSDT | requested Gross0.25x、accepted Gross<=0.25x |
| Idle RENDERUSDT | requested Gross0.25x、accepted Gross<=0.25x |
| Idle DOT + RENDER | policy IDLE_13_TRAIL_3_GIVEBACK_1p5：価格有利+3%で追走有効、確定5m CLOSE最高利益から**1.5パーセントポイント**逆行でSTOP、LONG/SHORT |

対象外のIdle JUP/TAO/TIA、Q102側の既存Family×Side Gross、HYPE75入口、PENGU、V52、FET等の元ロジックやTPを勝手に変更しない。Grossはレバレッジ倍率との混同禁止。

## 確定足の因果タイムライン (研究エンジン m5_override と一致)

D = +1 for LONG, -1 for SHORT
gain = D * (confirmed_5min_close / entry_fill_price - 1)
peak_gain = max(peak_gain_previous, gain)

1. 新しい5m足を評価するとき、**前足までに有効だった既存STOP**をまず次のbar LOW/HIGH/open（ギャップを含む）と比較する。
2. STOP未到達なら、その足が確定してからclose由来gainを計算し、peak_gainを更新する。形成途中の5m足の高値/安値や未来足を使ってstopを設定しない。
3. Q102: peak_gain >= 0.02 なら candidateStop = entry*(1+D*0.005) とし、**次5m足から有効**。
4. DOT/RENDER: peak_gain >= 0.03 なら candidateStop = entry*(1+D*(peak_gain - 0.015)) とし、**次5m足から有効**。
5. LONGなら保護STOPを低下させず、SHORTなら上昇させない。元STOPと比較して保護を緩めない。再起動後にも peak、armed flag、stopQty と orderId を復元。
6. HYPEの2%は口座リスク予算であり価格2%の意味ではない。実装は実fill quantity/price、コスト、他gross、取引所制約に整合させる。STOP価格での約定は保証されない。
7. 競合するoriginal hard STOP / time exit / dynamic exit / trailing exit / manual closeのうち先に有効になった条件と約定を、同一position_idで一意に統合。STOP保護を消さず、reduce-onlyとread-backを使う。

## SAFE LIVE受入れゲート

- 現行source SHA、live release/rollback、Runner全生死/重複、venue openPositions/OpenOrders、各resident STOP/AVG fill、Margin Guard、Shared Risk、AccountLock、rate budget、Kill Switchを監査。
- Position部分約定→resident STOP受理/読み戻しの照合、差分qty保護、重複STOPを禁止。正常STOPを失う cancel-before-replace不可。停止/再起動復旧、通常EXITとSTOPの競合も再現。
- BTC/5mデータ欠損、価格乖離、境界（future lookaheadと未確定足禁止）、LONG/SHORT逆算、サイズ0.25xの数量丸め、残額margin/minNotional、損失stopギャップの回帰テスト。
- LIVE相当で10bps/30bps再BT、現行比較、slippage50/100bps stress、別期間holdout。月次と同時建玉容量競合も確認。
- Originalモデルと候補モデルの差分を混同しない。研究元の3 overlay（Q102 MR H1、V12 G5 H1、V12 X05 H1）は先行研究であり今回自動採用しない。
- Codexによる実装可否/認証/実注文準備は別の作業。**本研究成果push自体はLIVE変更を許可しない。**

## モデルの限界

Binance Vision USD-M 5mをAster H1-entryに価格正規化するhistorical price model。HYPEの元TPとの互換性、部分約定・Funding/Spread、保護STOPの実約定、板・Mark Price・欠損は未認証。DD 15%以下未達。検証インサンプルで過学習があり得る。
