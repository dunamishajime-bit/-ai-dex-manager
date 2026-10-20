# 初期逆行 STOP・統合 DD 削減研究（2026-10-20）

このディレクトリは、固定8ロジックの H1 price-model replay を用いた研究成果の provenance です。Production / VPS / LIVE / HP / operator artifact は変更していません。

## 判定

- STATUS: `COMPLETE_RESEARCH_ONLY_NONCANONICAL`
- 分類: `RESEARCH_ONLY_NONCANONICAL`
- PENGU: 既存 Exit を維持
- 採用された累積 Overlay: 0件
- Production変更: 0件

## 固定条件

- 期間: 2025-08-10〜2026-08-10
- 初期資金: ¥10,000
- 積立: なし
- 複利: あり
- 構成: 2026-10-17固定の8ロジック統合
- データ/約定モデル: H1 price-model replay（実Aster約定認証ではない）
- コスト: 10bps / 30bps

## Baseline再現値

| 指標 | 10bps | 30bps |
|---|---:|---:|
| 最終資産 | ¥222,818,966.8780 | ¥124,289,206.8183 |
| PF | 3.458796 | 3.078560 |
| 最大MTM DD | -15.6206% | -16.7878% |
| 取引数 | 1,310 | 1,307 |
| Accounting | PASS | PASS |

## 検証範囲

通常候補と、ユーザー要件に合わせた複合候補を含む14フェーズ、計50候補を、候補ごとに統合BT（10bps/30bps）で検証しました。複合候補は、固定またはATR連動の初期逆行幅、発動待ち時間、MFEゲート、確定済み5分足3本の逆行構造、同一戦略・銘柄・方向の再エントリー制限を組み合わせています。構造判定は現在足を使わず、LONG/SHORT対称です。

採用条件は、両コストでDDが0.10ポイント以上改善し、Accounting PASS、OOS劣化が許容範囲内、最終資産を75%以上維持し、未来参照がないことです。条件を満たす候補はありませんでした。

最もDDを改善した複合候補は `V12_SHORT_COMPOSITE_PCT2P0_12H_MFE1P0_STRUCTURE3_R12` でした。10bpsではDDが1.45296ポイント、30bpsでは1.48167ポイント改善しましたが、30bpsのOOS PFと最終資産保全条件を満たさず不採用です。したがって、次フェーズへ累積反映する変更はありません。

## 再現スクリプト

- `scripts/dd-reduction/task9_initial_adverse_stop_20261020.py`
- `scripts/dd-reduction/test_task9_initial_adverse_stop.py`
- `scripts/dd-reduction/build_task9_report_20261020.py`

テスト: `5 tests OK`、AST parse PASS、`git diff --check` PASS。

## 完成成果物の保存先

全候補の台帳・比較JSON・診断・manifest・SHA256索引は、Windowsの保存先ルールに従い次に保存しています。

`C:\Users\dis\Desktop\DisDex_AI_Files\01_BT_Research\2026-10-20_dd-reduction-initial-adverse-stop`

主要ファイル:

- `TASK9_INITIAL_ADVERSE_STOP_FINAL_REPORT_JA.md`
- `task9-summary.json`
- `candidate-comparison.json`
- `manifest.json`
- `baseline-loss-path-diagnostics.json`
- `baseline-dd-window-diagnostic.json`
- `sha256-index.json`

主要成果物のSHA256は `sha256-index.json` を正本とします。

| ファイル | SHA256 |
|---|---|
| `task9-summary.json` | `50219d6946df14e35c9a7ee88721a80123f99ff6d239d81f6a52f3957552cb62` |
| `candidate-comparison.json` | `3406eee3cca72e9528599ff984ea9ae7baeb6ee40d87253f8bf35448ef950b29` |
| `manifest.json` | `43238f65922ad53265739c7610349fd15d12e8a638cd5aba80dcf3f6e04b059c` |
| `TASK9_INITIAL_ADVERSE_STOP_FINAL_REPORT_JA.md` | `f8a2e52186c4fcb00c090b2fce394c1e240390f4ec2c4a0f9eab2b53c730669d` |
| `baseline-loss-path-diagnostics.json` | `9dd2953f42ba495640792cc4ffd921d19167d9625fb4e909bbe11320a0713336` |
| `baseline-dd-window-diagnostic.json` | `8bc5cc6268337f4811a579121b4feb47a5fcb6432b3ae83851a8e5f8e0fee914` |

この研究結果は正式Production認証・LIVE設定へ直接使用してはいけません。候補採用には別途、現行Production契約との一致、追加OOS、実行経路、実venue証拠が必要です。
