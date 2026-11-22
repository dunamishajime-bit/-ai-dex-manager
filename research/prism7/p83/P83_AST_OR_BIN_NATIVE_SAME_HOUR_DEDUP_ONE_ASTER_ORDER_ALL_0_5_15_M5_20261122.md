# P83 — ASTER OR Binance: どちらかのNative V20発火でASTERに1件だけ注文（研究BT）

**Owner-selected**: ② OR方式。ASTER自身のV20 53候補とBinance V20発火→ASTER注文57候補を統合、同時刻両市場発火27件は必ず1件へ名寄せし、ユニーク候補83件。ASTER同一銘柄で建玉枠1。実注文は0件。

P78のASTER元Native入口と出口53件完全一致を前提。P80/P81の元STOP/出口をM5正の出来高時点で再計算し、入口0/5/15分遅延、10/30bps＋出口100bps不利ストレスも同一方式で対照。0.25倍を使用しない。原則0.75倍、BTC/ETH強い上昇相場中はPENGU相対的弱さを双方確認できれば0.5倍、無ければ見送り。

| V20発火条件（ASTER執行） | ロット | 遅延 | 最終選択／勝ち | 最大M5 DD | 1万円最終 | +100bps DD | +100bps 最終 |
|---|---|---:|---:|---:|---:|---:|---:|
| ASTER_ONLY | GROSS_075 | 0分 | 33/18 | 25.588644% | 13500.35 | 29.823101% | 10583.85 |
| BINANCE_ONLY | GROSS_075 | 0分 | 31/20 | 15.173022% | 19735.18 | 17.339193% | 15811.73 |
| BOTH_REQUIRED | GROSS_075 | 0分 | 21/13 | 15.173022% | 15175.39 | 17.339193% | 13050.04 |
| EITHER_OR_SINGLE_ASTER_ORDER | GROSS_075 | 0分 | 37/21 | 25.588644% | 16763.57 | 30.241863% | 12799.15 |
| ASTER_ONLY | GROSS_075 | 5分 | 32/18 | 26.10495% | 14075.23 | 30.211359% | 11125.51 |
| BINANCE_ONLY | GROSS_075 | 5分 | 30/18 | 15.418373% | 18898.04 | 18.011395% | 15243.25 |
| BOTH_REQUIRED | GROSS_075 | 5分 | 21/12 | 15.418373% | 14251.05 | 18.011395% | 12240.82 |
| EITHER_OR_SINGLE_ASTER_ORDER | GROSS_075 | 5分 | 36/20 | 26.10495% | 16148.1 | 30.211359% | 12413.61 |
| ASTER_ONLY | GROSS_075 | 15分 | 31/18 | 25.569898% | 15289.23 | 28.984767% | 12194.31 |
| BINANCE_ONLY | GROSS_075 | 15分 | 29/17 | 16.585072% | 20021.52 | 17.890228% | 16289.17 |
| BOTH_REQUIRED | GROSS_075 | 15分 | 21/12 | 14.935061% | 14033.46 | 16.936546% | 12051.0 |
| EITHER_OR_SINGLE_ASTER_ORDER | GROSS_075 | 15分 | 34/20 | 25.569898% | 19607.56 | 28.984767% | 15354.72 |
| ASTER_ONLY | P73_CONDITIONAL_HALF_OR_SKIP | 0分 | 30/18 | 14.548984% | 15001.01 | 18.133889% | 12140.3 |
| BINANCE_ONLY | P73_CONDITIONAL_HALF_OR_SKIP | 0分 | 27/18 | 13.019858% | 17700.9 | 14.316468% | 14696.4 |
| BOTH_REQUIRED | P73_CONDITIONAL_HALF_OR_SKIP | 0分 | 19/13 | 10.660623% | 16115.2 | 12.069008% | 14152.76 |
| EITHER_OR_SINGLE_ASTER_ORDER | P73_CONDITIONAL_HALF_OR_SKIP | 0分 | 33/20 | 14.548984% | 16671.83 | 18.622403% | 13247.16 |
| ASTER_ONLY | P73_CONDITIONAL_HALF_OR_SKIP | 5分 | 29/18 | 17.472907% | 15668.14 | 19.487936% | 12784.9 |
| BINANCE_ONLY | P73_CONDITIONAL_HALF_OR_SKIP | 5分 | 26/16 | 13.019858% | 16940.7 | 14.316468% | 14159.67 |
| BOTH_REQUIRED | P73_CONDITIONAL_HALF_OR_SKIP | 5分 | 19/12 | 10.660623% | 15085.26 | 12.251662% | 13231.66 |
| EITHER_OR_SINGLE_ASTER_ORDER | P73_CONDITIONAL_HALF_OR_SKIP | 5分 | 32/19 | 16.532208% | 16131.5 | 19.077361% | 12906.28 |
| ASTER_ONLY | P73_CONDITIONAL_HALF_OR_SKIP | 15分 | 28/18 | 12.869257% | 16967.51 | 15.399004% | 13969.43 |
| BINANCE_ONLY | P73_CONDITIONAL_HALF_OR_SKIP | 15分 | 25/15 | 16.585072% | 17871.18 | 17.890228% | 15065.43 |
| BOTH_REQUIRED | P73_CONDITIONAL_HALF_OR_SKIP | 15分 | 19/12 | 14.37894% | 14812.24 | 15.955982% | 12988.3 |
| EITHER_OR_SINGLE_ASTER_ORDER | P73_CONDITIONAL_HALF_OR_SKIP | 15分 | 30/19 | 12.869257% | 19511.34 | 15.584887% | 15900.93 |

OR対ASTER単独／Binance単独の条件付き0.5倍方式の差分：{"0min_OR_minus_ASTER_ONLY": {"netNAVDeltaYen": 1670.82, "NAVExtra100DeltaYen": 1106.86, "M5HighDDDeltaPct": 0.0, "M5HighDDExtra100DeltaPct": 0.488514, "tradeCountDelta": 3}, "0min_OR_minus_BINANCE_ONLY": {"netNAVDeltaYen": -1029.07, "NAVExtra100DeltaYen": -1449.24, "M5HighDDDeltaPct": 1.529126, "M5HighDDExtra100DeltaPct": 4.305935, "tradeCountDelta": 6}, "5min_OR_minus_ASTER_ONLY": {"netNAVDeltaYen": 463.36, "NAVExtra100DeltaYen": 121.38, "M5HighDDDeltaPct": -0.940699, "M5HighDDExtra100DeltaPct": -0.410575, "tradeCountDelta": 3}, "5min_OR_minus_BINANCE_ONLY": {"netNAVDeltaYen": -809.2, "NAVExtra100DeltaYen": -1253.39, "M5HighDDDeltaPct": 3.51235, "M5HighDDExtra100DeltaPct": 4.760893, "tradeCountDelta": 6}, "15min_OR_minus_ASTER_ONLY": {"netNAVDeltaYen": 2543.83, "NAVExtra100DeltaYen": 1931.5, "M5HighDDDeltaPct": 0.0, "M5HighDDExtra100DeltaPct": 0.185883, "tradeCountDelta": 2}, "15min_OR_minus_BINANCE_ONLY": {"netNAVDeltaYen": 1640.16, "NAVExtra100DeltaYen": 835.5, "M5HighDDDeltaPct": -3.715815, "M5HighDDExtra100DeltaPct": -2.305341, "tradeCountDelta": 5}}

**条件変更の注意**：ASTERが先に発火した取引を保有している間、後のBinance発火は増し玉しない（同一建玉枠により拒否）。逆も同じ。両市場で同時発火しても単一注文。STOPはASTERのNative出口。

本番採用不可：元研究期間の再使用、板・通信遅延・成行スプレッド・Funding・署名付きSTOP履歴・他Runnerと共有するGross/口座DDが不足。研究ブランチだけに証跡保管。
