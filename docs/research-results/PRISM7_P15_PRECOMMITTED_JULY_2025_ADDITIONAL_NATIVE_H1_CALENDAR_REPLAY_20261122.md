# PRISM VII P15 — July 2025 source-native PENGU SHORT V20 追加カレンダー検証（結果実行前固定）

背景：C:\tmp\disdex-bt-20251001-20261001\aster-public-v3-h1-early のPENGU H1保存ファイルは `20250301-20250924` と命名されていても **実データ先頭2025-07-18T12:00Z、1620連続H1、正出来高0は348本**。BTC同ファイルは2025-03-01から4968H1。2025年3〜7月前半にAster PENGUが実際に存在したとの仮定は禁止。これは2026-11-22時点のread-only検査で発見し、以下のSOURCE新カレンダー結果をまだ見ていない。

**調査専用。** 元PENGU runtime fixedSHA `1657e173d250ad58f53e62f7bb0a3428fb405496` のnative H1入口生成と元native source STOP/Exit再生のコードを1行も経済変更しない。元自然53件（2025-08〜2026-11、29勝）をそのまま持ち、2025-07-18以降のPENGU初回データからのH1セグメントを新規のカレンダー監査として扱う。

## 事前固定
- PENGU/BTCのH1は同じtimestampで2025-07-18T12:00Z〜2025-09-24T00:00Z (exclusive) へ整列し、1H連続/不正price/欠損/zero volume/shaを検査。
- native entry検査期間を **2025-07-26T00:00Z〜2025-08-01T00:00Z (exclusive)** に固定。開始以前はウォームアップ。SOURCE PENGU short raw generatorは180本の先行H1を必要とし、2025-07-26午前はまだ実装の実効判定足数が少ない可能性あり。
- 生成される自然SHORT候補は**未知。0件なら0件**と記録し、任意に後のAugデータで候補を増やしたり閾値を変えない。自然候補発火時刻/H1 nextOpen価格を全数監査、元native STOP・short V20 stateを同じ固定native pure source関数でEXITまで再演。観測可能H1の範囲で完了した場合だけ10/30bpsモデルの勝率/mean/PFを算出。途中打切りは勝ちにしない。
- ENTRY7/26〜7/31でもnative exit追跡は最大2025-09-24まで可能。source H1 zero-volume時のopenはsigned fillではない。SOURCE baseline real53と「追加calendar cohort」の結果は**混ぜて一つの勝率を主張しない**。
- この早期source fileは別研究で以前にアクセスした可能性があるのでblind未見OOSと呼ばない。source price market provenanceはAster public H1で、Binance proxyや実取引所自bot signed fillではない。M5/PENGU 7月初期データが現研究PCに無いためP14のM5時間順約定検証へ流用しない。
- PRICE outcomeが良くてもnative信号を選別したわけではなく、SOURCE既見53件の80%目標達成でも複利DD改善でもない。微小な新標本で閾値最適化禁止。
- 結果・ファイルSHA・厳密に区別したentry count/exit count/印字欠損/無取引のレポートをPR #595研究専用DraftにPush。本番変更禁止。
