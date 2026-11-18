# BT #481: HYPE本番TRENDとSTABLE4研究ルートのソース不一致（2026-11-15）

## 判定

**`RESEARCH_HYPE_ROUTE_ABSENT_FROM_REVIEWED_LIVE_EXECUTION_PATH`**。研究BTのHYPEは、2026-11-14時点の本番HYPE TRENDと同じロジックを動かしたと証明できない。**`economicParityCertified=false`**。この監査はV4のCodex切替に干渉せず、VPS/取引所の更新は行っていない。

実行可能な読み取り専用監査：`scripts/bt_hp_hype_route_source_parity_audit.py`、合成fixtureの回帰テスト：`tests/test_bt_hp_hype_route_source_parity_audit.py`。

## ソースの比較

| 項目 | STABLE4研究BTモデル | 本番HYPE TRENDの確認済みソース |
| --- | --- | --- |
| ルート/戦略名 | `HYPE_REDESIGN_CAUSAL_H48R4_WSIG` | `HYPE_LONG` / `TREND` |
| エントリー判定 | 研究h12 ≤ 0.0042978523、h24 ≥ 0.020474266、rel24 ≤ 0.0262025534 | H1 EMA12/48、240期間レジームEMA、24時間高値ブレイクアウト、ATR14等 |
| 出口 | `HYPE_REDESIGN_TIME48_NEXTOPEN`（研究上48時間） | ATR2.5倍STOP、ATR3倍トレーリング、最大168時間 |
| Grossの設定 | 研究ルートの要求1.0x | 本番TRENDの最大Gross 1.5x（実際の配分・約定と同義ではない） |
| 実装出所 | Python `portfolio_stable4_prod_caps_20261114.py` の研究モデル注入 | immutable release `a7eee1f91d86d51f2333da117243d044ae1332dc` のHYPE Runnerとconfig |
| モデルエントリー | 10bps・30bps各5件。モデル結果は各3勝2敗 | 上記5件が現行ポリシーで発火可能かは未確認 |

本番HYPEについて、秘密情報を除去したread-only設定照合により `DISDEX_HYPE_ZEC_SIGNAL_MODE=TREND`、`DISDEX_HYPE_ZEC_MAX_GROSS=1.5` を確認。Runner実行経路の許可済み6ファイル（`lib/hype-trend-long-signal.ts`、`lib/hype-zec-long-runner.ts`、`lib/hype-zec-long-market-data.ts`、`config/hypeTrendLongPolicy.ts`、`config/hypeZecLongRuntime.ts`、`scripts/disdex-hype-zec-long-live-runner.ts`）を、VPSのimmutable releaseからPCへ読み取り専用コピーしてSHA256付きで照合。研究ルート文字列は6ファイルに0件。これは**同名ルートが確認対象に無い**という証拠であり、数学的に全く同じ取引が発生しえないという証明ではない。

## 再現手順・秘密情報管理

1. Owner PCの研究モデル `*_10BPS_MODEL_ENTRIES.csv` と `*_30BPS_MODEL_ENTRIES.csv`、Python研究wrapper、上記6個のHYPE release TSファイルを隔離パスで用意する。
2. 非機密ランタイム設定証拠JSON（releaseSha、signalMode、maximumGrossの3値のみ）とライブSHAを指定して `bt_hp_hype_route_source_parity_audit.py` を実行する。
3. 研究ルートと10/30bps入口組、固定出口タグ、研究Gate閾値、TypeScript Runner配線、ポリシー数値、非機密モード・Grossを検査。未認識/欠損/不整合はfail closed。結果は `economicParityCertified=false` 固定。
4. 証拠の実ファイルはGitHubへPushせずOwner PCのみに保持。モデル/ソース/設定のSHA256を監査JSONに含める。

Private監査結果：`C:\tmp\bt481-hype-route-source-parity-20261115.json`。SHA256：`e86dbde78ea2ae4e7226c9dc814f22d7bb4fa61e6b54d9f556d541c41f770fcf`。

Private非機密モード証拠SHA256：`8ACD660B72D8B5383ADAA1429CB36D505A89CEC3529F9D18421857FB24581255`。

## 本番一致BTへ進むための残課題

現行HYPE TRENDのH1足を確定時点のみに制限して正規EMA・ATR・ブレイクアウト判定を再現し、当時のKill Switch、V4 STOP ownership、Shared Risk/Gross、実際の入口・出口価格/数量/手数料/Fundingを確認する。旧モデルの5取引を採否だけ切り替えて利益を差し引く方式は不可。他Runnerの割当競合と複利を含む**統合ポートフォリオBT全体を10bps／30bpsで再実行**すること。

V4本番切替・復旧はCodexの担当。本PRはDraft維持で、HP正式反映、Runner変更、取引所注文、STOP変更、承認操作は未実施。