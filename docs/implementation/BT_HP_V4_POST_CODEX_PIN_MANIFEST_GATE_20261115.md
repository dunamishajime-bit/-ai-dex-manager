# PR #481 — Codex切替後V4 runner-pinと研究BT source-SHAの隔離監査（2026-11-15）

## 判定：`BLOCKED_REPLAY_REQUIRED`

OwnerがV4切替完了を申告したため、VPSの `/etc/disdex/runner-pins.json` を**読み取り専用**で確認。V4 `V12_V4` の登録SHAは **`e788abc82e80f9fc7ab0e1ba83fdb8be267eb513`**。一方、既存の元研究統合モデルではV4のsource SHAが別版であり、新版を対象年へ再実行した本番経済パリティは未証明。

元研究台帳10bps/30bpsの各7戦略の `source_runtime_sha` を現在の9 runner-pin manifestへ照合した結果：

| 売買系統 | Source SHAとの一致 | 次の扱い |
| --- | --- | --- |
| V4 | **MISMATCH** | 新pinを使用した候補・価格・出口・Grossの新規リプレイが必要。Codexの切替状態には干渉しない |
| HYPE | **MISMATCH** | 旧H48研究モデルと現行HYPE TRENDの相違を維持。78候補単独監査は存在するが統合経済パリティ未証明 |
| Q102 | Manifest SHA一致 | シグナル・実行数量・Riskは別検証 |
| PENGU | Manifest SHA一致 | シグナル・実行数量・Riskは別検証 |
| V52 | Manifest SHA一致 | シグナル・実行数量・Riskは別検証 |
| IDLE | Manifest SHA一致 | シグナル・実行数量・Riskは別検証 |
| FET | Manifest SHA一致 | シグナル・実行数量・Riskは別検証 |

**この一致は登録SHAとの一致のみ**。本番RunnerがLIVEである証拠でも、保有建玉・STOP・注文・取引所約定・APIレート制限・日次損失・Gross 3.0/1.5/3.5x、Kill Switchの時系列での完全整合証拠でもない。実際にV4 main unitが現在稼働しているかの最終確認は未完了。過去に失敗した旧V4監視unitも systemctl一覧に残るため、古いfailed履歴を現在のV4本体failedと混同しない。

## 再現コードとPrivate証拠

- `scripts/bt_hp_runtime_pin_manifest_gate.py`：9 pinの完全SHA、7戦略model entriesの10/30bps集合一致とmanifestとの一致を検証。V4/HYPEが違えば`BLOCKED_REPLAY_REQUIRED`。`activeUnitStatusProven=false`、`signedVenueFillsCertified=false`、`productionMutations=0`を維持。
- `tests/test_bt_hp_runtime_pin_manifest_gate.py`：10テスト、欠損manifest・架空のLIVE認証・cost caseのsource漂流・重複元trade IDを拒否。
- Private raw manifest snapshot：`C:\tmp\bt481-current-runner-pins-readonly-snapshot-20261115.json`。
- Private監査結果：`C:\tmp\bt481-pin-manifest-vs-native-research-20261115.json`、SHA256 **`B0533B93AD14EC45F0A258337E34B4E4108AE8E6DC06EB52BD48EA7694B9A3B2`**。

## 作業境界

今回の確認ではVPSへ書込み・systemdのrestart/stop・本番HP承認・注文・建玉・STOP・KillSwitch変更は行っていない。CodexのV4切替は尊重する。新V4の各実装ソースが取得でき、研究の経済条件が再現されるまでは、**旧STABLE4の勝率・利益・DDを新しいV4の見込として宣伝しない**。