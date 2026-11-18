# BT #481 — V4 REC_Y06の対象年前後・出口改善根拠の監査（2026-11-15）

## 判定

**`Y06_NO_REPRODUCED_PRETARGET_EXIT_OR_ONLINE_GATE_DO_NOT_PROMOTE`**。V4の `REC_Y06_REV_D0_T72` （固定SHORT）の出口時間短縮とProfit Lock、Online skip Gateの既存研究結果を、元ソースの算術・期間・選抜方針とSTABLE4統合モデルに照合。対象年の負けだけに合わせてV4の本番設定や出口を変更しない。V4 LIVE切替はCodex担当のまま。

### 対象年前・forward研究の出口候補

| 既存研究の改善方式 | 試行 | 全期間一致・堅牢選抜 | 理由 |
| --- | ---: | ---: | --- |
| Native STOPを守る時間EXIT短縮（48/54/60/66時間） | 4 | **0** | Train・Validation・Prehold・Forwardで改善が一貫しない |
| Native STOPを守る利益ロック（trigger/floor） | 10 | **0** | Train・Validation・Prehold・Forwardの同時安定性を満たさない |
| 時点以前終了取引だけに依存するY06 Online skip | 65 | **0** | Train＋Validation両方で改善するpolicyが0件 |

元資料：`v4_y06_horizon_pretarget_forward_20261112.json`、`v4_y06_profit_lock_pretarget_forward_20261112.json`、`v4_y06_online_causal_shadow_skip_20261110.json`。Horizon/Profit Lockの研究スプリットはTrain 123件、Validation55件、Prehold14件、Forward20件。Forwardのみ良好な候補、特定年度に有利な時限、Profit Lock固定だけでは採用しない。時間EXIT候補は既存Native STOP/先行EXITを尊重した条件で比較されている。

### 現在のSTABLE4 HYPE-native統合モデルにあるY06モデル採用

| 指標 | 10bps | 30bps |
| --- | ---: | ---: |
| 決済済みモデル取引 | 119 | 113 |
| モデルで損益プラスの決済 | 82 | 82 |
| 勝率 | 68.91% | 72.57% |
| 全決済モデル純損益（JPY） | +19,891 | +553,599 |
| 両コストに共通採用された元シグナル | 112 | 112 |
| 10bpsのみ採用 | 7 | — |
| 30bpsのみ採用 | — | 1 |

10bpsと30bpsで採用集合が単純な包含関係にならないのは、コストが口座残高・Gross・日次損失・同時競合に影響しているため。独立モデルトレードの勝率や全ロジック統合DD20%以下を意味しない。10bpsでは対象年集約ではY06で約＋2万円でも、ピーク→谷の損失区間では約−137万円。**対象期間全体の利益で損失連鎖を隠さず、逆に最大DD期間の負けのみで出口パラメータを最適化しない**。

## 再現証拠

- `scripts/bt_hp_v4_y06_crossperiod_evidence_audit.py`：4時間Grid、10種類Profit Lock、65 Online shadow候補のsource固定・件数/損益算術/ロジック名/Pre-target非採用、10bps/30bpsのモデルFillと元シグナルID別のcost差を点検。
- `tests/test_bt_hp_v4_y06_crossperiod_evidence_audit.py`：8合成ケース（対象年を選抜へ混入させた場合の拒否、利益差の改ざん拒否、10/30bps非包含集合の明示など）。全BT Pythonテスト177件PASS。
- Private出力：`C:\tmp\bt481-v4-y06-crossperiod-evidence-audit-20261115.json`。SHA256 `4C626220776C508B49FE5E8131C00BEAF44AA56E72EE7FFCE4A34C104C42EAFC`。

## 保留条件

V4はCodexによる正式切替中であり、対象年の研究元source pinと最新のV4 runtimeが必ずしも同じとは限らない。現行本番経済パリティを推定しない。次はY06の誤SHORT方向の判定根拠を、独立前方期間とEpisode相関を考慮した一連のイベントで検証し、価格上昇をSHORTしたケースを相場パターン別に分解する。現時点ではNative STOP保持・V4本番切替不干渉の原則で、出口・入口Gate採用を保留する。