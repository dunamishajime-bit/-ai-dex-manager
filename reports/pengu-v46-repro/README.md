# PENGU V46 再検証パック

このディレクトリは、ChatGPT側でPENGUのEntry頻度・Exit・Pre-Core候補を再検証するための資料です。

## 安全境界

- 研究用データと結果だけを含みます。
- LIVE設定、承認ファイル、runtime state、APIキー、秘密情報は含みません。
- V96 Coreの全ポートフォリオ配分、V52 Stock、実口座の約定・残高はこのPENGU単独BTには含めていません。
- 結果は研究用であり、本番採用・VPS反映を意味しません。

## 対象コードと期間

- Production source SHA: `02e6c446df5c33dbf277dfa26325e392e4b59984`
- Branch base: `codex/pengu-long-short-18h`
- OHLCV: 2025-08-03 00:00 UTC 〜 2026-08-03 00:00 UTC、1時間足
- 有効な判定期間: 2025-08-13 00:00 UTC 〜 2026-08-03 00:00 UTC
- 市場データ: Binance public spot OHLCV
- Funding: Aster V3 public `fapi/v3/fundingRate`、PENGUUSDT
- 実行価格: 指定された次の足の始値
- 手数料: 片道6bps
- スリッページ: 0bps（実運用より楽観的）

## データ

- `data/BTCUSDT-1h-2025-08-03_2026-08-03.json`
- `data/PENGUUSDT-1h-2025-08-03_2026-08-03.json`
- `data/PENGUUSDT-funding-v3-2025-08-02_2026-08-03.json`

Fundingは特徴量の直近参照用に30時間の前方Warmupを含みます。

## 結果ファイル

- `entry-cadence-4h.json`: 現行6時間判定と4時間判定の比較。現行条件のまま4時間化すると取引数は増えるが、PFとDDが悪化。
- `exit-variants.json`: 現行Entryを固定し、保有時間・トレーリングだけを比較。
- `precore-promotion.json`: 1時間Pre-Core、同一PENGU 1スロット、Core昇格候補の比較。

## 重要な読み方

Pre-CoreのImpulse/Pullback条件は、提案をBT可能な固定条件へ落とした研究仮説です。12時間・18時間Time Stopのどちらでも同方向Coreへの昇格は0件だったため、昇格による改善効果は未検証です。結果をそのまま本番ロジックへ移植しないでください。
