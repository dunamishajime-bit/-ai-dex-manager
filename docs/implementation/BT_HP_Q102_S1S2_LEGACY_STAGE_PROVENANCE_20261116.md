# PR #481 / BT-481-K — Q102 S1/S2 legacy fixture source・stage provenance audit (2026-11-16)

## 結論

**`LEGACY_FIXTURE_CONTRACT_ONLY_STAGE_MEMBERSHIP_UNVERIFIED`（意図したexit 2 / Fail Closed）**。Owner PC内の過去の18件S1/S2研究フィクスチャを読み取り専用照合した。以前のQ102 Native pipelineの元バイトSHAとBT研究Pinned SHAが一致しているが、元のRaw Generatorが正式に18件を採用したという実証にはなっていない。

### 検証した非秘密集計

| Item | Evidence |
| --- | --- |
| Legacy fixture | `C:\Users\dis\DisDexLatestBt\research\quality102_s1s2_known_fixture.csv` |
| Fixture SHA256 | `FC3C71C5865BD7E7CC04EB6DE8D76291023A0D1ED75FB9323887001A26476C32` |
| Legacy raw reconstruction code | `scripts/research_quality102_s1s2_reconstructed.py` （同上の旧作業領域） |
| Reconstruction SHA256 | `A651E3A2B4F63A19B67071DC4BFD1CD2EE89835A663FEA92CBB933E3F7A51985` |
| Pinned pipeline source SHA256 | `7483C4CA504320FF9B4F06479C84418604D1B310AEEAA6C3574AE8CA5285AB8F` |
| 研究フィクスチャ（過去の選択済シグナル行） | **計18 / S1 8 / S2 10** |
| 銘柄数 | 6 |
| Native sourceが要求する元拡張候補数 | **30** |
| 上流Expanded30行とstage1Ids/stage2Ids | **未取得** |
| 上流Native Raw Generatorの元証拠 | **未実証** |
| 元の180日月次ルールID・取引所実約定台帳 | **未取得** |
| 本番S1/S2正式承認エントリー | **0** |

旧リコンストラクションPythonの定数は `ORIGINAL_RAW_GENERATOR_PROVEN = False` / `RESEARCH_ONLY = True`。この明示的な証拠の限界を改変した場合も監査が拒否する。18行が8/10に分かれることだけで、元30のステージ所属や本番18約定を逆算していない。

### 監査した契約

- CSV 18行のschemaとsource fingerprintが固定であることを検証。S1/S2の8/10、UTC H1整列、信号の1時間後のentry、時系列順、銘柄、方向の構文を照合。
- Native sourceのWindows CRLFとGit LFは改行だけ正規化してSHA照合。コードや経済閾値は変更しない。
- `scripts/bt_hp_q102_legacy_stage_membership_audit.py` の合成回帰 **9件PASS**、Owner旧フィクスチャのread-only auditは意図通りexit2。失敗理由はsource不一致ではなく上流生成器・stage ID provenanceの未実証。
- 個別18行はGitHubに転載せず、非公開監査結果のみOwner PC `C:\Users\dis\disdex-bt481-private-evidence-20261116\Q102_S1S2_LEGACY_STAGE_PROVENANCE_20261116.json` に保存。SHA256 `0EAC69AEFCC69468DA15C9BD70B7CB7476C07263820B26F16E7489E21AA46B76`。
- 研究用Native 180日人工市場27件は別Fixture。旧18行と同一の実約定、または適切な前180日学習履歴とは見なさない。元H1、exit、fee/funding、30 expanded raw candidates、選択 stage1Ids/stage2Ids、歴史的rule map、独立OOS、Q102 one-slotとShared Risk / Grossの完全証跡が依然必要。

## 再現

```powershell
cd C:\Users\dis\disdex-bt481-j-20261116
python -m unittest discover -s tests -p 'test_bt_hp_q102_legacy_stage_membership_audit.py' -v
python scripts/bt_hp_q102_legacy_stage_membership_audit.py --fixture C:\Users\dis\DisDexLatestBt\research\quality102_s1s2_known_fixture.csv --native-source lib\bt-verification\pinned-native-q102\disdex-quality102-causal-pipeline.ts --reconstructed-script C:\Users\dis\DisDexLatestBt\scripts\research_quality102_s1s2_reconstructed.py
# 監査のexit code 2は「出所未認証で発火不可」を意味する（期待どおり）
```

次は出所固定の拡張30件IDと学習Windowを独立に証明する。証拠がない間は `verifiedStageMembership=false` を維持し、Native S1/S2候補をモデルFill/本番Ordersへ渡さない。CodexのV4復旧・Production認証・注文・STOP・Kill Switchは一切変更していない。
