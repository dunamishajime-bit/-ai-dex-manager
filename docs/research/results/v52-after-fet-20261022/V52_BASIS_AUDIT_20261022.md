> 後続調査で更新：この文書は初期のトークン化銘柄M5監査です。後日Yahoo公開60mとAster公式H1を復元し、入口87/87、出口理由86/87を照合済み。最終的なH1研究についてはV52_NATIVE_STOCK_FULL8_COMPARISON_20261022.mdを優先。実venueの瞬間価格・常駐STOPは未証明。

# V52 LONG/SHORT 出口研究：FETまでの累積条件からのデータ・因果性監査

状態: BLOCKED_YEARLY_V52_BASIS_REPLAY_NO_SYNCHRONIZED_REFERENCE_AND_VENUE_HISTORY

## 累積BT基準（HYPE LONG + Idle TAO/RENDER + FET LONG 8% arm/4pp giveback）

| 指標 | 10bps | 30bps |
|---|---:|---:|
| 最終資産 | 247,247,316円 | 143,906,605円 |
| 最大MTM DD | -14.6033% | -15.8077% |
| V52取引数 | 87 | 87 |

## V52 LONG/SHORT別結果（10bps）

| 方向・出口 | 件数 | 勝ち | 負け | 損益 |
|---|---:|---:|---:|---:|
| LONG|ALL | 35 | 31 | 4 | 15,672,931円 |
| LONG|BASIS_CONVERGED | 29 | 27 | 2 | 14,608,994円 |
| LONG|BASIS_STOP | 1 | 0 | 1 | -177円 |
| LONG|TIME_OR_SESSION_FLAT | 5 | 4 | 1 | 1,064,115円 |
| SHORT|ALL | 52 | 40 | 12 | 21,675,857円 |
| SHORT|BASIS_CONVERGED | 32 | 29 | 3 | 12,457,402円 |
| SHORT|BASIS_STOP | 3 | 0 | 3 | -94,259円 |
| SHORT|TIME_OR_SESSION_FLAT | 17 | 11 | 6 | 9,312,713円 |

## 因果的バックテストが未成立の理由

- 過去の原始候補台帳にYahoo入口参照価格とBasisが揃った候補 87/87件。ただし、保有中の参照価格履歴はない。
- V52建玉87件に対してトークン化銘柄の5分足入口を見つけられたのは 48件。期間全体を連続して覆うのは 48件。
- トークン入口価格とモデル価格の差が25bpsを超えた件数 48件。旧研究も公開Binance Vision USD-M 5分足の未整合・欠損を認めている。
- 何より、トークン化株価の5分足はYahoo株価のReference系列ではない。現在の動的Basis StopはAster mid / Reference priceから計算する必要がある。
- 入口Yahoo値だけから利益確定・初期逆行時点のBasisや約定を再現することはできない。現存する署名済み実取引注文の証拠とも異なる。
- LIVEのreferenceは外部provider必須。データの接続仕様をYahooと混同しない。

## 最悪損失候補（10bps）

| 時刻(UTC) | 銘柄 | 方向 | 理由 | PnL |
|---|---|---|---|---:|
| 2026-04-09T15:30 | TSLAUSDT | SHORT | BASIS_CONVERGED | -768,656円 |
| 2026-07-06T15:30 | METAUSDT | SHORT | BASIS_CONVERGED | -148,450円 |
| 2026-06-16T17:30 | MSFTUSDT | SHORT | TIME_OR_SESSION_FLAT | -126,254円 |
| 2026-05-04T15:30 | AMZNUSDT | SHORT | BASIS_STOP | -86,423円 |
| 2026-04-15T15:30 | AMZNUSDT | SHORT | TIME_OR_SESSION_FLAT | -79,326円 |
| 2026-06-23T16:30 | AMZNUSDT | SHORT | TIME_OR_SESSION_FLAT | -76,743円 |
| 2026-07-23T16:30 | METAUSDT | SHORT | TIME_OR_SESSION_FLAT | -69,469円 |
| 2026-02-03T16:30 | TSLAUSDT | SHORT | BASIS_STOP | -7,808円 |
| 2025-11-20T16:30 | MSFTUSDT | LONG | BASIS_CONVERGED | -525円 |
| 2025-11-12T17:30 | AMZNUSDT | SHORT | TIME_OR_SESSION_FLAT | -470円 |
| 2025-10-24T15:30 | TSLAUSDT | LONG | BASIS_CONVERGED | -357円 |
| 2025-10-17T15:30 | AMZNUSDT | LONG | BASIS_STOP | -177円 |
| 2025-10-02T17:30 | AMZNUSDT | SHORT | TIME_OR_SESSION_FLAT | -172円 |
| 2025-10-17T17:30 | AMZNUSDT | LONG | TIME_OR_SESSION_FLAT | -115円 |
| 2025-10-09T15:30 | METAUSDT | SHORT | BASIS_CONVERGED | -31円 |

## 次に試す候補（収益値は未認証）

- SHORT: 既存Basis収束と1.75×STOPを維持したまま、Basisが有利に動いた後、次の確定チェックポイントで逆転する場合の利益保護を評価。
- LONG: LONGの時間決済負けとBasis収束後の再拡大を別台帳で分析。SHORT条件の一括流用禁止。
- 時間出口: NY時間3h/15:30のまま、有利なBasis推移時の早期決済が資金配分に与える効果を確認。
- 必須データ: 期間全体の同期したvenue midとYahooまたは正式reference価格・更新時刻、1hチェックポイント、fill価格、各系列の起源とSHA256。過去研究で確認された固定Entry-reference STOPのDD改善なし・利益減を繰り返さない。
- データ取得後、5分足/チェックポイント因果再生、正規の8ロジック動的再選択、10/30bps、未使用期間OOS、実venue STOPを独立検証する。

## 結論

**現時点でV52の新しい出口を正式採用しない。旧ロジック・LIVEに変更なし。** 正しい価格とBasis時系列がないため改善利益やDDの数値を捏造しない。
