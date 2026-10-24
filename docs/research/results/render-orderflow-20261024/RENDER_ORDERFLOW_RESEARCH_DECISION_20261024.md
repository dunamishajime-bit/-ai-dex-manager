# RENDER SHORT：OI・成行フロー・資金調達率を使った因果研究（2026-10-24）

**STATUS: RESEARCH_ONLY / NOT ADOPTED / NO LIVE, PRODUCTION, VPS, HP, ORDER CHANGE**

## データの信頼性

- Binance Vision USD-M RENDERUSDT 公開アーカイブ799件取得（metrics日次761、fundingRate月次25、後半5分足月次13）。
- 全799件ZIP CRC合格、SHA-256記録。公開 .CHECKSUMとの照合799/799一致。結果 `RENDER_ORDERFLOW_PUBLISHER_CHECKSUM_PARITY_20261024.json`。
- OI metricsは219,071有効スナップショット、値の不正92件を除外、同時刻重複0。2024-08〜2026-08。
- オリジナルの古い12か月M5は既存SHA検証済みアーカイブを再利用し、直近13か月のBinance公開M5と既存native bootstrapの価格系列の全本数・時刻・終値一致を確認。
- metricsの2026-06-25ラベル定義変更を考慮し、create_timeから10分後に初めて使用可能とする保守的な因果規約で計算。funding rateはcalc_timeから5分後のみ採用。遅延・未確認はFail Closed。
- フローはBinance先物OHLCVの`taker_buy_volume`とvolumeから（2*taker_buy - volume）/volumeとして符号付き計算。
- 母集団研究窓：古い2024-08-10〜2025-03-31を学習、2025-04-01〜07-31を閾値確認、2025-08-10〜2026-08-09を後半の研究再検証。これらは過去に研究済みで**真の未使用OOSではない**。
- Binanceの市場価格/先物指標はAster実注文の約定・板・funding/保護注文を代替しない。

## 比較A：元の価格4ファミリー × フロー/ポジション指標アンサンブル

全入口/出口の比較はRENDER単独でのH1確認・次5分足始値の市場価格・M5 STOP先着・12時間クールダウンを再計算。資金調達料は予測特徴量としてだけ使用し、損益会計には加えていない。

| 30bps（2025-08〜2026-08） | 件数 | WR | PF | 過去年cal PF | 研究年後半PF |
|---|---:|---:|---:|---:|---:|
| 価格のみ・q0.75 | 158 | 56.33% | 0.7504 | 0.6459 | 0.7334 |
| 価格＋OI・q0.75 | 163 | 57.67% | 0.7999 | 0.5568 | 0.8474 |
| 価格＋OI・q0.85 | 111 | 61.26% | 0.9291 | 0.2862 | 1.0893 |
| 価格＋OI＋成行・q0.60 | 234 | 57.69% | 0.8430 | 0.5811 | 0.9055 |
| 全情報・q0.60 | 235 | 56.60% | 0.8337 | 0.4313 | 0.9053 |

calibration30bpsとcalibration10bpsが両方PF>1で件数>=18の候補は**0**。つまり魅力的な後半の局所PFだけから採用しない。

## 比較B：独立して新規発火する9つのフロー確認型SHORT × 3出口

事前固定の複合シグナルとしてOI吸収天井、新規SHORT+BTC下落、スクイーズ失速、弱気戻り売り、funding crowded long、相対弱化・売り圧力、STOP hunt失速、LONG清算継続、直前2HからのOI・売買フロー転換を比較。

- 学習に使わない過去年calibrationで10/30bps PF1.0超の条件と件数閾値を満たしたモデルは2つ。ただし**後続2025-26年でどちらも大幅損失期待値**。
- LONGS_EXIT_CONTINUATION / TP2.5 SL3 18h：過去年cal PF1.5335、研究年40件 WR42.5% PF0.5232。
- OI_NEW_SHORTS_BEAR / TP2.5 SL3 18h：過去年cal PF1.3727、研究年58件 WR44.83% PF0.6121。
- いずれも8戦略の資金割当は未計算。単独収益を8ロジックPFや口座円利益として報告してはならない。

## 比較C：全8ロジックで既に採択されたRENDER24件の入口時点を事後解剖

`IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json`の30bps採択24件に、因果的に利用可能だったOIと成行売買方向を追加照合。

- 全24件 12勝/24（50%）、個別単純損益の合計+0.731%。1〜3月3/12勝、4〜8月9/12勝。
- 成行売り優勢度（1h中央値）：1〜3月 0.001、4〜8月 0.102（強いレジーム差）。
- ただし成行売り符号だけで区切ると、売り優勢14件7勝、買い優勢10件5勝でどちらも**勝率50%**。単純な「成行売りならSHORT」は利益の説明にならない。
- OI増加+売り優勢6件4勝、OI減少+売り優勢8件3勝、OI増加+買い優勢4件1勝、OI減少+買い優勢6件4勝。各セルn=4〜8件と小さく、過学習防止のため採用せず。
- 決済内訳：TIME EXIT 16件中8敗、利益下限+0.25%のfloor4件は30bps費用控除後4敗、5M保護STOP4件4勝。
- 別native監査 `IDLE_RENDER_DOT_JUP_INITIAL_ADVERSE_ENTRY_PATH_20261024.json`との経済コホート一致を検証。**採択時刻24/24一致、決済理由24/24一致、30bpsモデル損益率24/24完全一致**。candidateIdは生成順序の違いで一致7/24に過ぎないため、ID同士で結合してはいけない。時刻でjoinしたうえで損益契約を比較する。

## 比較D：別native研究台帳24件の2〜4hフロー早期損切り診断

OI減少、買い優勢、一定の初期逆行などを組み合わせた6ケースを、すべて保守的なnext-M5約定で静的検証。

- 6方式すべて元台帳の単純損益合計より悪化。
- 2h買い優勢時に切る：4件変更（元の勝ち2件も切る）、30bps損益率合計差-8.929ポイント。
- 3hに買い優勢＆OI減少＆初期逆行：2件変更（いずれも元負け）でも損益率合計差-1.725ポイント。
- 最初からマイナスへの対応を早めても、より後の下落で回復するトレードの利益を失う。対象は採択時刻・出口理由・損益率が完全一致する24件だが、仮想EXIT後に共有口座で再選択した8戦略BTの結果ではない。

## 判定・契約

- **新入口採用0、新EXIT採用0**。新モデルはどれも10bps・30bpsの両期間で安定して利益を維持する採用基準に届かない。
- 現行RENDER採用候補の入口条件・利益保護、AVAX/PENGU等他戦略、Shared Risk、Gross、所有権、DD停止条件、VPS/LIVE/Production/HPは変更しない。
- 特徴量追加・新ルート・出口の候補探索は学習窓/調整窓/OOS研究窓を固定した **causal historical diagnostic** として扱い、実取引所での約定証拠や全8ロジック経済改善と混同しない。
- 次の判断は、現行8ロジックの正本SHA・発注枠・ウォレット/約定情報と照合できる統合BT、2026-10-24以降の未使用Forward Shadow、Aster実取引所fundingと注文ライフサイクルの取得を必要とする。
- 新エントリー発火総数を増やすときは、RENDERのトレード数、勝率とPFだけでなく主要戦略の機会損失・30bpsでのDD変化まで必ず確認。

## 研究ファイル

- `scripts/dd-reduction/acquire-render-orderflow-history-20261024.py`
- `scripts/dd-reduction/verify-render-orderflow-official-checksums-20261024.py`
- `scripts/dd-reduction/render-orderflow-composite-20261024.py`
- `scripts/dd-reduction/render-flow-new-entry-routes-20261024.py`
- `scripts/dd-reduction/analyze-render-native24-orderflow-20261024.py`
- `scripts/dd-reduction/render-native24-flow-risk-exits-20261024.py`
- `docs/research/results/render-orderflow-20261024/*.json`
