# PR #481 — IDLE vNext 1.0x/1-slot Online・Pretarget/Forward追試（2026-11-15）

## 結論

**`IDLE_ONE_X_FORWARD_SMALL_SAMPLE_NO_INTEGRATED_DD20_CERTIFICATION`**。2026-11-13〜14の元研究台帳3資料を独立照合し、IDLE vNextの1.0x・単一スロットを研究として再監査。RENDER固定SHORT、DOT固定LONG、JUP/TIAのOnline候補を1-slotで競合させる研究設計だが、現在の本番IDLE source pin・正式Gross/Shared Risk・STOP/venue Fillとは完全一致ではない。

| IDLE vNext 1-slot研究モデル | 対象年（2025/10〜2026/10）10bps | 対象年30bps | 別Forward期間10bps | 別Forward期間30bps |
| --- | ---: | ---: | ---: | ---: |
| 取引モデル件数 | 270 | 270 | 33 | 33 |
| 勝率 | **56.67%** | **53.70%** | **69.70%** | **66.67%** |
| Profit Factor | 1.422 | 1.250 | 2.594 | 2.330 |
| 単独決済残高ベース最大DD | −24.19% | **−33.26%** | −14.01% | −14.38% |

元データ上、Entry候補655のうちモデル採用303件（対象年270/Forward33）、競合Block352件を一致照合。Forwardは33件の小標本で勝率は改善傾向だが、対象年特に30bps DD33.26%が目標20%を大きく超える。**単独決済DDと7戦略統合時価DDは別母集団**なので、対象年だけで1.0x正式採用・損切り設定変更は認めない。

### Layer2 Online判定の反証

別の `IDLE_ALL5P_ONLINE_CONFIRMATION_GATE` 研究では対象モデル218件中JUP 66件、TIA 65件をOnline方向で確認。ただし**反対判定0件／モデル取引をBlock0件**で、10bps/30bpsとも`baseline`と`confirmed`の勝率・PF・損益が完全一致。Layer2を付けただけで勝率が上がったと解釈しない。

### Pretarget候補固定と過学習回避

uniform STOP7候補のうちPretarget条件を通過した6候補を記録。研究内rank1は「追加uniform stop無し」。rank1は上記1-slot vNextの対象年30bps270件・Forward33件の勝率と一致する。別候補（4%、5%、6%、8%、10%）はForwardや対象年の良い数字だけで選び直さず、事前固定の検証に限る。

## 証拠・コード・未認証事項

- `scripts/bt_hp_idle_vnext_online_forward_audit.py`：元モデル303/352件、候補のスコープと時間順、対象年とForward分離、各費用のn・勝率・Profit Factor・DD・銘柄/方向件数、Online無効果とPretarget rank1の検証。
- `tests/test_bt_hp_idle_vnext_online_forward_audit.py`：9合成ケース。Target漏洩／重複・時間漂流／元Online反対0の改ざん／STOP族ごとの不一致を拒否。全BT Python **243件PASS**。
- Private source audit `C:\tmp\bt481-idle-vnext-pretarget-forward-evidence-20261115.json`、SHA256 `1559B703E140EF9C8D247EC150D79DD890D7DF6D2AEBD7E71F168A05CB19D124`。
- 元資料：`DIRECTION_RESEARCH_20261109/idle_vnext_core_tia_side_specific_v3_20261113.json`、`idle_all5p_online_confirmation_gate_20261113.json`、`idle_vnext_v3_uniform_stop_pretarget_20261114.json`。

**未完了：** 全Runner統合BTの新V4 source完全一致、独立市場OOS、IDLE各通貨価格・数量・正式STOP／M5価格接触、Shared Risk・Portfolio Opportunity同時点EVとの整合、統合MTM DD≤20%。これらが成立するまで本番IDLE1.0x・新エントリー判定を変更しない。LIVE Runner・取引・STOP・Kill Switch・HP承認変更0件。