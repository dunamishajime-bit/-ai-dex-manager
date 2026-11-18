# PR #481 — 10/30bps Shared Risk・Gross・V52分母スケールの出所監査（2026-11-15）

## 判定

**`SOURCE_MODEL_EVENTS_RECONCILED_V52_SCALE_REVIEW_REQUIRED`**。対象年 2025-10-01 00:00〜2026-10-01 00:00 UTCのSTABLE4/native HYPE研究台帳を、10bpsと30bpsそれぞれ**105,121個の5分MTM証拠**、2,122の候補Decision、Shared Riskイベント、V52戦略固有リスクイベントを元CSVから直接再集計した。研究用モデルであり、正式Aster実約定・現在のLIVE Shared Riskを意味しない。新V4 SHA `e788abc8...` の経済パリティは先行監査でFAIL CLOSEDのまま。

### 時点整合と7.5% Shared Risk

| モデルの観測 | 10bps | 30bps |
| --- | ---: | ---: |
| MTM時点（5分、末尾のみ翌年終端） | 105,121 | 105,121 |
| 元モデル候補判断 | 2,122 | 2,122 |
| MODEL_ENTER（期末未決済1件含む） | 1,025 | 1,026 |
| 日次損失GateがTrueの時点 | 2,846 | 2,108 |
| Gate=Trueの時点に新規MODEL_ENTER | **0** | **0** |
| `DAILY_LOSS_7P5_GATE` BLOCK | 122 | 78 |
| Shared Risk `TRIP` | 16 | 13 |
| Shared Risk `FLATTEN`（モデル上の手当） | 9 | 8 |
| 研究モデル最大5分MTM DD | **−40.24%** | **−27.37%** |

全Shared Risk TRIP/FLATTENの `loss_pct` を、同イベントの `reference_equity_jpy` と `settled_crypto_pnl_jpy + unrealized_crypto_pnl_jpy` から再計算した結果、一致。TRIP時刻のequityゲートTrueも一致。**Gateが正しくモデル内で作動した証拠であり、約定所でSTOP/flattenが成立した証拠ではない**。FLATTENイベントも実署名注文の証拠ではなく研究モデル台帳。

### Grossの「新規Admission制限」と「保有後の時価変動」を区別

| 5分MTMで上限超過した証拠時点 | 10bps | 30bps | 適用上限 |
| --- | ---: | ---: | ---: |
| Crypto Gross | 236 | 262 | 3.0x |
| Stock Gross | 2,495 | 2,721 | 1.5x |
| Total Gross | 170 | 214 | 3.5x |

最大観測値は10bps Crypto **3.1954x**／Stock **1.6380x**／Total **3.6824x**、30bps Crypto **3.2034x**／Stock **1.6509x**／Total **3.6978x**。全時点で `crypto_gross + stock_gross = total_gross`、`v4_gross <= crypto_gross` を確認。**これらは時価評価後のGross**なので、エントリー時に上限超過の注文を通したという証明にはならない。同時に、常時上限3.5x以下という保証もできない。新規注文前の既存建玉・価格・予約資金・Limit/STOPを再構成したモデル外の本番証拠が必要。

### V52の極端な損失率：追加レビューが必須

- V52モデル固有の`V52_DAILY_LOSS_3P5`は10bps **122 TRIP**／30bps **124 TRIP**、`MISSED_CHECKPOINT_FAIL_CLOSED`は両費用6 DEFERRED_EXIT。
- `loss_pct = -100 × (realized_strategy_pnl_jpy + unrealized_strategy_pnl_jpy)/strategy_capital_jpy` の式は全TRIPで再計算一致。しかし、研究中期からV52の損失率分母が約**799.93円**のケースが多く、10bps81件／30bps83件で確認（分母を小数第2位で集約）。
- 2026-05-15 00:00Zの10bpsで分母 **799.93円**、V52未実現PnL **−204,442.92円**、研究モデル報告損失率 **25,557.49%**。同時刻の全口座MTM評価額は**約123万円**。30bpsでは **14,294.29%**、全口座MTM評価額約65万円。
- 10bpsは分母千円未満・報告損失率1000%超・口座額10万円超のケースが **66件**、30bpsは**67件**。式の単純計算誤りではなく**損失率の分母スケール・V52専用口座配賦・未実現PnLの帰属**が研究中のコンパウンド口座額と適切に対応しているか未確認という問題。意図された固定バケットの可能性もあるため、実装バグと断定しない。

**V52のGateを、この異常な比率を根拠に勝手に緩和・停止・本番更新しない。** 分母の由来をSourceコード・時点前ルール・固定/動的資本配分の設計から再現する必要がある。研究中の利益・DDを良く見せるための後知恵Gate変更は禁止。

## 再現コードと証跡

- `scripts/bt_hp_shared_risk_v52_mtm_gross_audit.py`：2費用の全5分時点、連続性、terminal日付、equity初期/終端、Grossカテゴリ合算、daily gateとmodel entryの時点照合、Shared Risk計算、V52固有リスク分母、Manifest countなどをfail closedで点検。
- `tests/test_bt_hp_shared_risk_v52_mtm_gross_audit.py`：13ユニットテスト。全BT Python **217件PASS**。
- Private出力：`C:\tmp\bt481-shared-risk-v52-gross-audit-20261115.json`、SHA256 **`B73F9DE6359EC02E02DCD38F3667C937B7E2312B2200142C3C7DA9AD314C1B81`**。証拠元CSVのSHA256も監査JSON内部に保持。

## 未達成の正式Gate

全体MTM DD20%以下には達していない。DD・勝率の数値はSTABLE4の本番差分残存研究モデルであり、新V4/LIVEの実装完全一致ではない。V52未実現PnLと分母を独立に照合してから複合判定の比較を進める。元研究の過学習防止・新V4 immutable source取得・Owner正式承認によるHP反映は継続タスク。今回、Production/VPS設定・取引・STOP・Kill Switch変更0件。