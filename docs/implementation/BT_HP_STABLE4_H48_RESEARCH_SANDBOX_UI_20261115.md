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
7. ブラウザE2E、PDFレポート、正式HP公開は未完了
CI/Build PASSは本番一致を意味しない。LIVE Codex作業には干渉しない。
