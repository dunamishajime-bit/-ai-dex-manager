# BT #481 — PENGU SHORT_V20 のPretarget/Forward・統合BT再検算（2026-11-15）

## 判定

**`SHORT_V20_PRETARGET_FORWARD_CONFLICT_RESEARCH_ONLY_NO_GATE_PROMOTION`**。PENGUのSHORT_V20はユーザー指定により**固定SHORT**を維持する。方向をLONGへ反転させる案は採用せず、SHORTの入口許可/阻止の複合的判定を先行期間のみで研究する。

### 対象年より前に構成された別期間の証拠

対象年前の価格ProxyはBinance UM（現行Asterの取引所約定ではない）。研究参照 `pengu_v20_preperiod_proxy_causal_gate_search_20261111.json` で、2025-01〜05 Train50件、06〜07 Valid9件、08〜09 Prehold13件の計72件を確認。

| 30bps | 取引モデル件数 | 勝率 | PF | 平均モデルreturn |
| --- | ---: | ---: | ---: | ---: |
| Train | 50 | 52.0% | 1.319 | +1.08% |
| Valid | 9 | 55.56% | 0.962 | −0.11% |
| Prehold | 13 | 30.77% | 0.315 | −3.94% |
| 真のForward（2026-10〜11） | 6 | 33.33% | 0.573 | −0.78% |

Train内で試された単一・複合Gateは121候補、**Pre-target堅牢合格は0件**。Forwardは結果を見た後に選ぶ目的では使用しない。元の別研究 `pengu_v20_shadow_health_rank1_forward_falsification_20261113.json` の固定Rank1（k=12、mean−0.01、WR0.4、PF0.6）はForward6件すべてをBLOCKし、モデル取引0件。これは損失阻止だけでなく、Forward内の利益を生んだ候補も2件遮断したので**モデル勝率や経済パリティの改善証明ではない**。採用を拒否。

### STABLE4 native HYPE 統合研究モデルでのSHORT_V20

| モデル費用 | 取引件数 | 勝ち | 負け | 合計JPYモデル純損益 |
| --- | ---: | ---: | ---: | ---: |
| 10bps | 7 | 5 | 2 | +152,308円 |
| 30bps | 7 | 5 | 2 | +73,047円 |

この7件は統合資金と他Runnerと競合した後の採用取引で、全SHORT_V20元候補72/40の独立モデル統計とは別母集団。対象年の研究モデルだけ見ると収益プラスだが、Prehold/Forward弱さを無視して高勝率のロジックとして本番強化する根拠にはならない。

## 再現コードと証跡

- `scripts/bt_hp_pengu_v20_time_split_audit.py`：Pre-targetの期間・件数・勝率・PF・リターンの算術、SHORT固定、Gate選抜にTarget/Forwardが混入していないこと、Forward6件の全block、10/30bps対象年7モデル取引集合、非venue fillをfail-closedでチェック。
- `tests/test_bt_hp_pengu_v20_time_split_audit.py`：合成9件。全BT Pythonテスト169件PASS。
- Private結果：`C:\tmp\bt481-pengu-v20-time-split-audit-20261115.json`、SHA256 `06B9F67B15934A1D04177938C73F5E0F0A8EF83028CFF6F0D8167C0204D6BF32`。

## 実運用へ進めない条件

Pre-target TRAINでの損失阻止効果がVALID/PREHOLD/FORWARDで再現せず、しかもShadow Rank1はForward6候補を全廃するため本番のSHORT_V20入口Gateを変更しない。前向き方向観測・別市場データ・5m出口/STOP品質・人工相場・閾値揺らし・Shared Risk/Gross競合・データリーク防止が必要。V4切替はCodex担当、PR #481はDraft、Production・注文・STOP変更なし。