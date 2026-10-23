# PENGU SHORT V20｜2段階ソフト損切り採用決定（2026-10-24）

STATUS: USER_ADOPTED_FOR_IMPLEMENTATION / NOT_DEPLOYED / LIVE_UNCHANGED

## 決定
ユーザーの2026-10-24の明示指示「ショートの損切は2段階を採用したい」に基づき、通常PENGU SHORT V20に対して以下の追加STOPを**実装採用**とする。先行研究の「3hはShadowのみ」判断に優先するユーザー決定である。ただし損切り効果の外部妥当性を証明したという意味ではなく、実取引所への適用可否・安全認証は別に扱う。

1. **3時間後・価格損失2.5%以上**：実平均SHORT SELL建値と、3hチェック時点以降最初に確定するM5終値を比較。建値比+2.5%以上（SHORT損失）なら所有するSHORT残数量のみBUY reduce-onlyで終了。
2. **8時間後・価格損失4.0%以上**：3h時点で未決済かつ8hチェック時に保有している場合、同様に建値比+4.0%以上なら終了。
3. 各チェックは建玉ごとに**一度だけ**、再起動後にもチェック済み／退出済み状態を保持し二重注文禁止。確定M5欠落・不整合は異常通知、事後補間や将来値使用禁止。
4. **従来SHORT−8% venue hard STOPを常設維持**し、ハードSTOP、利確、トレーリング、72h最大保有等の既存出口、クールダウンを上書きしない。
5. **LONG_V2_FINAL、Recovery V8 LONG（−6% HARD STOP）には適用しない**。他の7ロジック、RESIDUAL AVAX承認済み6条件およびShared Risk/Margin Guard/Kill Switchを変更しない。

判定損失率は**価格ベース**であり、ROEやレバレッジ後の損益率ではない。研究のM5スポット比例補正価格をLIVEで使わず、venueの実平均約定価格・実約定時刻・取引所正本価格を使う。研究上の次M5始値約定は保証値でない。

## 採用研究証拠（参考）
2025-08-10〜2026-08-10、全8戦略・AVAX6条件固定・動的再選択／共通財布の研究BT：

|指標|BASE|2段階SHORT STOP|
|---|---:|---:|
|10bps最終資産|268,310,796円|274,143,937円（+5,833,140円）|
|10bps最大MTM DD|−14.51499%|−14.51499%|
|30bps最終資産|158,222,978円|163,776,887円（+5,553,909円）|
|30bps最大MTM DD|−15.78569%|−15.01472%|
|PENGU勝/取引|50/67|50/67|
|元−8%硬STOPを先取り|0件|2件|

個別同一SHORT二件の価格モデル損失削減合計は10bpsで718,150円。**2件のみのインサンプル発動**であり、3h−2.5%は2.53153%（閾値から0.03153pt）で発動し、2.55%へ緩めず厳格化すると該当0件。ユーザー承認はこの境界感度・過学習リスクを消去するものではない。独立OOS、forward-shadow、実venue注文ACKの証拠は未成立。

一次資料：
- `docs/implementation/PENGU_SHORT_TIMED_NEGATIVE_DUAL_STOP_RESEARCH_HANDOFF_20261023.md`
- `docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_FINAL_DECISION_20261023.md`
- `docs/research/results/pengu-timed-negative-20261023/PENGU_TIMED_NEGATIVE_THRESHOLD_ROBUSTNESS_ADDENDUM_20261023.md`

## 他のPENGU SHORTの変更／不変条件
- **SHORT_V20**：既存のVOL_TARGETの確定H1失速EXIT、CAP/FLOORの既存ライフサイクルは維持。
- **限定2% structural re-break**：2026-10-05既存採用内容を維持。
- **新規PENGU gross 1.0**：2026-10-04既存採用内容を維持。既存保護注文のロット・価格を勝手に変更しない。
- **M05 72h return shadow**：2026-10-07観測専用。発注gate化しない。
- 2026-10-23の**SHORT PENGU−BTC相対3h/6h入口veto**：全8統合BT減益のため不採用、今回追加しない。
- 従来のSHORT−8%ハードSTOP、クールダウン、24h hard-stop cooldown、安全ゲートは維持。

## 実装・検証・切替条件
この文書は**採用記録および実装依頼の仕様**であり、LIVE切替・Production更新・注文・取消・建玉操作の承認完了証明ではない。

実装時は現行Production SHA・現在の保有PENGU残数量・保護注文、ownership、pending exposureとaccount lockを読み取り確認する。保護注文のvenue ACK、reduce-only、部分約定、通常EXITと3h/8h STOP競合、再起動による重複防止、stale M5、rate-budget、Margin Guard、Kill Switchの回帰テストを完了する。旧−8% hard STOPを先に消さない。検証後は正本BTと一致する3h/8h境界・時刻ずれのケースを測定し、変更は専用実装ブランチでPushしてSHA・CI・roll-backを確保する。安全認証ができなければ実注文を開始しない。

Production/VPS/LIVE/HP/positions/orders: NOT MODIFIED by this documentation-only commit.
