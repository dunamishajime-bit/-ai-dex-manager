# BT #481 — HYPE native Layer2のprequential検証（2026-11-15）

## 判定

**`HISTORICAL_PREQUENTIAL_SHADOW_NO_INDEPENDENT_OOS_NO_PROMOTION`**。前段のHYPE native Layer2 as-of Shadowにある直近20件の過去終了取引によるBeta(1,1)平滑化勝率を、次に採用されたHYPE単独モデル取引の**終了後の勝敗**と比較してBrier Score/LogLossを検証した。予測計算では必ず`exitTs < newEntryTs`のみを使用し、当該取引以降の結果を含めない。後日の勝敗ラベルは精度評価にのみ用いる。

比較のもう一方は、同じ時点で終了済みの**全過去取引**によるBeta(1,1)平滑化勝率。直近20件のスコア計算規則は前段Shadowから引き継いだ固定ルールだが、全過去baselineとの比較は独立OOS市場で事前登録されたテストではない。したがって結果は**同一年度・単独モデル採用サンプルのprequential参考評価**であり、無作為サンプル・本番約定・別市場でのキャリブレーションではない。

| 過去モデルのprequential評価 | 10bps | 30bps |
| --- | ---: | ---: |
| 単独モデル採用取引 | 56 | 56 |
| 20件以上の事前終了履歴がある予測対象 | **36** | **36** |
| 評価対象の勝ち取引 | 10 | 10 |
| 評価対象の事後勝率 | 27.78% | 27.78% |
| 直近20件Beta(1,1) のBrier | **0.216196** | **0.216196** |
| 全過去Beta(1,1)基準のBrier | **0.205941** | **0.205941** |
| 直近20件がBrier改善 | **NO** | **NO** |

Brier Scoreは小さいほど二値事象の確率予測に適合している。直近20件のオンライン勝率参考値は全過去baselineより **0.010255悪化**。10bps/30bpsで勝敗集合が同じため二値Brierも一致するが、同期間のモデル口座損益は費用に応じて異なる。ここから「20件窓が最適」「複合判定を採用して利益改善」とはいえない。むしろ**Layer2は現時点で正式採用不可**という根拠を強める。

対象年の結果を見て最近件数20・しきい値・p値・Gross配分を再調整したり、36件の採用サンプルだけを使って未来の勝率70%達成を主張することは禁止。独立市場期間（2026-10以降など）、実価格の前向き再現、Layer3他Runner EVとの同時点比較、偽陽性、閾値揺らし、複数コスト、統合MTM DD20%以下の反証的検証を要する。

## 検証実装と証拠

- `scripts/bt_hp_hype_native_layer2_prequential_eval.py`：元単独56取引を再監査、78候補のas-of履歴と一致照合した後、過去履歴20件以上の36個のモデル採用取引の予測と事後勝敗を評価。score算出はトレード発火時刻以前の履歴のみ。未来の取引結果は予測に混入しない。Model selection/production changes無し。
- `tests/test_bt_hp_hype_native_layer2_prequential_eval.py`：7件、Brier/LogLossの算術、境界、無効確率拒否、未知元資料をfail closed。全BT Pythonテスト160件PASS。
- Private証跡：`C:\tmp\bt481-hype-native-layer2-prequential-eval-20261115.json`。SHA256 `DBB1356543CDAB0B22936E4AE5647798ED0D764926CD4493A965D16286233832`。

引き続きLayer2/3はShadowのみ。現行LIVE Runner・注文・STOP・Kill Switch・V4（Codex担当）を変更していない。PR #481 Draft、HP正式デプロイ未実施。