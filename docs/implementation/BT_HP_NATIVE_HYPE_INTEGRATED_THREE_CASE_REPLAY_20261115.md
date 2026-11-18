# PR #481 — HYPE native TRENDの全Runner統合BT比較・Gross証拠（2026-11-15）

## 判定

**`RESEARCH_SENSITIVITY_DD_WORSE_NOT_PRODUCTION_PARITY`**。既存STABLE4研究モデルのHYPE用H48R4ルート（旧研究5エントリー）を、現行releaseと入口関数が一致する native HYPE TREND の78発火候補へ戻し、統合ポートフォリオエンジンを10bps/30bpsで再実行した。対照実験としてHYPE採用ゼロも実行した。既存STABLE4ファイルは変更せず、別々の出力フォルダを作成した。

| HYPE設定（その他の研究条件を固定） | 10bps 勝率 | 10bps 最大DD | 10bps 最終JPY | 30bps 勝率 | 30bps 最大DD | 30bps 最終JPY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 旧STABLE4 H48研究ルート | 63.19% | −22.60% | 12,442,421 | 60.41% | −23.22% | 4,660,538 |
| native HYPE TREND候補 | 62.70% | **−40.24%** | 7,181,930 | 60.10% | **−27.37%** | 3,702,438 |
| HYPE採用なし | 63.06% | −36.69% | 8,454,251 | 60.29% | −23.71% | 3,889,088 |

全ケースは2025-10-01 00:00 UTC〜2026-10-01 00:00 UTC（終端除外）・初期資金10,000円・10/30bps個別・複利。**すべて元研究エンジンに依存する感度分析で、実約定・現行LIVE全Runner経済パリティは未認証。** HYPE研究系統だけを変更しても元エンジンの時系列資金競合により他Runner採用が変化するため、差額をHYPE単独の因果効果とみなさない。

## HYPEの採用・損益／共有Gate差分

| 項目 | 旧H48 10bps | native 10bps | HYPEなし 10bps | 旧H48 30bps | native 30bps | HYPEなし 30bps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| HYPEモデル採用件数 | 5 | 6 | 0 | 5 | 6 | 0 |
| HYPEモデル損益JPY | +433,996 | −368,382 | 0 | +136,185 | −258,957 | 0 |
| Shared日次損失Gateによるブロック件数 | 60 | 122 | 109 | 65 | 78 | 71 |
| V4採用件数 | 801 | 803 | 803 | 797 | 797 | 797 |
| Q102採用件数 | 107 | 103 | 103 | 107 | 106 | 106 |
| PENGU採用件数 | 45 | 43 | 43 | 44 | 44 | 45 |
| IDLE採用件数 | 10 | 12 | 12 | 11 | 13 | 13 |

nativeケースでHYPEの約定モデル6件は**1勝5敗**、時刻はすべて2026-08-25から2026-09-21の間。10bpsの元モデルHYPE集計は約−368,382円、30bpsは約−258,957円。native vs no-HYPEの同一研究条件では最大DDが10bpsで−3.55ポイント、30bpsで−3.66ポイント悪化。10bpsではHYPEを外しても−36.69%残るため、ポートフォリオ全体の損失連鎖対策が必要。

旧H48モデルではHYPEの一部がformal優先時に早期決済され、残りは研究用48時間出口。旧H48の良好なBTを現行TRENDの成績と混同しない。新TRENDの固定TP+Wallet STOPのモデル決済は別の監査で78/78再計算済み。

## 建玉Gross・DD／台帳の独立整合検証

`scripts/bt_hp_native_hype_integrated_compare.py`で、元エンジン由来のモデルエントリー、決済FILLS、口座残高・Crypto/Stock/Total Gross、各建玉の時価総Grossを**6ケースすべて完全再計算**した。各ケース**105,121時点**を確認。エントリーID・出口ID、元ソースGrossに基づくポジション在庫、売買勝率/Profit Factor、期間初期1万円、DD値と発生UTC、モデルGross内訳が一致。数量、為替、signed venue executionは推測せず未確認と明示。

nativeケースの最大DD時点は10bps/30bpsとも`2026-09-22T11:00:00Z`。旧H48は`2026-08-20T17:05:00Z`、HYPEなしでは10bpsが`2026-09-11T14:00:00Z`、30bpsが`2026-09-22T11:00:00Z`。よって単純な最終残高だけでなく、時系列の最大損失を観測している。

時価変化によりSource Grossが入口上限を超える観測はあり、**最大時価Grossは新規入場時のGross違反を直ちに意味しない**。VPSの将来の実約定、STOP、未使用証拠を埋める推測はしない。

## 再実行可能なコードと出力証拠

- `scripts/bt_hp_native_hype_integrated_sensitivity.py`：元研究wrapper SHA256 `08be27e5c6064e2ff9ada7674697e7c168bdb341e604251ce266fdc3e3ff74ea` に固定。H48追加ブロックのみ除去し元canonicalのnative78候補を復帰。`bt_hp_instrument_research_engine.py` を再利用し元エンジンの建玉Gross観測を追加。`--verify-only` で生成コード検証可能。sourceを上書きしない。
- `scripts/bt_hp_no_hype_sidecar_control.py`：同一ベース・同じGross観測でHYPEだけ採用ゼロの感度ケース。元wrapper/sourceを上書きしない。
- `scripts/bt_hp_native_hype_integrated_compare.py`：10/30bps・旧H48/native/no-HYPEの6ケースの各全時点と実績台帳の整合を独立照合。
- 合成回帰テスト：`tests/test_bt_hp_native_hype_integrated_sensitivity.py`、`tests/test_bt_hp_native_hype_integrated_compare.py`、`tests/test_bt_hp_no_hype_sidecar_control.py`。

Owner PCの3つのPrivateフォルダ（全取引・全建玉を含むCSVはGitHubにPushしない）：

1. `C:\tmp\disdex-bt-20251001-20261001\STABLE4_OPPORTUNITY_PROD_CAPS_20261114_GROSS_CAPTURE_V1`（旧H48モデル）
2. `C:\tmp\disdex-bt-20251001-20261001\STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NATIVE_HYPE_TREND_SOURCE_GROSS_20261115_V1`
3. `C:\tmp\disdex-bt-20251001-20261001\STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NO_HYPE_SIDECAR_SOURCE_GROSS_20261115_V1`

Private比較JSON：`C:\tmp\bt481-native-hype-integrated-threecase-comparison-20261115.json`。SHA256 `D76C1041A4DCF1F7DE544367D57375B33A7BD9C572959AE62FBD2CB1CA912D96`。

## 7系統と管理Runnerの境界（読み取り専用確認）

本番 `/etc/disdex/runner-pins.json` の登録名称は計9項目：`FET_BRK48_RESIDUAL`、`HYPE_TREND_LONG`、`IDLE_PRIORITY_SHORT`、`PENGU_V8`、`QUALITY102_CAUSAL_V1`、`V12_V4`、`V52`、`SHARED_CRYPTO_RISK`、`MARGIN_GUARD`。前者7項目は売買戦略系統、後者2項目は共通制御（Shared Risk/Margin Guard）。旧モデルの採用台帳で7種類の戦略名が確認された事実とは対応。`V12_V4`は1つのRunner pinラベルであり、これだけでV12独立戦略が8番目にあると証明できない。「8ロジック」呼称の独立戦略数と監視Runner数の混同を避ける。

## 今後の実装上の判断

**現行HYPE TRENDをそのまま統合モデルに採用することを推奨しない。** 10/30bpsの双方でDD20%を超過した。保護STOP縮小だけでは連敗と共有資金Gateを改善できない。HYPEのLayer 2 Online判定（勝率・期待値・信頼度）／Layer 3 Portfolio Opportunityを導入するなら、target損失区間に合わせた過学習を避け、事前に定義したOOS/walk-forward期間、別の市場条件、閾値揺らしと本番リスク一致を満たした候補のみ採用する。V4はCodex切替に委ね、PR #481はDraftを維持、Production/注文/STOPへの変更ゼロ。