# PRISM VII P24 — S4の大きなDDはなぜ起こるのか：未実現ピークから谷への因果分解（結果算出前固定）

**研究のみ**。P23のPENGU S4 30bps 1x/1slot保有中M5終値DD35.9415%、足内high stress37.6467%、reference実現のみDD16.10%、PRICE_PROXY_CLOSED21件+RIGHT_CENSORED1件を、元の入出口時刻やP22/P23の計算を変更せず追跡する。元SOURCE V20 pin `1657e173d250ad58f53e62f7bb0a3428fb405496` とP20/P21/P22/P23資料は不変。

## 問題の分解

- DDを生んだ最大谷の個票IDが `S3_02173` (M5close時刻178? ではなく、P23の exact `1761873900000`、close NAV約10,850円) と、HIGH stress worst `S3_01700`（M5 timestamp `1760132100000`）であることは既知。**しかし谷だけでは、その直前のNAV過去最大ピークがどの保有期間/どの取引に属したか不明**。予め固定して、SOURCE M5全時点を時系列で再現し、`runningPeakNAV`の対応日時・保持中取引・時点の実現／未実現区別を記録する。
- 10000円起点1x/30bps、SOURCE/reference entry/exit M5、元P23のfee+slip roundtrip reserve0.3%（exit 0bps additional）、正印字M5 CLOSEで現時点のNAVを計算、zero-volumeは直前の正印字closeを持ち越し。ENTRY M5 openから各exit M5 openまで、**exit M5 closeを参照せず**先にexit proxy価格で清算。SOURCEハードSTOP/MFE/トレーリング等は変更禁止。右打切り1件は最終positive print closeで未実現を保持。
- 最大ピーク↘谷は各価格印字で`peak is realized cash at closed trade vs marked unrealized trade`区別。複数の取引の間の空白時刻は最後の実現cashをピーク候補にする（新たなMARK取引を発明しない）。
- M5 HIGH adverse stressは足内OHLC順序不明だから、最大のHigh DDの直前ピークをM5 close markで決める P23仕様をそのまま明記。`HIGH_AT_ENTRY`が自身のSHORT本当のエントリーより先に発生した可能性がある場合は`INTRABAR_ORDER_UNKNOWN`。これを一般の実口座stop/fillと誤称しない。
- 取引ごとに`entryCapital, grossMFE, worstGrossMAE, bestMarkedEquity, worstMarkedEquity, highAdversePx, runningPeakAtWorst, worstGapFromPeakPct`と時刻を保存。BASE/POST/PRE、Route A/B/C、close/STOP、右打切り区分を保存。
- **新実験ルールは一つも実装しない。** S4の問題が「取引エントリー自体の価格逆行」なのか、「含み益が大きい後の利益の失効」なのか、あるいは実際のsourceのOHLC異常かを区別する調査とする。データ不整合・P23の数値再現が不成立ならFailClosed、既存P23 source risk engineの独立数値と完全一致しない場合に勝率/利益の改善を主張しない。
- 次のP25へ繋ぐ時は、市場特異な価格極値を後付け閾値に変えず、P10/P18/P19で不合格になった利益giveback早期決済と、SOURCE勝ちの利益を削らず保有リスクを下げる必要性を重視。取引数を減らすだけの見かけの改善は不可。
- 原SOURCE公開OHLCには自bot signed fills・ASK・板・Funding・Cross Gross・他Runner・完全な総合DDがなく、P24だけでDD20%以内や勝率80%の目標を認定しない。

テストと完整個票、および再現可能なsource SHAは既存Draft PR #595研究branchのみに保存。本番Master/VPS/Runner/建玉/STOP/注文/承認/HYPE/KillSwitchには一切触れない。
