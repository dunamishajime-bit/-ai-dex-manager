# P15A — 実験実行前ソース品質エラーに伴う観測終了日の限定

2026-11-22 SOURCE July replayの第1回実行は経済結果が一件も計算されず、H1 archive品質チェックでFAIL CLOSEDした。固定source `BTCUSDT-1h-20250301-20250924.jsonl.gz` の **2025-09-13T13:00Z**のH1で `open 115941.8 > high 115916.1` の不整合があった。PENGU同ファイルは全バーOHLC妥当。品質エラーを黙って修正・無視しない。

本SOURCE native V20研究は、ENTRY **2025-07-26T00:00Z〜2025-08-01T00:00Z**を事前固定し、native maxHoldは72H。EXIT/H1連続時間を最大 **2025-08-08T00:00Z**で観測すれば、新自然ENTRYは追加せず、固定periodのtrade lifecycleを十分超えて追跡できる。そこで、結果を見る前に `DATA_END=2025-08-08T00:00:00Z` へ明示的に短縮し、BTC sourceの不正足は**観測窓の外**として入力ファイル内の`outOfScopeMalformedCandles=1`を証跡表示。観測窓内の不正BTC/PENGU H1は0件（Python read-only確認）。あくまで観測窓内に限定することでSOURCE品質ルールを守る。

元SOURCE 11経済関数、PENGU SHORT Entry、STOP、fee 10/30bps、固定entry dates、予定の未見OOS慎重表示、アーカイブSHAは変更なし。修正は**入力観測範囲の縮小のみ**、経済結果に基づいた最適化は一切実施していない。PENGU自然signalが0件なら0件と表示。M5なしの価格モデルを実約定BTと呼ばない。GitHub Draft PR #595以外へ変更なし。
