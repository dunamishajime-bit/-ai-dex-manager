# STABLE4 外部Root固定SHA監査（2026-11-17）

## 判定：読取専用の準備完了・LIVE移行は未承認

前回取得済みのOwner PC上の私有Rootソーススナップショット（2026-11-16）のみを使用して、`disdex_stable4_root_dependency_graph_readonly.py` のAST依存調査を独立再実行しました。**21モジュールのハッシュが全て一致、Root内の静的import欠落は0件**です。ただし、**外部コードの動的読込が4サイト**残っています。

**重要：これは過去のPCスナップショットの照合であり、現在のVPSのRoot実体・UID・権限・本番プロセスの署名を証明していません。**

## 新たに準備した実行物

- `config/stable4/root-observed-snapshot-pins-20261116.json`：既存21モジュールの観測SHA256と動的読込4サイトを記録。ソース内容、秘密鍵、認証情報、建玉等は含みません。
- `scripts/ops/root/disdex_stable4_external_root_pin_audit.py`：外部Rootに対して読み取り専用のAST解析、SHA256、モジュール集合・読込サイト・Root所有/書込権限の照合を行います。秘密情報を読み出さず、認証・マージ・systemd操作・注文・状態書込は行いません。
- `scripts/ops/root/test_disdex_stable4_external_root_pin_audit.py`：合成Rootでハッシュ改変、欠落・未知の依存、動的import箇所の差分、重複JSON、偽の認証宣言、Rootパス・ピンファイル不正を拒否するテスト。**8件PASS**（Windowsローカル）。
- PCの既存スナップショットに対して`--offline-snapshot`で実行した結果：`ROOT_PIN_HASHES_MATCH_DYNAMIC_LOADER_REVIEW_PENDING`、`moduleCount=21`、`dynamicSiteCount=4`、`rootOwnershipChecked=false`、`sourceClosureCertified=false`。

この監査ツールは、全ハッシュが一致した場合でも**exit code 2（未承認）**を返します。これは実装上の意図的なFail Closedです。

## Codexが正式切替前に行う追加検証

候補リリースSHAと immutable release markerが固定され、Root所有のソース・ピンファイルが揃った段階で、VPS側で以下の**読取専用コマンド**を検証します。

```bash
sudo /usr/bin/python3 -B scripts/ops/root/disdex_stable4_external_root_pin_audit.py \
  --root /usr/local/libexec/disdex-unified
```

`sudo`の利用は既存の正式な認証経路に限定します。ここでは実行していません。実行するとRootディレクトリとピンファイルの所有・モード・SHA・ASTを確認し、ハッシュが一致しても動的読込4サイトの個別証跡が残る限り未承認と判断します。

動的読込対象：`disdex_pending_maintenance_install` の immutable release内Python子モジュール2件、および`disdex_v4_priority_live` のV4 evidence refresh helper。ASTで検出した呼出サイトは4件ですが、バイナリ/ソースの独立SHA、ロード先・プロセス・所有者・rollbackは**別途レビュー**が必要です。

また、Gitのcandidate manifestに残る外部Rootのimport参照と動的TypeScript importは、これらだけでは解決しません。現時点で`sourceClosureCertified`と`productionReady`をtrueにする根拠はありません。

Q102旧Writer排他、追加52件の確定結果、signed GETでのSTOP照合、10/30bpsのsource-exact BT、DD20%上限およびOwner承認も引き続き未成立です。

**今回の作業でVPS、本番Runner、保護STOP、建玉、注文、Kill Switch、Shared Risk、Owner承認は変更していません。**
