# BT #481 — 現行HYPE TREND入口78候補のLayer2/Layer3 as-of Shadow（2026-11-15）

## 判定

**`ASOF_DESCRIPTIVE_SHADOW_ONLY_NO_LAYER2_OR_LAYER3_ADOPTION`**。native HYPE TRENDの確定H1発火候補78件に対し、その候補の時点より**厳密に前に終了した**旧pin HYPE単独研究取引のみを使って、Layer2参考値（過去勝率・平均口座損益・95% Wilson区間）を計算した。Layer3は当時の研究モデル源Grossと他Runner占有を参照するのみで、期待値に基づく採用順位は**出さない**。対象年の結果を見て閾値を合わせた採用Gateは一切設定していない。

## 検証条件

- 期間：2025-10-01 00:00〜2026-10-01 00:00 UTC（終端除外）。HYPE TRENDの入口78候補は前回のnative H1回放で78/78一致し、モデル出口はH1/M5照合で78/78一致済み。
- 単独研究モデル：10bps/30bpsそれぞれ元台帳56取引（15勝41敗）。元取引損益・単独一枠・Fundingモデルの整合性は既存 `bt_hp_hype_single_slot_loss_audit.py` により再検証。
- Layer2時系列：候補entry時刻Tで `exitTs < T` の元モデル取引に限定。同時刻終了は**採用しない**。学習に使用する過去サンプルは直近20取引の固定窓（事後最適化しない）、Beta(1,1) posterior mean `(wins+1)/(n+2)`、Wilsonの過去標本区間、モデル口座収益率の20件平均を参考表示。n<20は`INSUFFICIENT_PAST_CLOSED_TRADES`、n>=20も`EXPLORATORY_ONLY_NOT_CALIBRATED`。いずれもエントリー／採用・棄却権限なし。
- Layer3時系列：統合研究モデルの`POSITION_GROSS_SNAPSHOTS.csv`から候補時刻Tと同時点の元モデル建玉（Crypto／Stock／合計Gross、稼働中の研究Runner系統）を読み込む。他Runnerの同時点のOnline EV・信頼区間・候補priority、signed Kill Switch/V4 STOP ownerは未整備のため競合候補の採用価値を比較不能。研究元Grossは実数量・取引所証拠ではない。

## 実測

| 項目 | 10bps | 30bps |
| --- | ---: | ---: |
| 発火候補 | 78 | 78 |
| 旧単独モデル採用取引 | 56 | 56 |
| 直近20件の過去完了取引を確保している候補 | **51/78** | **51/78** |
| 最終候補までの過去完了取引数 | 55 | 55 |
| 最終候補の直近20件・勝ち | 6 | 6 |
| 最終候補のBeta(1,1)平滑化過去勝率 | 31.82% | 31.82% |
| 最終候補の直近20件平均モデル口座損益 | +0.172% | −0.086% |

最終候補の出力は2026-09-22 18:00 UTC時点の**参考的な過去観測値**であり、事前キャリブレーションされた推定勝率ではない。対象年の時系列で得られた推移なので、運用適用には別の市場期間・発火規約を固定したOOS/WF、人工相場、sleeve競合、閾値揺らしを通す必要がある。30bps側の過去平均口座損益は最終候補時点で負であるが、これを見て任意の棄却閾値を選ぶとtarget outcome利用になるので禁止。

## 安全性・再現性

`scripts/bt_hp_hype_native_online_layer23_shadow.py` は、単独HYPE元台帳を再検算してから78個の入口について厳密過去closedのみでモデル参考値を算出。Source Grossと他戦略占有も元の研究台帳の同時点しか使用しない。出力の `candidateSelectionAuthorized=false`、`competitorExpectedValuesAvailable=false`、`portfolioGateCertified=false`、`productionMutationCount=0` は固定しておく。

`tests/test_bt_hp_hype_native_online_layer23_shadow.py` で9件の合成テスト：同時刻Exit除外、未来の勝敗を書き換えても過去スコアは変わらない、直近20件窓・最小履歴境界、未知時間／区間、後知恵採用権限の不付与。Python BT全147件PASS。

Private監査データ：`C:\tmp\bt481-hype-native-layer23-asof-shadow-20261115.json`。SHA256：`F944AB77B93124854A7AAF90B81E040D1BF15C2F3C873C419007BC103957297F`。GitHubには秘密情報/生取引記録はPushせず、ソース・テスト・方法・非機密集計のみ保存。

## 未完了・次への引き継ぎ

現行TRENDのLayer2/Layer3は依然Shadow/研究だけ。実戦の候補採用とは結びつけない。次工程はQ102/PENGU/V4等の候補の同時刻以前情報だけから独立EV・confidenceを生成し、Gross 3.0x/Stock1.5x/Total3.5x、Shared Risk7.5%、STOP所有、発注中の競合、模型実際のqty/tickと実約定まで統合すること。独立OOS期間で有意な改善を示さない限り採用しない。V4本番切替はCodexへ任せ、PR #481はDraft、HPデプロイ・注文・STOP変更0件。