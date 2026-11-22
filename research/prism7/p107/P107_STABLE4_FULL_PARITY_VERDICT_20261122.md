# P107 現行STABLE4 完全一致BT判定（2026-11-22）

## 判定：**FAIL CLOSED — NOT PROVEN FULL PARITY**

対象：2025-10-01 00:00 UTC〜2026-10-01 00:00 UTC（終端除外）、初期資金10,000円、複利、10bps／30bps別、全Runnerの現行固定SHA・H48・V4 DD21% HOLD・Shared Risk・Gross・注文順序・STOP・Funding。

**現行STABLE4との完全一致BTは未完成・未証明。** 既存の「STABLE4」研究用バックテストの収益・勝率・最大DDを、本番実装の確定値として扱うことを禁止する。

## 検証で合格した範囲

1. VPSの pinned release の17ファイルについてGitHubのSHA固定ブロブと照合したところ、Linux/Windowsの改行差を正規化後17/17内容一致。ただし全コード・全Runner実行パス一致ではない。
2. 2026-11-11の旧研究BTをPC上の隔離領域で再実行し、生成20ファイルが旧保存ファイルとSHA256完全一致。計算の決定性は証明したが旧SHAモデルでありSTABLE4完全一致の証明ではない。
3. 研究5ケース×10/30bpsの全10台帳で、約定件数とV4 DD21% HOLD拒否件数が個々の集計結果と一致。各ケースの入口/出口/Shared Risk/Grossが現行本番実装と完全一致するという意味ではない。
4. Binanceトレンド加点研究P106は、非PENGU独立発火ではなく旧P92経済モデル。P108に流用しない。

## VPS固定SHA（実際の runner-pins.json を読み取り専用照合）

| 対象 | 固定SHA |
|---|---|
| V4 | e788abc82e80f9fc7ab0e1ba83fdb8be267eb513 |
| PENGU | 1657e173d250ad58f53e62f7bb0a3428fb405496 |
| Q102 | c7310d34ba1b6de07071d8883a2ed0de8dcce2a7 |
| V52 | c7310d34ba1b6de07071d8883a2ed0de8dcce2a7 |
| HYPE | e0e4f1d8f22b62e9410188ef6e590a20e31f760f |
| FET、IDLE | 7688ed7c93a1918d8b44837339b7da5584a868f5 |
| Shared Risk | 2737c30e1f6d014d24a2c6d025e7f91332bf7962 |

対象研究台帳は共通してV4 53a0be39…、Q102 ef1ab178…、V52 8495daf2…、HYPE 7688ed7c…をsource_runtime_shaに記録。**選択した数ファイルに差分が無いケースもあるため、SHA差だけを損益ロジックの差とみなさない**。しかし関連実装ファイルに更新があり、現行PINの全経済動作一致を明細で証明する必要がある。

## 30bps 過去研究比較（現行Production確定BTではない）

| モデル | NAV/円 | 最大DD | 勝率 | 件数 | V4 DD21%拒否件数 |
|---|---:|---:|---:|---:|---:|
| 2026-11-11旧基準 | 321,162 | 63.20% | 56.24% | 537 | 1,185 |
| 2026-11-14「STABLE4 Opportunity」 | 4,660,538 | 23.22% | 60.41% | 1,023 | 209 |
| 2026-11-16「NORMALGROSS 3.5」 | 4,187,855 | 22.28% | 61.98% | 789 | 683 |
| 2026-11-16「GROSS 4.25・Dual H48」 | 4,923,412 | 22.28% | 61.82% | 791 | 683 |
| 2026-11-21「STOCK 1.5・TOTAL 3.5・V52 1.0」 | 2,626,290 | 21.29% | 61.77% | 803 | 673 |

10bpsの最後のケースは資金15,052,839円、DD23.19%、勝率64.00%、1,075件。双方とも最大DD20%以内未達。

## 重大な一致未証明箇所

- **現行実装の入口式**：V4/Q102/HYPE/他ルートの固定SHA native entryを現行足データでゼロから発火再算出した完全一致イベント台帳なし。
- **出口・STOP**：2026-11-21の30bps 803件の内訳は H1近似出口662件、V52 H1 basis proxy87件、M5価格出口53件、M5/H1価格proxy1件。したがって約750件がM5精度のネイティブ出口ではない。STOP当たり順、TP、partial、reduce-only、fundingの現行実装一致は未証明。
- **H48**：過去台帳には HYPE_REDESIGN_TIME48_NEXTOPEN があるが、現行HYPE固定SHA=e0e4…、他Runnerへ一律H48採用済みとの証明はない。H48の実装経路別契約と約定時刻を再演する。
- **Gross**：現行固定ソースの統合Policyは Crypto3.0、V52 aggregate 4.0、Total4.25を定義している部分がある一方、研究・正式候補条件にはStock1.5／Total3.5のモデルもある。環境変数・実際のorder gateにて実効上限を検証した上で基準BTと感応度BTを厳密に分離。
- **V4 DD21% HOLDと再許可**：拒否件数が台帳内で一致したことは、現行runtimeと同じ21%判定時刻・高値基準・再許可・Shared GLOBAL HOLDとの相互作用を証明しない。
- **V52**：historical executable book、V11 signal microstructureを再構成できておらず、同時刻の現物情報・Spread・Funding等がproxy。
- **実約定**：過去研究台帳のモデル約定は signed_execution_verified=0（全件）。これはバックテストの性質であり「不正約定」の証拠ではないが、本番約定の1件ずつの同一性は証明していない。
- **本番GLOBAL HOLD**：監査時点の保護HOLD有効。解除して確認することはせず、バックテスト内だけで注文許可を再演する。

## 次の唯一の正式PASS条件

現行固定SHAに基づく全Runnerの native signal/exits と実データ入力SHA256を固定し、5分刻みで、ENTRY候補→ゲート結果→STOP/TP/Exit→建玉/数量→Funding→Shared Risk/Gross→DD21 HOLD/再許可→口座残高をゼロから決定論的再演する。既存の近似や欠測を「一致」と見なさず、個別trade_id・source signal_idと本番ソースの一致を検査する。10/30bpsモデル双方で全件一致が得られて初めて P107 PASS。**現状は未達**。続行順 P107→P108→P109→P110。

## エビデンス

- [個別10モデル照合の機械可読結果](./P107_HISTORIC_LEDGER_PIN_INCOMPATIBILITY_AUDIT_20261122.json)
- [その再現スクリプト](./p107_historic_ledger_pin_incompatibility_audit.py)
- [研究台帳4件の初期除外検査](./P107_AUDIT_RESULT.json)
- [現行固定SHA vs VPS 配置ソース](./P107_LIVE_PIN_SOURCE_BLOB_PARITY_20261122.json)
- [改行差分類](./P107_PIN_FILE_DIFF_CLASSIFICATION_20261122.json)
- [旧BTの20ファイルSHA256完全一致](./P107_OLD_BASELINE_REPLAY_PARITY_20261122.json)
- [現行リスクソース定義](./P107_EFFECTIVE_RISK_CONFIG_SOURCE_20261122.json)

PRODUCTION_MUTATIONS=0; ORDERS=0; ORDER_ENABLE=0; GLOBAL_HOLD_UNCHANGED。
