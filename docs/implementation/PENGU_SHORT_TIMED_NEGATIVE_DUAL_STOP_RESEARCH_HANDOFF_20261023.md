# PENGU SHORT V20｜時間経過型2段階STOP 研究採用候補・実装引継ぎ（2026-10-23）

**状態：研究採用候補／LIVE未反映。ユーザーからの「−8%ハードSTOPは残して別途、一定時間マイナスを切る」要望を研究上満たす。**

## 対象・不変条件

- 対象：PENGUUSDT の SHORT_V20 **ショート建玉のみ**。通常LONG（LONG_V2_FINAL）およびRecovery V8 LONGには適用しない。
- PENGU既存の **−8% ハードSTOP**、既存トレーリング・通常EXIT・最大保有期限・クールダウン、Recovery V8 の **−6% ハードSTOP**を変更しない。
- 他7ロジックおよびRESIDUAL AVAX採用済み6条件、Global Risk/Margin Guard/Kill Switchを維持する。
- 今回の新STOPは既存出口より**先に成立した場合のみ決済**する追加条件。通常の決済・ハードSTOPの発注ライフサイクルを上書きしない。

## 条件

1. エントリー（実平均約定価格・時刻）から**3時間経過した時点**の確定5分足終値が、価格ベースでショート建値比 **+2.5%以上逆行**している場合は、当該ショート建玉の所有数量を成行BUY reduce-onlyで閉じる。研究BTでは判定足確定後の次の5分足始値で約定を評価。
2. 3時間時点でこの条件に該当せずまだ建玉がある場合、エントリーから**8時間経過した時点**の確定5分足終値が、建値比 **+4.0%以上逆行**している場合は同様に決済。
3. 各時点の条件は**1回のみ評価**。前の時点で決済済みなら後段は判定しない。リスタート時には既に過ぎた時点の判定／決済済み状態を復元し、新規注文の二重発行を防ぐ。
4. M5確定データが未取得・不整合の場合、後から補間して発火したことにせずFail Closed、異常通知。既存ハードSTOPの取引所保護注文は常設のまま維持する。

### PRICE側の意味

ショートの損失価格率は `(判定価格 / 実平均SELL約定価格 − 1) × 100`。+2.5%または+4%の価格上昇が条件。証拠金に対するROEや手数料控除後の損失率とは異なる。研究BTのM5比例スケールをLIVEに流用禁止。

## リスク・実注文の必須認証

- ハードSTOPのネイティブ取引所注文ID、STOP MARKETトリガー基準、取引所ACK、注文残存数量・Reduce-only／close-only相当を実測。保護注文が存在しない状態を正常なLIVEと判定しない。
- 利確／時間決済／3h・8hソフトSTOP／既存ハードSTOPが競合しても、同一数量の過剰決済・逆ポジション発生を防ぐ。注文・建玉の所有権が曖昧なら新規注文をFail Closed。
- 部分約定、時刻起点（シグナル時刻ではなく実平均約定後の建玉開始時刻）、プロセス再起動と二重発注のIDEMPOTENCY、STALE M5、Pending Exposure、Account Lock、Margin Guard、Shared RiskとRate Budgetを回帰テスト。
- 実取引所の平均約定時刻が5分足の境界からずれる場合は、期限後**最初に確定したM5**の時点で一回判定する。研究エントリーは5分足境界モデルなのでこの違いは正式認証前に仕様差分として検証する。
- 本番保護STOP注文は残存建玉に対して常設。ソフトSTOP約定後、旧ハードSTOPの安全な取消ACKと建玉ゼロ照合が取れるまで状況を監視する。
- 取引所での約定が閾値価格どおりになる保証はない。ギャップ・スリッページにより新STOPの約定損失が2.5%／4%を超える場合がある。

## 経済エビデンスと制約

2025-08-10〜2026-08-10の全8ロジック研究統合BTで、10bps 最終資産 **274,143,937円**（基準比 **+5,833,140円**）、最大DD **−14.51499%（不変）**。30bps 最終資産 **163,776,887円**（基準比 **+5,553,909円**）、最大DD **−15.01472%（基準−15.78570%から改善）**。PENGUの勝敗50/67不変、発動2件、元の−8%ハードSTOP2件を先取り。

同一2件の個別損失削減は10bpsモデルで**合計718,150円**、30bpsで**706,160円**。ただし20候補×両コストを同一期間で探索し採否選択しており、独立OOSもvenue約定の証拠もない。単なる経済利益の正本やLIVE保護の認証ではない。

研究正本と再実行：

- docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_FINAL_DECISION_20261023.md
- docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_NATIVE_FULL8_COMBINED_20261023.json
- docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_NATIVE_FULL8_AUDIT_20261023.json
- scripts/dd-reduction/research-pengu-timed-negative-native-full8-20261023.py
- scripts/dd-reduction/research-pengu-timed-negative-screen-20261023.py

**次のゲート：独立期間・前向きShadowと、現行Production PENGU SHORT V20のSTOPライフサイクル・venue認証。これらが揃うまではProduction変更・LIVE切替・注文送信を完了と宣言しない。**
