# BT #481 — STABLE4研究ケース表示とH48人工市場診断 (2026-11-15)

## 作業境界
- 対象: BTページ専用の研究ブランチ feat/bt-visual-gross-20261114 のみ
- LIVE Runner、systemd、取引所注文、STOP、Shared Risk、Kill Switch、V4 Codex切替、Production HP配備は変更しない
- 実装対象3層STABLE4_OPPORTUNITY＋H48と、保存済み研究モデルの定義を区別する

## Task A: 人工価格 × H48研究入口（64a4de012）
- 独立した合成人工市場シミュレータ h48-research-sandbox.ts
- 確定H1時点条件：HYPEの12h return ≤ 0.0042978523、24h return ≥ 0.020474266、HYPE24h−BTC24h ≤ 0.0262025534
- 研究Gross 1.0x、signal後の次H1 openでENTRY、48h後の次H1 openでEXIT
- 観測済みBTC価格・固定seedから人工HYPE価格を生成。10bps/30bps往復費用を独立に模擬
- V4の優先枠譲渡、Q102、PENGU、FET、IDLE、V52、Online Layer2/3、Funding、LIVE STOPを再現したものではない
- Selftest: 4人工市場で計5モデルENTRY、全tickのequity/Gross一致、seed再現、入力異常Fail Closed
- TypeScript typecheck PASS、Next.js 16 production build PASS

## Task B: 研究上限・本番Gross上限版の比較
- stable4-baseline-comparison.ts はSource INDEXで2ケース×10/30bpsを厳格照合
- Stable4BaselineComparisonPanel.tsx は研究ライブラリに両ケースの最終JPY、DD、モデル約定、Gross capsを並べる
- 高研究上限 STABLE4_HYPE6_Q102_DUALHEALTH_VALIDATION_20261114 は Total4.25x Crypto3.0x Stock4.0x
- 本番上限を模したSTABLE4_OPPORTUNITY_PROD_CAPS_20261114 は Total3.5x Crypto3.0x Stock1.5x
- 4件・同初期JPY10000・元SHA形式・capsがすべて一致しなければ比較を表示しない
- Owner PC非公開INDEXで10bps最終資金13,541,227.4169円対12,442,421.0550円を照合。30bpsも元INDEXで照合
- 差額は採用建玉・機会競合も変わるためGross単体因果効果とは認証しない
- これは研究BTのみで、現行LIVE完全一致でも実約定証明でもない

## 残存ゲート（この文書は完了証明ではない）
1. 全7売買系統＋Layer2/3を隔離した元研究コードへ接続。H48以外は未接続
2. 全シンボルのH1/M5、出来高、FX、Funding、株式暦などを因果的に生成し、欠損はFail Closed
3. 元研究エンジンの枠譲渡、Q102限定復活、Layer3機会評価、Shared Risk/Gross、STOP/部分約定を完全統合
4. 数量・FX・contract multiplierと正規出口の証跡を元コードから出力。研究欠損は推測補完しない
5. HP新規BTジョブ送信、隔離Worker、認証保存、再生一体化は未接続
6. 本番の非公開ディレクトリ・Owner origin・容量・Approval/Deployは未完了
7. BT画面全体のブラウザーE2E、正式HP公開は未完了。PDFレポート生成はChromium smoke PASS
CI/Build PASSは本番一致を意味しない。LIVE Codex作業には干渉しない。

## 2026-11-15: H48画面・PDFの追加チェック
- Commit 83d0776ba: モデル口座残高、最大DD、Gross、建玉、ロジック別成績、source SHAをHTMLエスケープしてPDF保存できる印刷画面を追加。ページ全体のTypeScript型検査とNext.js production build PASS。
- Commit e1733789d: 毎5分tickの人工HYPE現在価格と最後の確定H1でのH12/H24/BTC相対24h結果、PASS/BLOCK理由を画面に追加。外部研究JSONへの研究用H48判定値混入と不正模擬価格はstrict replay validatorで拒否。4市場/5モデルENTRY/全Tick一致テスト、TypeScript型検査、Next.js build PASS。
- Owner PC Chrome headlessでHTML印刷経由のPDFを実際に生成。検証専用private path C:\\tmp\\bt481-h48-pdf-smoke-20261115.pdf、107,702 bytes、PDF signature %PDF、1ページを確認。これは合成H48の独立レポートであり正式LIVE根拠ではない。ブラウザーのポップアップ操作やOwner認証済み実サーバー保存のE2Eは未実施。
- スモーク試験用fixture生成スクリプト scripts/bt-hp-print-chromium-fixture.ts を保持。Private HTML/PDFはGitHubへ保存しない。
- 元STABLE4 manifestの根拠はOwner PCの結果台帳／研究wrapper。Source SHA・全戦略の独立計算エンジンは未認証のため、新規全戦略BT実行は有効化しない。Codex LIVE作業とは競合させない。

## 2026-11-15：H48ソースの追加独立監査と修正
- Owner PCの研究元データ hype_wsig_fixed_entry_m5_exit_grid_v3_20261114.json から、選定candidate設定 holdHours48/hardStop6%/takeProfitなしを確認。
- 当該candidateの対象年27件はすべて entry UTC hour mod 6=0。うちTIME21件/STOP6件。
- 実際に3層STABLE4統合研究で採用されたHYPEモデル決済8件は、TIME7件/FORMAL_PRIORITY1件/STOP0件（10bpsと30bpsで同件数）。候補側のSTOP6件と統合8件のSTOP0件を混同しない。
- H48の模擬エントリーを6時間UTC枠に限定し、候補研究の6%STOPを人工5分刻みの観測済み価格で簡易判定する。これは元M5の高値安値/取引所STOPや全Runner枠譲渡の再現ではない。
- デフォルトseed123456で4相場計0エントリーになることは入口判定の制約であり合格件数を偽造しない。再現テスト用の合成人工市場seed11/trendで6時間枠に従う1 entryを確認。画面に「H48発火例」シード設定ボタンを設置。
- したがって単体検証のためのH48信号モデルと、LIVE切替対象の3層STABLE4_OPPORTUNITY全経済ロジックを別のsourceModeとして区別する。
