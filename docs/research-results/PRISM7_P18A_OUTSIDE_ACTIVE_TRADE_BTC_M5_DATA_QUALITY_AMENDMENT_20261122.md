# P18A — BTC M5アーカイブに含まれる、全SOURCE保有窓外のOHLC不整合足の隔離（経済結果前修正）

P18の最初の実行はBTC M5 source `load_m5` 全期間品質検査で `INVALID_M5_OHLC_OR_VOLUME:1757771400000` としてFAIL CLOSEDし、**経済的なEXIT結果は未計算**。read-onlyでBTC gzip4ファイルを全行再監査した結果、不正OHLCバーは**合計1本のみ**：
- `2025-09-13T13:50:00Z`, `BTCUSDT-5m-20250801-20250924.jsonl.gz`、`open=115777.0 > high=115774.3`。SOURCE gzip SHA256 `81ea647df8c2afaaf8eca477d36d6e8493d0da66469ce1498500bccfa7e3eb0a`。
- P14固定元SHORT53件のうち、**価格観測可能な52件すべて**の `[first-positive-entry-Tminus1H, P14-native-M5-first-exit)` を確認したところ、上記異常足に重なるSOURCE保有ケースは**0件**。残りBTC M5 gzip3ファイルの不正OHLCは0本。

**結果を得る前にここで前提を変更して固定する**。P18でBTCのM5を読み込む際、当該唯一の不正足の`timestamp`と内容をsource SHAと共に入力監査台帳へ記録し、当該時刻を研究価格シグナルの根拠として使用しない。もしSOURCE P14のどの観測可能ポジションの `entry−1H <= invalidTimestamp < nativeExit` に不正足が含まれていれば**Fail Closed**し経済結論を出さない。アーカイブ価格自体は修正しない、欠損を補完しない。不正足以外のすべてのtimestamp/価格/出来高はそのまま使う。

共通+3% MFE / giveback / BTC1H+0.30% or +0.50% / PENGU buying pressure / SOURCE native STOP優先の2条件、元53候補、fee10/30、追加滑り0/10/25は一切変更なし。結果による恣意的除外ではない。品質上の修正のみ。H1 SOURCEとM5足が完全に一致することを意味しない。GitHub研究Draft PR #595以外への変更禁止。
